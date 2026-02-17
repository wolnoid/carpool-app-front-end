import {
  HYBRID_STYLES,
  polylineStyleForMode,
} from "../../../routing/hybridPlanner/styles";
import {
  decodeStepPath,
  getTransitDetailsFromStep,
  getTransitLineColor,
  getRouteOverviewPath,
  DEFAULT_TRANSIT_BLUE,
  styleIsDotted,
} from "../polylineStyles";
import {
  limitPathPoints,
  getProjectionAndZoom,
  buildOccupiedSegmentsPx,
  visibleChunksMasked,
} from "../geo";
import {
  OVERLAP_MASK_PARALLEL_DOT_MIN,
  overlapMaskThresholdPx,
} from "../shadow";

function getStepPath(step) {
  return decodeStepPath(step);
}

function getSegmentPath(seg) {
  if (!seg) return [];
  if (seg.mode === "TRANSIT") {
    const stepPath = getStepPath(seg.step);
    if (stepPath?.length) return stepPath;
  }
  return getRouteOverviewPath(seg.route);
}

function isWalkingMode(mode) {
  const m = String(mode ?? "").toUpperCase();
  return m === "WALK" || m === "WALKING";
}

function optionSegmentParts(option) {
  const out = [];
  const segs = option?.segments ?? [];
  segs.forEach((seg) => {
    if (!seg || seg.mode === "WAIT") return;
    const path = getSegmentPath(seg);
    if (!path?.length) return;
    out.push({ mode: seg.mode ?? null, path });
  });
  return out;
}

function optionNonWalkingPaths(option) {
  const parts = optionSegmentParts(option);
  const nonWalking = parts.filter((p) => !isWalkingMode(p.mode)).map((p) => p.path);
  if (nonWalking.length) return nonWalking;
  return parts.map((p) => p.path);
}

// Keep per-polyline vertex counts bounded so we never hand Google a path with
// thousands of points (which can hard-hang on some machines / Maps JS builds).
const MAX_PATH_POINTS_DRAW = 900;
const MAX_ALT_SEGS_PER_OPTION = 18;
const MAX_OCCUPIED_SEGS_FOR_MASK = 2200;

function thinOccupiedSegsForMask(segs) {
  const list = Array.isArray(segs) ? segs : [];
  if (list.length <= MAX_OCCUPIED_SEGS_FOR_MASK) return list;
  const step = Math.ceil(list.length / MAX_OCCUPIED_SEGS_FOR_MASK);
  const out = [];
  for (let i = 0; i < list.length; i += step) out.push(list[i]);
  if (out.length > MAX_OCCUPIED_SEGS_FOR_MASK) out.length = MAX_OCCUPIED_SEGS_FOR_MASK;
  return out;
}

export function optionCombinedPath(option) {
  const segs = option?.segments ?? [];
  const out = [];

  for (const seg of segs) {
    if (seg?.mode === "WAIT") continue;

    const p = getSegmentPath(seg);

    if (!p?.length) continue;

    if (!out.length) out.push(...p);
    else out.push(...p.slice(1));
  }

  return out;
}

export function clearHybridPolylines(hybridPolylinesRef) {
  (hybridPolylinesRef.current ?? []).forEach((p) => {
    try {
      p.setMap(null);
    } catch {
      // ignore
    }
  });
  hybridPolylinesRef.current = [];
}

export function clearHybridAlternates(hybridAltPolylinesRef, hybridAltListenersRef) {
  (hybridAltListenersRef.current ?? []).forEach((l) => {
    try {
      l?.remove?.();
    } catch {
      // ignore
    }
  });
  hybridAltListenersRef.current = [];

  (hybridAltPolylinesRef.current ?? []).forEach((p) => {
    try {
      p.setMap(null);
    } catch {
      // ignore
    }
  });
  hybridAltPolylinesRef.current = [];
}

export function clearHybridStopMarkers(hybridStopMarkersRef) {
  (hybridStopMarkersRef.current ?? []).forEach((m) => {
    try {
      m.setMap(null);
    } catch {
      // ignore
    }
  });
  hybridStopMarkersRef.current = [];
}

export function drawHybridStopsForOption({ map, hybridStopMarkersRef }, option) {
  clearHybridStopMarkers(hybridStopMarkersRef);
  if (!map || !option) return;

  const segs = option?.segments ?? [];
  const stops = [];

  segs.forEach((seg) => {
    if (seg?.mode !== "TRANSIT") return;

    const td = getTransitDetailsFromStep(seg?.step);
    const dep = td?.departure_stop ?? td?.departureStop;
    const arr = td?.arrival_stop ?? td?.arrivalStop;
    const depLL = dep?.location;
    const arrLL = arr?.location;

    if (depLL) stops.push(depLL);
    if (arrLL) stops.push(arrLL);
  });

  // De-dup by rounding coordinates.
  const seen = new Set();
  const unique = [];
  for (const s of stops) {
    const lat = s?.lat?.() ?? s?.lat;
    const lng = s?.lng?.() ?? s?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ lat, lng });
  }

  unique.forEach((pos) => {
    try {
      const m = new window.google.maps.Marker({
        map,
        position: pos,
        clickable: false,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 4,
          fillColor: "#FFFFFF",
          fillOpacity: 1,
          strokeColor: "#000000",
          strokeOpacity: 0.55,
          strokeWeight: 1,
        },
        zIndex: 45,
      });
      hybridStopMarkersRef.current.push(m);
    } catch {
      // ignore
    }
  });
}

