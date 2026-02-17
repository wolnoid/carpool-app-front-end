import { getTransitDetailsFromStep } from "../polylineStyles";
import { coerceDate, rebuildWaitSegments } from "./waitSegments";

function maxDate(a, b) {
  if (a && b) return a > b ? a : b;
  return a ?? b ?? null;
}

function getMinAllowedDepartTime(transitTimeRef) {
  const t = transitTimeRef?.current;
  const now = new Date();
  const dt = t?.date instanceof Date && !Number.isNaN(t.date.getTime()) ? t.date : null;
  if (t?.kind === "DEPART_AT" && dt) return dt;
  // ARRIVE_BY has no minimum requested depart time, but we still can’t depart in the past.
  return now;
}

function computeAccessSecondsToFirstTransit(segs) {
  let sec = 0;
  for (const s of segs ?? []) {
    if (!s || s.mode === "WAIT") continue;
    if (s.mode === "TRANSIT") break;
    sec += s.seconds ?? 0;
  }
  return sec;
}

function findFirstTransitDeparture(segs) {
  for (const s of segs ?? []) {
    if (!s || s.mode !== "TRANSIT") continue;
    const dep =
      coerceDate(s.transitDetails?.departure_time) ??
      coerceDate(getTransitDetailsFromStep(s.step)?.departure_time);
    return { dep, seg: s };
  }
  return { dep: null, seg: null };
}

// Shift the overall trip departTime so we arrive at the first transit stop right at scheduled departure.
// Returns { option, missed, departTime }.
export function applyRecommendedDepartShift(option, transitTimeRef) {
  const segs = option?.segments ?? [];
  const { dep } = findFirstTransitDeparture(segs);
  if (!dep) return { option, missed: false, departTime: option?.departTime ?? null };

  const accessSec = computeAccessSecondsToFirstTransit(segs);
  const minAllowed = getMinAllowedDepartTime(transitTimeRef);

  const recommended = new Date(dep.getTime() - accessSec * 1000);
  const departTime = maxDate(minAllowed, recommended);

  const arrivalAtStop = new Date(departTime.getTime() + accessSec * 1000);
  const bufferMs = 30 * 1000;
  const missed = arrivalAtStop.getTime() > dep.getTime() + bufferMs;

  if (missed) return { option, missed: true, departTime };

  const shifted = rebuildWaitSegments({ ...option, departTime }, segs);
  return { option: shifted, missed: false, departTime };
}
