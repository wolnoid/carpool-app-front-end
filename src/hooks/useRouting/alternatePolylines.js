import { HYBRID_STYLES } from "../../routing/hybridPlanner/styles";
import {
  decodeStepPath,
  routeHasTransitSteps,
  getTransitDetailsFromStep,
  getTransitLineColor,
  getRouteOverviewPath,
} from "./polylineStyles";
import {
  getProjectionAndZoom,
  buildOccupiedSegmentsPx,
  visibleChunksMasked,
  limitPathPoints,
} from "./geo";
import {
  OVERLAP_MASK_PARALLEL_DOT_MIN,
  overlapMaskThresholdPx,
} from "./shadow";

const MAX_PATH_POINTS_DRAW = 900;
const MAX_OCCUPIED_SEGS_FOR_MASK = 2200;
const SELECTED_WALK_MASK_MIN_PX = 6;
const SELECTED_WALK_MASK_FACTOR = 1.0;
const SELECTED_WALK_MASK_PARALLEL_DOT_MIN = 0.55;
const MASK_OPS_TARGET = 1500000;
const MASK_DENSIFY_FUDGE = 3;

function thinOccupiedSegsForMask(segs) {
  const list = Array.isArray(segs) ? segs : [];
  if (list.length <= MAX_OCCUPIED_SEGS_FOR_MASK) return list;
  const step = Math.ceil(list.length / MAX_OCCUPIED_SEGS_FOR_MASK);
  const out = [];
  for (let i = 0; i < list.length; i += step) out.push(list[i]);
  if (out.length > MAX_OCCUPIED_SEGS_FOR_MASK) out.length = MAX_OCCUPIED_SEGS_FOR_MASK;
  return out;
}

function thinOccupiedForPath(path, segs) {
  const base = thinOccupiedSegsForMask(segs);
  const n = Array.isArray(path) ? path.length : 0;
  if (!n || !base.length) return base;

  const maxOcc = Math.max(180, Math.floor(MASK_OPS_TARGET / (n * MASK_DENSIFY_FUDGE)));
  if (base.length <= maxOcc) return base;

  const step = Math.ceil(base.length / maxOcc);
  const out = [];
  for (let i = 0; i < base.length; i += step) out.push(base[i]);
  if (out.length > maxOcc) out.length = maxOcc;
  return out;
}

export function clearAltPolylines(altPolylinesRef, altPolylineListenersRef) {
  (altPolylineListenersRef.current ?? []).forEach((l) => {
    try {
      l?.remove?.();
    } catch {
      // ignore
    }
  });
  altPolylineListenersRef.current = [];

  (altPolylinesRef.current ?? []).forEach((p) => {
    try {
      p.setMap(null);
    } catch {
      // ignore
    }
  });
  altPolylinesRef.current = [];
}

// For transit routes, we treat WALKING steps as "non-claiming" space.
// This avoids alternate-route clipping creating awkward gaps on walking transfers.
function routeStepParts(route) {
  const out = [];
  const legs = route?.legs ?? [];
  for (const leg of legs) {
    const steps = leg?.steps ?? [];
    for (const step of steps) {
      const mode = step?.travel_mode ?? null;
      const path = decodeStepPath(step);
      if (!path?.length) continue;
      // Keep the original step so we can extract transit line colors for alternates.
      out.push({ mode, path, step });
    }
  }
  // Fallback if steps are missing.
  const fallback = getRouteOverviewPath(route);
  if (!out.length && fallback?.length) {
    out.push({ mode: null, path: fallback, step: null });
  }
  return out;
}

function routeWalkingPaths(route) {
  const out = [];
  const parts = routeStepParts(route);
  for (const p of parts) {
    if (p?.mode !== "WALKING") continue;
    if (p?.path?.length) out.push(p.path);
  }
  return out;
}