export function drawHybridOption(
  {
    map,
    hybridPolylinesRef,
    hybridAltPolylinesRef,
    addShadowPolyline,
    registerPolylineBase,
  },
  option,
  { isAlt = false, zIndex = 20, skipMicroIndices = null } = {}
) {
  if (!map || !option) return;

  const segs = option?.segments ?? [];

  segs.forEach((seg, idx) => {
    if (seg?.mode === "WAIT") return;

    const isMicro = seg?.mode !== "TRANSIT";
    if (
      isMicro &&
      (skipMicroIndices?.has?.(idx) || skipMicroIndices?.includes?.(idx))
    )
      return;

    const path0 = getSegmentPath(seg);

    const path = limitPathPoints(path0, MAX_PATH_POINTS_DRAW);

    if (!path?.length) return;

    let style;
    if (seg?.mode === "TRANSIT") {
      const td = getTransitDetailsFromStep(seg?.step);
      const lineColor = getTransitLineColor(td, DEFAULT_TRANSIT_BLUE);
      style = {
        strokeColor: lineColor,
        strokeOpacity: 1,
        strokeWeight: 8,
      };
    } else {
      style = polylineStyleForMode(seg?.mode, { isAlt });
    }

    const shadow = addShadowPolyline({
      path,
      strokeWeight: style?.strokeWeight ?? 8,
      zIndex,
      isAlt,
      skip: styleIsDotted(style),
    });

    if (shadow) (isAlt ? hybridAltPolylinesRef : hybridPolylinesRef).current.push(shadow);

    const poly = new window.google.maps.Polyline({
      map,
      path: limitPathPoints(path, MAX_PATH_POINTS_DRAW),
      clickable: false,
      ...style,
      zIndex,
    });

    registerPolylineBase(poly);
    (isAlt ? hybridAltPolylinesRef : hybridPolylinesRef).current.push(poly);
  });
}

export function drawHybridAlternates(
  {
    map,
    hybridAltPolylinesRef,
    hybridAltListenersRef,
    addShadowPolyline,
    registerPolylineBase,
  },
  options,
  selectedIdx,
  onSelectRoute
) {
  if (!map) return;

  clearHybridAlternates(hybridAltPolylinesRef, hybridAltListenersRef);

  const opts = options ?? [];
  if (opts.length <= 1) return;

  const ALT_OPACITY = 0.6;
  const ALT_WEIGHT = 8;
  const thresholdPx = overlapMaskThresholdPx(ALT_WEIGHT);
  const pz = getProjectionAndZoom(map);

  // Selected option occupies space first; alternates will be clipped under it.
  let occupiedSegs = [];
  if (pz) {
    const selectedOpt = opts?.[selectedIdx];
    const occPaths = optionNonWalkingPaths(selectedOpt);
    occupiedSegs = thinOccupiedSegsForMask(buildOccupiedSegmentsPx(occPaths, pz.proj, pz.zoom));
  }

  opts.forEach((opt, idx) => {
    if (idx === selectedIdx) return;

    const segs = (opt?.segments ?? []).slice(0, MAX_ALT_SEGS_PER_OPTION);
    const zIndex = 12 - idx;
    const routeOccChunks = [];

    segs.forEach((seg) => {
      if (seg?.mode === "WAIT") return;

      const rawPath0 = getSegmentPath(seg);

      const rawPath = limitPathPoints(rawPath0, MAX_PATH_POINTS_DRAW);

      if (!rawPath?.length) return;

      const isWalking = isWalkingMode(seg?.mode);
      const chunks =
        pz && !isWalking
          ? visibleChunksMasked(
              rawPath,
              thinOccupiedSegsForMask(occupiedSegs),
              pz.proj,
              pz.zoom,
              thresholdPx,
              OVERLAP_MASK_PARALLEL_DOT_MIN,
              false
            )
          : [rawPath];
      if (!chunks.length) return;

      chunks.forEach((chunk) => {
        let style;
        if (seg?.mode === "TRANSIT") {
          const td = getTransitDetailsFromStep(seg?.step);
          const lineColor = getTransitLineColor(td, HYBRID_STYLES.ALT_GRAY);
          style = {
            strokeColor: lineColor,
            strokeOpacity: ALT_OPACITY,
            strokeWeight: ALT_WEIGHT,
          };
        } else {
          style = polylineStyleForMode(seg?.mode, { isAlt: true });
          style = {
            ...style,
            strokeOpacity: ALT_OPACITY,
            strokeWeight: ALT_WEIGHT,
            strokeColor: style.strokeColor ?? HYBRID_STYLES.ALT_GRAY,
          };
        }

        const shadow = addShadowPolyline({
          path: chunk,
          strokeWeight: style?.strokeWeight ?? ALT_WEIGHT,
          zIndex,
          isAlt: true,
          skip: styleIsDotted(style),
        });
        if (shadow) hybridAltPolylinesRef.current.push(shadow);

        const poly = new window.google.maps.Polyline({
          map,
          path: limitPathPoints(chunk, MAX_PATH_POINTS_DRAW),
          clickable: true,
          ...style,
          zIndex,
        });

        const listener = poly.addListener("click", () => {
          onSelectRoute?.(idx);
        });

        registerPolylineBase(poly);
        hybridAltPolylinesRef.current.push(poly);
        hybridAltListenersRef.current.push(listener);
      });

      if (!isWalking) routeOccChunks.push(...chunks);
    });

    if (pz && routeOccChunks.length) {
      occupiedSegs = thinOccupiedSegsForMask([
        ...occupiedSegs,
        ...buildOccupiedSegmentsPx(routeOccChunks, pz.proj, pz.zoom),
      ]);
    }
  });
}
