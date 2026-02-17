import { decodeStepPath } from "../polylineStyles";
import { haversineMeters } from "../geo";
import { asSingleResult } from "./helpers";

function cloneWithDescriptors(obj) {
  if (!obj) return obj;
  try {
    return Object.create(
      Object.getPrototypeOf(obj),
      Object.getOwnPropertyDescriptors(obj)
    );
  } catch {
    try {
      return Object.assign(Object.create(Object.getPrototypeOf(obj)), obj);
    } catch {
      return obj;
    }
  }
}

// In hybrid modes we keep the main DirectionsRenderer around ONLY for Google's transit glyphs/labels.
// Unfortunately, Google also draws dotted WALK connectors for TRANSIT routes.
// To keep the transit glyphs while removing the walk dots, we feed the renderer a "transit-only"
// clone of the base route: remove WALK steps + rebuild overview_path from TRANSIT step geometry.
function buildTransitOnlyRouteForGlyphs(baseRoute) {
  try {
    const route = baseRoute;
    const legs = route?.legs ?? [];
    if (!legs.length) return route;

    const leg0 = legs[0];
    const steps = leg0?.steps ?? [];
    const transitSteps = steps.filter((s) => s?.travel_mode === "TRANSIT");
    if (!transitSteps.length) return route;

    // Build a path from TRANSIT steps only (removes all walking geometry).
    const outPath = [];
    for (const st of transitSteps) {
      const seg = decodeStepPath(st);
      if (!seg?.length) continue;
      if (!outPath.length) {
        outPath.push(...seg);
      } else {
        // Avoid duplicating the joint point if it matches.
        const last = outPath[outPath.length - 1];
        const first = seg[0];
        const joinDist = haversineMeters(last, first);
        if (Number.isFinite(joinDist) && joinDist < 0.75) outPath.push(...seg.slice(1));
        else outPath.push(...seg);
      }
    }

    const newLeg0 = cloneWithDescriptors(leg0);
    newLeg0.steps = transitSteps;

    // Align leg start/end so the renderer doesn't try to "helpfully" draw connectors.
    const firstT = transitSteps[0];
    const lastT = transitSteps[transitSteps.length - 1];
    if (firstT?.start_location) newLeg0.start_location = firstT.start_location;
    if (lastT?.end_location) newLeg0.end_location = lastT.end_location;

    // Update summary numbers (not strictly required for glyphs, but keeps things coherent).
    const dist = transitSteps.reduce((sum, s) => sum + (s?.distance?.value ?? 0), 0);
    const dur = transitSteps.reduce((sum, s) => sum + (s?.duration?.value ?? 0), 0);
    if (Number.isFinite(dist)) newLeg0.distance = { ...(newLeg0.distance ?? {}), value: dist };
    if (Number.isFinite(dur)) newLeg0.duration = { ...(newLeg0.duration ?? {}), value: dur };

    const newRoute = cloneWithDescriptors(route);
    newRoute.legs = [newLeg0, ...legs.slice(1)];

    if (outPath.length) {
      newRoute.overview_path = outPath;
      try {
        const enc = window.google?.maps?.geometry?.encoding?.encodePath;
        if (enc) {
          newRoute.overview_polyline = {
            ...(newRoute.overview_polyline ?? {}),
            points: enc(outPath),
          };
        }
      } catch {
        // ignore
      }
    }

    // Keep original bounds to avoid surprising viewport changes.
    newRoute.bounds = route.bounds;

    return newRoute;
  } catch {
    return baseRoute;
  }
}

export function syncHybridTransitGlyphs({
  option,
  seq,
  rendererRef,
  map,
  programmaticUpdateRef,
  isStaleSeq,
  hardResetMainRenderer,
  configureMainRendererForHybrid,
}) {
  const dr = rendererRef.current;
  if (!dr || !map) return;

  // Only HYBRID options have a TRANSIT base route/result.
  const baseResult = option?.baseResult;
  const baseRoute = option?.baseRoute;
  const hasTransit =
    option?.kind === "HYBRID" || Boolean(option?.segments?.some?.((s) => s?.mode === "TRANSIT"));

  if (!hasTransit || !baseResult || !baseRoute) {
    // Some Maps JS builds can leave transit glyphs behind unless we detach/reattach.
    hardResetMainRenderer({ reattach: true, clearPanel: true });
    configureMainRendererForHybrid();
    return;
  }

  configureMainRendererForHybrid();

  // Feed a single-route DirectionsResult to the renderer.
  // This preserves the transit "route shields"/labels on the map without us having to
  // reimplement them (and without showing Google's polylines).
  const glyphRoute = buildTransitOnlyRouteForGlyphs(baseRoute);
  const single = asSingleResult(baseResult, glyphRoute ?? baseRoute);

  // Guard against the main directions_changed handler.
  programmaticUpdateRef.current = true;
  try {
    dr.setDirections(single);
  } catch {
    // ignore
  }

  setTimeout(() => {
    if (!isStaleSeq(seq)) programmaticUpdateRef.current = false;
  }, 0);
}