export function drawAlternatePolylines({
  map,
  altPolylinesRef,
  altPolylineListenersRef,
  addShadowPolyline,
  registerPolylineBase,
}, fullDirections, selectedIdx, onSelectRoute) {
  if (!map) return;

  clearAltPolylines(altPolylinesRef, altPolylineListenersRef);

  const routes = fullDirections?.routes ?? [];
  if (routes.length <= 1) return;

  // Styling for alternates (still background, but clearer)
  const ALT_COLOR = HYBRID_STYLES.ALT_GRAY;
  const ALT_OPACITY = 0.6;
  const ALT_WEIGHT = 8;

  const pz = getProjectionAndZoom(map);
  const thresholdPx = overlapMaskThresholdPx(ALT_WEIGHT);
  const selectedWalkThresholdPx = Math.max(
    SELECTED_WALK_MASK_MIN_PX,
    thresholdPx * SELECTED_WALK_MASK_FACTOR
  );

  // Occupied space is built in pane order (top card first), so higher-priority
  // routes claim overlaps before lower-priority ones.
  let occupiedSegs = [];
  let selectedWalkingOccSegs = [];
  // Selected-route walking legs are dotted and visually translucent, so make them
  // claim space up front to prevent alternates from showing through underneath.
  if (pz) {
    const selectedRoute = routes?.[selectedIdx];
    const selectedWalking = routeWalkingPaths(selectedRoute);
    if (selectedWalking.length) {
      selectedWalkingOccSegs = thinOccupiedSegsForMask(
        buildOccupiedSegmentsPx(selectedWalking, pz.proj, pz.zoom)
      );
    }
  }
  // Draw in pane order (lowest index = highest ranked). Lower-ranked routes are
  // clipped under already-claimed geometry.
  routes.forEach((r, idx) => {
    const isSelected = idx === selectedIdx;

    const isTransitRoute = routeHasTransitSteps(r);
    const parts = isTransitRoute
      ? routeStepParts(r)
      : [{ mode: null, path: getRouteOverviewPath(r), step: null }];
    if (!parts.length) return;

    const zIndex = 12 - idx; // higher rank sits on top among alternates

    // Accumulate non-walking chunks we draw for this route; add to occupied set once per route.
    const routeOccChunks = [];

    parts.forEach((part) => {
      const rawPath0 = part?.path;
      const rawPath = limitPathPoints(rawPath0, MAX_PATH_POINTS_DRAW);
      if (!rawPath?.length) return;

      const isWalking = part?.mode === "WALKING";

      // Selected route is drawn by primary overlay; it still claims occupied space
      // according to pane order so lower-ranked alternates are clipped beneath it.
      if (isSelected) {
        if (!isWalking) routeOccChunks.push(rawPath);
        return;
      }

      let chunks = [rawPath];

      // First pass: selected-route WALKING should always occlude alternates where they overlap.
      if (pz && selectedWalkingOccSegs.length) {
        chunks = chunks.flatMap((chunk) =>
          visibleChunksMasked(
            chunk,
            thinOccupiedForPath(chunk, selectedWalkingOccSegs),
            pz.proj,
            pz.zoom,
            selectedWalkThresholdPx,
            SELECTED_WALK_MASK_PARALLEL_DOT_MIN,
            false
          )
        );
      }

      // Second pass: pane-order masking for non-walking alternate segments.
      // Keep walking transfers mostly intact for readability.
      if (pz && !isWalking && chunks.length) {
        chunks = chunks.flatMap((chunk) =>
          visibleChunksMasked(
            chunk,
            thinOccupiedForPath(chunk, occupiedSegs),
            pz.proj,
            pz.zoom,
            thresholdPx,
            OVERLAP_MASK_PARALLEL_DOT_MIN,
            false
          )
        );
      }

      if (!chunks.length) return;

      chunks.forEach((chunk) => {
        // For unselected transit routes, color TRANSIT legs by their line color.
        // Keep non-transit legs (walk/bike/skate connectors) in the default alternate blue.
        let strokeColor = ALT_COLOR;
        if (part?.mode === "TRANSIT") {
          const td = getTransitDetailsFromStep(part?.step);
          strokeColor = getTransitLineColor(td, ALT_COLOR);
        }

        const shadow = addShadowPolyline({
          path: chunk,
          strokeWeight: ALT_WEIGHT,
          zIndex,
          isAlt: true,
        });
        if (shadow) altPolylinesRef.current.push(shadow);

        const poly = new window.google.maps.Polyline({
          map,
          path: limitPathPoints(chunk, MAX_PATH_POINTS_DRAW),
          clickable: true,
          strokeColor,
          strokeOpacity: ALT_OPACITY,
          strokeWeight: ALT_WEIGHT,
          zIndex,
        });

        const listener = poly.addListener("click", () => {
          onSelectRoute?.(idx);
        });

        registerPolylineBase(poly);
        altPolylinesRef.current.push(poly);
        altPolylineListenersRef.current.push(listener);
      });

      if (!isWalking) routeOccChunks.push(...chunks);
    });

    // Feed what we actually drew into the occupied set so lower-ranked routes don't stack under it.
    // Exclude walking chunks so we don't create transfer-leg holes on lower-ranked routes.
    if (pz && routeOccChunks.length) {
      occupiedSegs = thinOccupiedSegsForMask([
        ...occupiedSegs,
        ...buildOccupiedSegmentsPx(routeOccChunks, pz.proj, pz.zoom),
      ]);
    }
  });
}
