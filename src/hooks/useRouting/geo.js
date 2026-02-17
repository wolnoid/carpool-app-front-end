import { latLngToNums } from "../../maps/googleUtils";

// Safety caps
// Some Google routes (especially transit) can contain thousands of vertices.
// The overlap-masking logic is O(N*M) and can hard-hang the tab if we process
// very large inputs synchronously. We cap geometry sizes and gracefully fall
// back to simplified/unmasked output when inputs are too large.
const MAX_INPUT_POINTS = 1800; // per path before densify/masking
const MAX_DRAW_POINTS = 800; // per polyline chunk handed to Google
const MAX_DENSIFIED_POINTS = 5500;
const MAX_OCCUPIED_SEGS = 6500;
const MAX_MASK_POINT_SEG_OPS = 2000000;
const MAX_MASK_CHUNKS = 64;

export function limitPathPoints(path, maxPoints = MAX_DRAW_POINTS) {
  const pts = Array.isArray(path) ? path : [];
  if (pts.length <= maxPoints) return pts;
  const step = Math.ceil(pts.length / maxPoints);
  if (step <= 1) return pts;

  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function haversineMeters(a, b) {
  const A = latLngToNums(a);
  const B = latLngToNums(b);
  if (!A || !B) return Infinity;

  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(B.lat - A.lat);
  const dLng = toRad(B.lng - A.lng);
  const lat1 = toRad(A.lat);
  const lat2 = toRad(B.lat);

  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function routeDistanceMeters(route) {
  const legs = route?.legs ?? [];
  let sum = 0;
  for (const leg of legs) {
    const d = leg?.distance?.value;
    if (Number.isFinite(d)) sum += d;
  }
  if (sum > 0) return sum;

  const path = route?.overview_path ?? [];
  if (!path?.length) return 0;
  let dist = 0;
  for (let i = 1; i < path.length; i++) {
    dist += haversineMeters(path[i - 1], path[i]);
  }
  return dist;
}

export function getProjectionAndZoom(map) {
  try {
    const proj = map?.getProjection?.();
    const zoom = map?.getZoom?.();
    if (!proj || !Number.isFinite(zoom)) return null;
    return { proj, zoom };
  } catch {
    return null;
  }
}

export function toWorldPx(ll, proj, zoom) {
  const n = latLngToNums(ll);
  if (!n) return null;
  try {
    const latLngObj = new window.google.maps.LatLng(n.lat, n.lng);
    const pt = proj.fromLatLngToPoint(latLngObj);
    const scale = Math.pow(2, zoom);
    return { x: pt.x * scale, y: pt.y * scale };
  } catch {
    return null;
  }
}

export function distSqPointToSeg(p, a, b) {
  // Standard closest-point-on-segment distance in 2D.
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;

  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;

  const c2 = vx * vx + vy * vy;
  if (c2 <= 0.0000001) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;

  const t = Math.min(1, Math.max(0, c1 / c2));
  const px = a.x + t * vx;
  const py = a.y + t * vy;
  return (p.x - px) ** 2 + (p.y - py) ** 2;
}

export function densifyPath(path, maxStepMeters = 30) {
  const src = limitPathPoints(path, MAX_INPUT_POINTS);
  if (!Array.isArray(src) || src.length < 2) return src ?? [];

  const out = [];
  const spherical = window.google?.maps?.geometry?.spherical;
  const canInterp = typeof spherical?.interpolate === "function";

  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    if (i === 0) out.push(a);

    const A = latLngToNums(a);
    const B = latLngToNums(b);
    if (!A || !B) {
      out.push(b);
      continue;
    }

    const d = haversineMeters(A, B);
    if (!Number.isFinite(d) || d <= maxStepMeters) {
      out.push(b);
      continue;
    }

    const steps = Math.min(60, Math.ceil(d / maxStepMeters));
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      if (canInterp) {
        try {
          out.push(spherical.interpolate(a, b, f));
          continue;
        } catch {
          // fall through
        }
      }
      out.push({ lat: A.lat + (B.lat - A.lat) * f, lng: A.lng + (B.lng - A.lng) * f });
    }
    out.push(b);
  }

  return out.length > MAX_DENSIFIED_POINTS ? limitPathPoints(out, MAX_DENSIFIED_POINTS) : out;
}

export function buildOccupiedSegmentsPx(paths, proj, zoom) {
  const segs = [];
  (paths ?? []).forEach((raw) => {
    const limited = limitPathPoints(raw, MAX_INPUT_POINTS);
    const p = densifyPath(limited, 40);
    for (let i = 0; i < p.length - 1; i++) {
      const a = toWorldPx(p[i], proj, zoom);
      const b = toWorldPx(p[i + 1], proj, zoom);
      if (!a || !b) continue;
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      segs.push({ a, b, minX, maxX, minY, maxY });
      if (segs.length >= MAX_OCCUPIED_SEGS) return;
    }
  });
  return segs;
}

export function normalizeUnit(v) {
  const n = Math.hypot(v?.x ?? 0, v?.y ?? 0);
  if (!Number.isFinite(n) || n <= 1e-9) return null;
  return { x: v.x / n, y: v.y / n };
}

