// src/routing/routeFormat.js

export function formatDurationSec(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function formatDistanceMeters(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  const mi = meters / 1609.344;
  return mi >= 10 ? `${mi.toFixed(0)} mi` : `${mi.toFixed(1)} mi`;
}

export function formatTime(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function addSeconds(date, seconds) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  if (!Number.isFinite(seconds)) return new Date(date);
  return new Date(date.getTime() + seconds * 1000);
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function asDate(x) {
  if (!x) return null;
  if (x instanceof Date) return x;
  if (x?.value instanceof Date) return x.value;
  if (typeof x === "number") {
    // Heuristic: if it looks like seconds-since-epoch, convert.
    return x < 10_000_000_000 ? new Date(x * 1000) : new Date(x);
  }
  return null;
}

// --- Transit formatting helpers ---
// Used by both the routes pane and the details view.
const AGENCY_ALIASES = [
  { re: /Bay Area Rapid Transit/i, alias: "BART" },
  { re: /San Francisco Municipal Transportation Agency/i, alias: "Muni" },
  { re: /SFMTA/i, alias: "Muni" },
  { re: /Sacramento Regional Transit/i, alias: "SacRT" },
  { re: /Sacramento Regional Transit District/i, alias: "SacRT" },
  { re: /Los Angeles County Metropolitan Transportation Authority/i, alias: "LA Metro" },
  { re: /Metropolitan Transportation Authority/i, alias: "MTA" },
  { re: /Washington Metropolitan Area Transit Authority/i, alias: "WMATA" },
  { re: /Port Authority Trans-Hudson/i, alias: "PATH" },
  { re: /Massachusetts Bay Transportation Authority/i, alias: "MBTA" },
  { re: /Chicago Transit Authority/i, alias: "CTA" },
  { re: /San Mateo County Transit District/i, alias: "SamTrans" },
  { re: /Santa Clara Valley Transportation Authority/i, alias: "VTA" },
  { re: /Caltrain/i, alias: "Caltrain" },
  { re: /Amtrak/i, alias: "Amtrak" },
];

export function shortTransitAgencyName(name) {
  const s = String(name || "").trim();
  if (!s) return "";

  // Already looks like an alias (e.g., BART, MBTA)
  if (s.length <= 8 && /^[A-Z0-9&.-]+$/.test(s)) return s;

  for (const { re, alias } of AGENCY_ALIASES) {
    if (re.test(s)) return alias;
  }

  // If the name has a parenthetical short form, prefer it.
  const m = s.match(/\(([^)]+)\)\s*$/);
  if (m && m[1] && m[1].trim().length <= 10) return m[1].trim();

  return s;
}
