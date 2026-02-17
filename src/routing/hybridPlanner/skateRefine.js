// Split from src/routing/hybridPlanner.js
import { SKATE_MPS_FLAT, SKATE_MPS_CAP, SKATE_UPHILL_COLLAPSE_DEG, WALK_MPS } from "./utils";

export async function refineSkateSegmentsWithElevation({ option }) {
  if (!option?.segments?.length) return option;
  const hasSkate = option.segments.some((s) => s.mode === "SKATE" && s.route);
  if (!hasSkate) return option;

  const { ElevationService } = await window.google.maps.importLibrary("elevation");
  const { computeDistanceBetween } = window.google.maps.geometry.spherical;

  const es = new ElevationService();

  const segs = await Promise.all(
    option.segments.map(async (seg) => {
      if (seg.mode !== "SKATE" || !seg.route) return seg;
      const path = seg.route?.overview_path ?? [];
      if (!path.length) return seg;

      // Sample elevation along the path
      const samples = Math.min(48, Math.max(12, Math.round(path.length / 2)));
      const elev = await es.getElevationAlongPath({ path, samples });
      const results = elev?.results ?? [];
      if (results.length < 2) return seg;

      let sec = 0;
      for (let i = 0; i < results.length - 1; i++) {
        const a = results[i];
        const b = results[i + 1];
        const dist = computeDistanceBetween(a.location, b.location) || 0;
        const dz = (b.elevation ?? 0) - (a.elevation ?? 0);
        const gradeRad = dist > 0 ? Math.atan2(dz, dist) : 0;
        const gradeDeg = (gradeRad * 180) / Math.PI;

        // Conservative speed model
        let speed = SKATE_MPS_FLAT;
        if (gradeDeg >= 0) {
          const t = Math.min(1, gradeDeg / SKATE_UPHILL_COLLAPSE_DEG);
          speed = SKATE_MPS_FLAT + (WALK_MPS - SKATE_MPS_FLAT) * t;
        } else {
          const t = Math.min(1, Math.abs(gradeDeg) / 8);
          speed = SKATE_MPS_FLAT + (SKATE_MPS_CAP - SKATE_MPS_FLAT) * t;
        }

        sec += dist / Math.max(0.1, speed);
      }

      return { ...seg, seconds: sec };
    })
  );

  const durationSec = segs.reduce((s, x) => s + (x.seconds ?? 0), 0);
  const distanceMeters = segs.reduce((s, x) => s + (x.distanceMeters ?? 0), 0);
  const departTime = option.departTime;
  const arriveTime = departTime ? new Date(departTime.getTime() + durationSec * 1000) : option.arriveTime;

  return { ...option, segments: segs, durationSec, distanceMeters, arriveTime };
}