export function nearestOccupiedSeg(px, occupiedSegs, thresholdPx) {
  const t = thresholdPx;
  const tSq = t * t;
  let best = null;
  let bestD = Infinity;

  for (const s of occupiedSegs) {
    // cheap bbox reject
    if (px.x < s.minX - t || px.x > s.maxX + t || px.y < s.minY - t || px.y > s.maxY + t) continue;
    const d = distSqPointToSeg(px, s.a, s.b);
    if (d <= tSq && d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (!best) return null;
  return { seg: best, distSq: bestD };
}

export function isPointNearOccupied(
  px,
  dirUnit,
  occupiedSegs,
  thresholdPx,
  parallelDotMin = 0.78
) {
  const near = nearestOccupiedSeg(px, occupiedSegs, thresholdPx);
  if (!near) return false;
  const { seg: s, distSq } = near;

  // If we can't estimate direction, fall back to masking (conservative).
  if (!dirUnit) return true;

  const occDir = normalizeUnit({ x: s.b.x - s.a.x, y: s.b.y - s.a.y });
  if (!occDir) return true;

  // Prefer masking for roughly parallel paths.
  const dot = Math.abs(dirUnit.x * occDir.x + dirUnit.y * occDir.y);
  if (dot < parallelDotMin) {
    // For crossing geometry, keep most of the crossing visible but still mask
    // very close overlaps to prevent small bleed-through artifacts.
    const crossingMaskPx = Math.max(1.25, thresholdPx * 0.38);
    return distSq <= crossingMaskPx * crossingMaskPx;
  }

  return true;
}

export function visibleChunksMasked(
  path,
  occupiedSegs,
  proj,
  zoom,
  thresholdPx,
  parallelDotMin = 0.78,
  fallbackToUnmasked = true,
  retryDepth = 0
) {
  const occ = occupiedSegs ?? [];
  const fallbackPath = limitPathPoints(path, MAX_DRAW_POINTS);

  const retryOrFallback = () => {
    if (fallbackToUnmasked) return [fallbackPath];
    // In strict mode, progressively thin occupied segments before giving up.
    if (retryDepth >= 4 || occ.length <= 120) return [];
    const thinned = [];
    const step = 2;
    for (let i = 0; i < occ.length; i += step) thinned.push(occ[i]);
    return visibleChunksMasked(
      path,
      thinned,
      proj,
      zoom,
      thresholdPx,
      parallelDotMin,
      false,
      retryDepth + 1
    );
  };

  if (!occ.length) {
    return [fallbackPath];
  }
  if (occ.length > MAX_OCCUPIED_SEGS) {
    return retryOrFallback();
  }

  const limited = limitPathPoints(path, MAX_INPUT_POINTS);
  const dense = densifyPath(limited, 30);
  if (!dense.length) return [];

  // Precompute px coords (we need neighbors to estimate direction).
  const pts = [];
  const pxs = [];
  for (const pt of dense) {
    const px = toWorldPx(pt, proj, zoom);
    if (!px) continue;
    pts.push(pt);
    pxs.push(px);
  }
  if (pts.length < 2) return [];

  // Worst-case masking is O(points * occupiedSegments). If it gets too large,
  // skip masking entirely and draw a simplified route to keep the UI responsive.
  if (pts.length * occ.length > MAX_MASK_POINT_SEG_OPS) {
    return retryOrFallback();
  }

  const chunks = [];
  let cur = [];

  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    const px = pxs[i];

    const prev = pxs[i - 1] ?? px;
    const next = pxs[i + 1] ?? px;
    const dirUnit = normalizeUnit({ x: next.x - prev.x, y: next.y - prev.y });

    const hidden = isPointNearOccupied(px, dirUnit, occupiedSegs, thresholdPx, parallelDotMin);

    if (!hidden) {
      cur.push(pt);
    } else {
      if (cur.length >= 2) {
        chunks.push(cur);
        if (chunks.length > MAX_MASK_CHUNKS) {
          return retryOrFallback();
        }
      }
      cur = [];
    }
  }

  if (cur.length >= 2) {
    chunks.push(cur);
    if (chunks.length > MAX_MASK_CHUNKS) {
      return retryOrFallback();
    }
  }

  if (!chunks.length) return fallbackToUnmasked ? [limitPathPoints(limited, MAX_DRAW_POINTS)] : [];
  return chunks.map((c) => limitPathPoints(c, MAX_DRAW_POINTS));
}

// Small utility for the micro-leg drag guard.
export function pointSegDistSq(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;

  const c1 = wx * vx + wy * vy;
  if (c1 <= 0) return wx * wx + wy * wy;

  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    return dx * dx + dy * dy;
  }

  const t = c1 / c2;
  const px = a.x + t * vx;
  const py = a.y + t * vy;
  const dx = p.x - px;
  const dy = p.y - py;
  return dx * dx + dy * dy;
}

export function minDistSqToPath(p, pathPx) {
  if (!pathPx?.length) return Infinity;
  if (pathPx.length === 1) {
    const dx = p.x - pathPx[0].x;
    const dy = p.y - pathPx[0].y;
    return dx * dx + dy * dy;
  }
  let best = Infinity;
  for (let i = 0; i < pathPx.length - 1; i++) {
    const d = pointSegDistSq(p, pathPx[i], pathPx[i + 1]);
    if (d < best) best = d;
  }
  return best;
}
