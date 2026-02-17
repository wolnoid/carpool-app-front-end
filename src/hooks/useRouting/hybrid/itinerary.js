import { getTransitDetailsFromStep } from "../polylineStyles";
import { fmtDurationSec } from "./format";

export function getFirstLastMicroSegIndices(option) {
  const segs = option?.segments ?? [];
  let first = -1;
  let last = -1;

  segs.forEach((s, idx) => {
    if (!s) return;
    if (s.mode === "BIKE" || s.mode === "SKATE" || s.mode === "WALK") {
      if (first < 0) first = idx;
      last = idx;
    }
  });

  return { first, last };
}

export function itineraryForSidebar(option) {
  const segs = option?.segments ?? [];
  return segs
    .filter((seg) => seg)
    .map((seg) => {
      if (seg.mode === "TRANSIT") {
        const td = seg.transitDetails ?? getTransitDetailsFromStep(seg.step) ?? null;
        const line = td?.line;
        const name = line?.short_name || line?.name || "Transit";
        return { mode: name, durationText: fmtDurationSec(seg.seconds) };
      }
      if (seg.mode === "WAIT") {
        const stop = seg.atStop?.name;
        return {
          mode: stop ? `WAIT (${stop})` : "WAIT",
          durationText: fmtDurationSec(seg.seconds),
        };
      }
      return { mode: seg.mode, durationText: fmtDurationSec(seg.seconds) };
    });
}
