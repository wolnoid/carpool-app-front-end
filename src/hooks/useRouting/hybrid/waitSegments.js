import { getTransitDetailsFromStep } from "../polylineStyles";
import { fmtDistanceMeters, fmtDurationSec, fmtTime } from "./format";

function coerceDate(x) {
  if (!x) return null;

  // Google TransitDetails often provide { value: secondsSinceEpoch }
  const v = x?.value;
  if (Number.isFinite(v)) {
    const d = new Date(v * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (x instanceof Date) return Number.isNaN(x.getTime()) ? null : x;

  try {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function rebuildWaitSegments(option, inputSegments) {
  const segs = inputSegments ?? option?.segments ?? [];
  const out = [];
  let totalSec = 0;
  let totalDist = 0;

  let currentTime = option?.departTime instanceof Date ? new Date(option.departTime) : null;

  for (const seg of segs) {
    if (!seg || seg.mode === "WAIT") continue;

    if (seg.mode === "TRANSIT") {
      const dep =
        coerceDate(seg.transitDetails?.departure_time) ??
        coerceDate(getTransitDetailsFromStep(seg.step)?.departure_time);

      // Determine when we actually start this transit segment in our stitched timeline.
      // If we arrive before the scheduled departure, we insert an explicit WAIT.
      // If we arrive after the scheduled departure, we assume we catch the next feasible run
      // (we don't re-query schedules yet), so we don't allow time to go backwards.
      let transitStart = currentTime;

      if (currentTime && dep) {
        if (currentTime < dep) {
          const waitSec = (dep.getTime() - currentTime.getTime()) / 1000;
          if (waitSec > 20) {
            out.push({
              mode: "WAIT",
              seconds: waitSec,
              distanceMeters: 0,
              atStop: seg.transitDetails?.departure_stop,
            });
            totalSec += waitSec;
          }
          transitStart = dep;
        } else {
          transitStart = currentTime;
        }
      }

      out.push(seg);
      totalSec += seg.seconds ?? 0;
      totalDist += seg.distanceMeters ?? 0;

      if (transitStart) {
        currentTime = new Date(transitStart.getTime() + (seg.seconds ?? 0) * 1000);
      }

      continue;
    }

    out.push(seg);
    totalSec += seg.seconds ?? 0;
    totalDist += seg.distanceMeters ?? 0;
    if (currentTime) currentTime = new Date(currentTime.getTime() + (seg.seconds ?? 0) * 1000);
  }

  const departTime = option?.departTime;
  const arriveTime = currentTime ?? option?.arriveTime;

  const departTimeText = departTime ? fmtTime(departTime) : "";
  const arriveTimeText = arriveTime ? fmtTime(arriveTime) : "";
  const timeRangeText =
    departTimeText && arriveTimeText ? `${departTimeText}–${arriveTimeText}` : "";

  return {
    ...option,
    segments: out,
    durationSec: totalSec,
    distanceMeters: totalDist,
    arriveTime,
    durationText: fmtDurationSec(totalSec),
    distanceText: fmtDistanceMeters(totalDist),
    departTimeText,
    arriveTimeText,
    timeRangeText,
  };
}

export { coerceDate };
