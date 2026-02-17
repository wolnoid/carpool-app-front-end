import { toLatLngLiteral } from "../maps/googleUtils";

const FERRY_MAX_WAIT_MS = 35 * 60 * 1000;
const FERRY_EARLY_TOLERANCE_MS = 8 * 60 * 1000;
const TRANSIT_CHECK_TIMEOUT_MS = 12000;
const CACHE_TIME_BUCKET_MIN = 15;
const CACHE_COORD_PRECISION = 5;

function validDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function coerceDate(v) {
  if (!v) return null;
  try {
    if (v instanceof Date) return validDate(v) ? v : null;
    if (typeof v === "number") {
      const d = new Date(v);
      return validDate(d) ? d : null;
    }
    if (typeof v === "string") {
      const d = new Date(v);
      return validDate(d) ? d : null;
    }
    if (typeof v === "object" && "value" in v) return coerceDate(v.value);
    if (typeof v === "object" && "time" in v) return coerceDate(v.time);
  } catch {
    // ignore
  }
  return null;
}

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTransitDetails(step) {
  return step?.transitDetails ?? step?.transit ?? step?.transit_details ?? null;
}

function isFerryVehicleType(type) {
  return /\bferry\b/i.test(String(type ?? ""));
}

function isFerryStep(step) {
  if (!step) return false;

  const td = getTransitDetails(step);
  const vehicleType =
    td?.line?.vehicle?.type ??
    td?.line?.vehicle?.name ??
    td?.vehicle?.type ??
    td?.vehicle?.name ??
    "";
  if (isFerryVehicleType(vehicleType)) return true;

  if (isFerryVehicleType(step?.maneuver)) return true;

  const text = stripHtml(step?.instructions ?? step?.html_instructions ?? step?.html ?? "");
  if (/\bferry\b/i.test(text)) return true;

  return false;
}

function flattenSteps(steps) {
  const out = [];
  for (const step of steps ?? []) {
    const nested = Array.isArray(step?.steps) && step.steps.length ? step.steps : [step];
    for (const sub of nested) out.push(sub);
  }
  return out;
}

function routeDurationSec(route) {
  const legs = route?.legs ?? [];
  return legs.reduce((sum, leg) => sum + (leg?.duration?.value ?? 0), 0);
}

function computeRouteStartTime(route, transitTime, now) {
  const safeNow = validDate(now) ? now : new Date();
  const kind = String(transitTime?.kind ?? "NOW");
  const tDate = coerceDate(transitTime?.date);

  if (kind === "DEPART_AT" && tDate) return tDate;
  if (kind === "ARRIVE_BY" && tDate) {
    return new Date(tDate.getTime() - routeDurationSec(route) * 1000);
  }
  return safeNow;
}

function toCoordToken(v) {
  if (!Number.isFinite(v)) return "x";
  return Number(v).toFixed(CACHE_COORD_PRECISION);
}

function latLngToken(ll) {
  return ll ? `${toCoordToken(ll.lat)},${toCoordToken(ll.lng)}` : "none";
}

function bucketTimeMs(ms) {
  const bucketMs = CACHE_TIME_BUCKET_MIN * 60 * 1000;
  return Math.floor(ms / bucketMs) * bucketMs;
}

function buildFerrySegments(route, routeStartTime) {
  const out = [];
  const startMs = validDate(routeStartTime) ? routeStartTime.getTime() : NaN;
  let elapsedSec = 0;

  const legs = route?.legs ?? [];
  for (const leg of legs) {
    const steps = flattenSteps(leg?.steps ?? []);
    for (const step of steps) {
      if (isFerryStep(step)) {
        const origin = toLatLngLiteral(step?.start_location);
        const destination = toLatLngLiteral(step?.end_location);
        if (origin && destination) {
          const expectedDeparture = Number.isFinite(startMs)
            ? new Date(startMs + elapsedSec * 1000)
            : new Date();
          out.push({ origin, destination, expectedDeparture });
        }
      }
      const stepSec = Number(step?.duration?.value ?? 0);
      if (Number.isFinite(stepSec) && stepSec > 0) elapsedSec += stepSec;
    }
  }

  return out;
}

