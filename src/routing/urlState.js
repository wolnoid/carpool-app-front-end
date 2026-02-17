import { ROUTE_COMBO } from "./routeCombos";

export const ROUTE_URL_VERSION = "1";
const COORD_PRECISION = 6;
const ONE_HOUR_MS = 60 * 60 * 1000;

export const SEARCH_TRIGGER = Object.freeze({
  EXPLICIT_GET_DIRECTIONS: "EXPLICIT_GET_DIRECTIONS",
  EXPLICIT_CONTEXT_SET_FROM: "EXPLICIT_CONTEXT_SET_FROM",
  EXPLICIT_CONTEXT_SET_TO: "EXPLICIT_CONTEXT_SET_TO",
  EXPLICIT_MARKER_SET_FROM: "EXPLICIT_MARKER_SET_FROM",
  EXPLICIT_MARKER_SET_TO: "EXPLICIT_MARKER_SET_TO",
  ADJUSTMENT_DETOUR_DRAG_END: "ADJUSTMENT_DETOUR_DRAG_END",
  ADJUSTMENT_DETOUR_REMOVE: "ADJUSTMENT_DETOUR_REMOVE",
  AUTORUN: "AUTORUN",
});

const PUSH_TRIGGERS = new Set([
  SEARCH_TRIGGER.EXPLICIT_GET_DIRECTIONS,
  SEARCH_TRIGGER.EXPLICIT_CONTEXT_SET_FROM,
  SEARCH_TRIGGER.EXPLICIT_CONTEXT_SET_TO,
  SEARCH_TRIGGER.EXPLICIT_MARKER_SET_FROM,
  SEARCH_TRIGGER.EXPLICIT_MARKER_SET_TO,
]);

const REPLACE_TRIGGERS = new Set([
  SEARCH_TRIGGER.ADJUSTMENT_DETOUR_DRAG_END,
  SEARCH_TRIGGER.ADJUSTMENT_DETOUR_REMOVE,
  SEARCH_TRIGGER.AUTORUN,
]);

const MODE_SET = new Set(Object.values(ROUTE_COMBO));

function validDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

export function coerceRouteMode(mode) {
  return MODE_SET.has(mode) ? mode : ROUTE_COMBO.TRANSIT;
}

export function historyModeForTrigger(triggerType) {
  if (PUSH_TRIGGERS.has(triggerType)) return "push";
  if (REPLACE_TRIGGERS.has(triggerType)) return "replace";
  return "replace";
}

export function isValidLatLng(ll) {
  if (!ll) return false;
  const lat = Number(ll.lat);
  const lng = Number(ll.lng);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function fmtCoord(value, precision = COORD_PRECISION) {
  if (!Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(precision));
  return Number.isFinite(rounded) ? String(rounded) : null;
}

export function latLngToQueryValue(ll, precision = COORD_PRECISION) {
  if (!isValidLatLng(ll)) return null;
  const lat = fmtCoord(Number(ll.lat), precision);
  const lng = fmtCoord(Number(ll.lng), precision);
  if (!lat || !lng) return null;
  return `${lat},${lng}`;
}

export function parseLatLngQueryValue(raw) {
  if (!raw || typeof raw !== "string") return null;
  const [a, b] = raw.split(",");
  if (a == null || b == null) return null;
  const lat = Number(a.trim());
  const lng = Number(b.trim());
  const ll = { lat, lng };
  return isValidLatLng(ll) ? ll : null;
}

export function formatLocalDateTime(date) {
  if (!validDate(date)) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function parseLocalDateTime(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (!validDate(d)) return null;

  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute
  ) {
    return null;
  }

  return d;
}

function addLocalCalendarDays(date, days) {
  const out = new Date(date.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

export function normalizeWhenForExecution(rawWhen, now = new Date()) {
  const safeNow = validDate(now) ? now : new Date();
  const normalizedDefault = {
    kind: "NOW",
    date: null,
    raw: rawWhen ?? null,
    normalized: false,
    valid: true,
  };

  if (!rawWhen || rawWhen === "now") return normalizedDefault;

  const m = String(rawWhen).match(/^(depart|arrive)@(.+)$/);
  if (!m) return normalizedDefault;

  const kind = m[1] === "depart" ? "DEPART_AT" : "ARRIVE_BY";
  const parsed = parseLocalDateTime(m[2]);
  if (!validDate(parsed)) {
    return { ...normalizedDefault, valid: false };
  }

  const threshold = safeNow.getTime() - ONE_HOUR_MS;
  if (parsed.getTime() >= threshold) {
    return { kind, date: parsed, raw: rawWhen, normalized: false, valid: true };
  }

  const candidateToday = new Date(
    safeNow.getFullYear(),
    safeNow.getMonth(),
    safeNow.getDate(),
    parsed.getHours(),
    parsed.getMinutes(),
    0,
    0
  );
  const candidate =
    candidateToday.getTime() <= threshold
      ? addLocalCalendarDays(candidateToday, 1)
      : candidateToday;

  return {
    kind,
    date: candidate,
    raw: rawWhen,
    normalized: true,
    valid: true,
  };
}

export function serializeWhenValue(when, { includeNow = true } = {}) {
  const kind = when?.kind;
  if (kind === "DEPART_AT" || kind === "ARRIVE_BY") {
    const date = validDate(when?.date) ? when.date : null;
    if (!date) return includeNow ? "now" : null;
    const prefix = kind === "DEPART_AT" ? "depart" : "arrive";
    const dt = formatLocalDateTime(date);
    return dt ? `${prefix}@${dt}` : includeNow ? "now" : null;
  }
  return includeNow ? "now" : null;
}

export function parseRoutingSearch(search, { now = new Date() } = {}) {
  const params = new URLSearchParams(search || "");
  const origin = parseLatLngQueryValue(params.get("o"));
  const destination = parseLatLngQueryValue(params.get("d"));
  const mode = coerceRouteMode(params.get("mode"));
  const via = params.getAll("via").map(parseLatLngQueryValue).filter(Boolean);
  const when = normalizeWhenForExecution(params.get("when"), now);

  const hillRaw = params.get("hill");
  const hill = Number.isFinite(Number(hillRaw)) ? Number(hillRaw) : null;

  return {
    version: params.get("v") ?? null,
    origin,
    destination,
    mode,
    via,
    when,
    hill,
    hasValidEndpoints: Boolean(origin && destination),
  };
}

export function buildRoutingSearch(state, { includeWhenNow = true } = {}) {
  const originToken = latLngToQueryValue(state?.origin);
  const destToken = latLngToQueryValue(state?.destination);
  if (!originToken || !destToken) return "";

  const mode = coerceRouteMode(state?.mode);
  const viaList = Array.isArray(state?.via)
    ? state.via
    : Array.isArray(state?.viaPoints)
      ? state.viaPoints
      : [];
  const whenValue = serializeWhenValue(state?.when ?? state?.transitTime, {
    includeNow: includeWhenNow,
  });
  const hillRaw = Number(state?.hill ?? state?.hillMaxDeg);
  const hill = Number.isFinite(hillRaw) ? Math.round(hillRaw) : null;

  const pairs = [
    `v=${ROUTE_URL_VERSION}`,
    `o=${originToken}`,
    `d=${destToken}`,
    `mode=${mode}`,
  ];

  viaList.forEach((p) => {
    const token = latLngToQueryValue(p);
    if (token) pairs.push(`via=${token}`);
  });

  if (whenValue) pairs.push(`when=${whenValue}`);
  if (hill != null) pairs.push(`hill=${hill}`);

  return `?${pairs.join("&")}`;
}
