import { latLngToNums, toLatLngLiteral } from "../../maps/googleUtils";
import { haversineMeters, routeDistanceMeters } from "./geo";

function asPathArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    if (typeof raw.getArray === "function") {
      const arr = raw.getArray();
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    // ignore
  }
  try {
    if (typeof raw.getLength === "function" && typeof raw.getAt === "function") {
      const len = raw.getLength();
      if (!Number.isFinite(len) || len <= 0) return [];
      const out = [];
      for (let i = 0; i < len; i++) out.push(raw.getAt(i));
      return out;
    }
  } catch {
    // ignore
  }
  try {
    const arr = Array.from(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function computeAdaptiveFitPadding(map, { tight = false } = {}) {
  const mapDiv = map?.getDiv?.();
  const rect = mapDiv?.getBoundingClientRect?.();
  const mapW = rect?.width ?? 800;

  // Base padding scales with map width.
  // Tight mode is used when focusing a single route.
  const frac = tight ? 0.07 : 0.08;
  const basePad = Math.max(20, Math.min(60, Math.round(mapW * frac)));

  // If the map starts near the window left edge, sidebar is probably overlaying the map.
  const sidebarLikelyOverlaying = (rect?.left ?? 9999) < 40;
  const leftPad = sidebarLikelyOverlaying
    ? Math.max(basePad, Math.min(380, Math.round(mapW * 0.35)))
    : basePad;

  return {
    padding: { top: basePad, right: basePad, bottom: basePad, left: leftPad },
    mapW,
  };
}

export function fitPathInView(map, path, { tight = false } = {}) {
  if (!map || !path?.length) return;

  const bounds = new window.google.maps.LatLngBounds();
  let hasAny = false;

  for (const p of path) {
    const n = latLngToNums(p);
    if (!n) continue;
    if (Math.abs(n.lat) > 89.999 || Math.abs(n.lng) > 180) continue;
    bounds.extend(n);
    hasAny = true;
  }

  if (!hasAny) return;
  const { padding } = computeAdaptiveFitPadding(map, { tight });
  map.fitBounds(bounds, padding);
}

export function getRouteOverviewPath(route) {
  const direct = asPathArray(route?.overview_path);
  if (direct.length) return direct;

  const pts = route?.overview_polyline?.points;
  if (pts && window.google?.maps?.geometry?.encoding?.decodePath) {
    try {
      return asPathArray(window.google.maps.geometry.encoding.decodePath(pts));
    } catch {
      // ignore
    }
  }
  return [];
}

export function fitAllRoutesInView(map, directions, selectedIdx = 0) {
  if (!map) return;

  const routes = directions?.routes ?? [];
  if (!routes.length) return;

  const mapDiv = map.getDiv?.();
  const rect = mapDiv?.getBoundingClientRect?.();
  const mapW = rect?.width ?? 800;

  // Base padding scales with map width (24–60px)
  const basePad = Math.max(24, Math.min(60, Math.round(mapW * 0.08)));

  // If the map starts near the window left edge, sidebar is probably overlaying the map.
  const sidebarLikelyOverlaying = (rect?.left ?? 9999) < 40;

  // If overlay: allow larger left pad but clamp hard so half-screen doesn’t explode.
  // If NOT overlay (your flex layout): keep left pad small.
  const leftPad = sidebarLikelyOverlaying
    ? Math.max(basePad, Math.min(380, Math.round(mapW * 0.35)))
    : basePad;

  const padding = { top: basePad, right: basePad, bottom: basePad, left: leftPad };

  // Outlier rejection (avoid random far-away points widening bounds)
  const selectedRoute = routes[selectedIdx] ?? routes[0];
  const approxMeters = routeDistanceMeters(selectedRoute) || 0;

  const startLL = toLatLngLiteral(selectedRoute?.legs?.[0]?.start_location);
  const endLL = toLatLngLiteral(
    selectedRoute?.legs?.[(selectedRoute?.legs?.length ?? 1) - 1]?.end_location
  );

  const outlierThreshold =
    approxMeters > 0 ? Math.max(approxMeters * 2.0, 100000) : 200000; // 100km min

  const bounds = new window.google.maps.LatLngBounds();
  let hasAny = false;

  for (const r of routes) {
    const path = getRouteOverviewPath(r);
    if (!path?.length) continue;

    for (const p of path) {
      const n = latLngToNums(p);
      if (!n) continue;
      if (Math.abs(n.lat) > 89.999 || Math.abs(n.lng) > 180) continue;

      if (startLL && endLL) {
        const d1 = haversineMeters(n, startLL);
        const d2 = haversineMeters(n, endLL);
        if (d1 > outlierThreshold && d2 > outlierThreshold) continue;
      }

      bounds.extend(n);
      hasAny = true;
    }
  }

  if (!hasAny && startLL && endLL) {
    bounds.extend(startLL);
    bounds.extend(endLL);
    hasAny = true;
  }
  if (!hasAny) return;

  map.fitBounds(bounds, padding);

  // Clamp “too far out” for short-ish trips, especially on narrow maps
  if (approxMeters > 0 && approxMeters < 250000) {
    const minZoom = mapW < 700 ? 10 : 9;

    const once = window.google.maps.event.addListenerOnce(map, "idle", () => {
      try {
        const z = map.getZoom?.();
        if (Number.isFinite(z) && z < minZoom) map.setZoom(minZoom);
      } catch {
        // ignore
      }
    });

    setTimeout(() => {
      try {
        once?.remove?.();
      } catch {
        // ignore
      }
    }, 5000);
  }
}
