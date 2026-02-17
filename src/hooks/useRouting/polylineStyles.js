export const DEFAULT_TRANSIT_BLUE = "#4285F4";

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

export function decodeStepPath(step) {
  try {
    const direct = asPathArray(step?.path);
    if (direct.length) return direct;

    const decoded = window.google?.maps?.geometry?.encoding?.decodePath?.(
      step?.polyline?.points ?? ""
    );
    return asPathArray(decoded);
  } catch {
    return [];
  }
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

export function routeHasTransitSteps(route) {
  const legs = route?.legs ?? [];
  for (const leg of legs) {
    const steps = leg?.steps ?? [];
    for (const s of steps) {
      if (s?.travel_mode === "TRANSIT") return true;
    }
  }
  return false;
}

export function getTransitDetailsFromStep(step) {
  const td = step?.transit ?? step?.transit_details ?? step?.transitDetails ?? null;
  if (!td) return null;

  // Normalize some shapes across APIs.
  const line = td?.line ?? td?.transit_line ?? null;
  const vehicle = line?.vehicle ?? td?.vehicle ?? null;
  const shortName = line?.short_name ?? line?.shortName ?? td?.short_name ?? td?.shortName;
  const name = line?.name ?? td?.name;
  const color = line?.color ?? td?.color;

  return {
    ...td,
    line: line ?? td?.line,
    vehicle: vehicle ?? td?.vehicle,
    short_name: shortName,
    name,
    color,
  };
}

export function normalizeHexColor(raw) {
  if (!raw) return null;

  // Some feeds use 0xRRGGBB.
  if (typeof raw === "number") {
    const hex = raw.toString(16).padStart(6, "0");
    return `#${hex}`;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // Handle 0xRRGGBB
  if (/^0x[0-9a-f]{6}$/i.test(s)) {
    return `#${s.slice(2)}`;
  }

  // Handle #RGB
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  }

  // Handle #RRGGBB
  if (/^#[0-9a-f]{6}$/i.test(s)) {
    return s.toUpperCase();
  }

  return null;
}

export function getTransitLineColor(td, fallback = DEFAULT_TRANSIT_BLUE) {
  if (!td) return fallback;

  const raw =
    td?.line?.color ??
    td?.line?.text_color ??
    td?.line?.textColor ??
    td?.color ??
    null;

  return normalizeHexColor(raw) || fallback;
}

export function dottedStyle({ color, scale = 2, repeat = "10px", strokeWeight = 8 }) {
  return {
    strokeOpacity: 0,
    strokeColor: color,
    strokeWeight,
    icons: [
      {
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale,
          fillColor: color,
          fillOpacity: 1,
          strokeOpacity: 0,
          strokeWeight: 0,
        },
        offset: "0",
        repeat,
      },
    ],
  };
}

export function styleIsDotted(style) {
  return Boolean(style?.icons?.length);
}