async function routeTransitOnce(ds, req) {
  return await new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err, res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(res);
    };

    const timer = setTimeout(() => {
      finish(new Error("Transit ferry check timed out"));
    }, TRANSIT_CHECK_TIMEOUT_MS);

    try {
      const maybePromise = ds.route(req, (result, status) => {
        const ok = status === "OK" || status === (globalThis?.google?.maps?.DirectionsStatus?.OK ?? "OK");
        if (ok) finish(null, result);
        else finish(new Error(`Transit ferry check failed: ${status}`));
      });

      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(
          (res) => finish(null, res),
          (err) => finish(err)
        );
      }
    } catch (err) {
      finish(err);
    }
  });
}

function hasNearTimeFerryStep(transitResult, expectedDeparture) {
  const expectedMs = validDate(expectedDeparture) ? expectedDeparture.getTime() : NaN;
  let sawFerry = false;
  let sawTimedFerry = false;

  const routes = transitResult?.routes ?? [];
  for (const route of routes) {
    for (const leg of route?.legs ?? []) {
      for (const step of flattenSteps(leg?.steps ?? [])) {
        if (!isFerryStep(step)) continue;
        sawFerry = true;

        const td = getTransitDetails(step);
        const departure =
          coerceDate(td?.departure_time) ??
          coerceDate(step?.departure_time) ??
          coerceDate(leg?.departure_time);

        if (!validDate(departure) || !Number.isFinite(expectedMs)) continue;
        sawTimedFerry = true;

        // Accept ferries that depart close to when the bike/skate route reaches the ferry.
        // We allow small negative skew for ETA noise, but reject clearly missed departures.
        const deltaMs = departure.getTime() - expectedMs;
        if (deltaMs < -FERRY_EARLY_TOLERANCE_MS) continue;
        if (deltaMs <= FERRY_MAX_WAIT_MS) return true;
      }
    }
  }

  // If transit has ferry legs but no usable schedule times, we cannot validate service.
  if (sawFerry && !sawTimedFerry) return false;
  return false;
}

async function hasMatchingNearTimeFerry({ ds, segment, cache }) {
  const expected = validDate(segment?.expectedDeparture) ? segment.expectedDeparture : new Date();
  const key = `${latLngToken(segment?.origin)}>${latLngToken(segment?.destination)}@${bucketTimeMs(
    expected.getTime()
  )}`;

  if (cache?.has(key)) return cache.get(key);

  const req = {
    origin: segment.origin,
    destination: segment.destination,
    travelMode: "TRANSIT",
    provideRouteAlternatives: true,
    transitOptions: { departureTime: expected },
  };

  let ok = false;
  try {
    const transitResult = await routeTransitOnce(ds, req);
    ok = hasNearTimeFerryStep(transitResult, expected);
  } catch {
    ok = false;
  }

  if (cache) cache.set(key, ok);
  return ok;
}

export async function filterRoutesByFerrySchedule({ ds, routes, transitTime, now = new Date() }) {
  const routeList = Array.isArray(routes) ? routes : [];
  if (!ds || !routeList.length) return routeList;

  const cache = new Map();
  const kept = [];

  for (const route of routeList) {
    const startTime = computeRouteStartTime(route, transitTime, now);
    const ferrySegments = buildFerrySegments(route, startTime);

    if (!ferrySegments.length) {
      kept.push(route);
      continue;
    }

    let allSegmentsMatched = true;
    for (const segment of ferrySegments) {
      const ok = await hasMatchingNearTimeFerry({ ds, segment, cache });
      if (!ok) {
        allSegmentsMatched = false;
        break;
      }
    }

    if (allSegmentsMatched) kept.push(route);
  }

  return kept;
}
