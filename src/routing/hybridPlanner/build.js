// Split from src/routing/hybridPlanner.js
import { ROUTE_COMBO } from "../routeCombos";
import { filterRoutesByFerrySchedule } from "../ferrySchedule";
import {
  coerceDate,
  compressFirstStopWait,
  firstTransitStep,
  fmtDistanceMeters,
  fmtDurationSec,
  fmtTime,
  getLegDeparture,
  getTransitDetailsFromStep,
  isTaxingDirect,
  microAccessSecondsToStop,
  routeTotals,
  routeOnce,
  routeSignature,
  skateSecondsFromGoogleBikeSeconds,
  skateSecondsFromWalkSeconds,
  walkAccessSecondsToFirstTransit,
} from "./utils";

export async function buildHybridOptions({
  ds,
  origin,
  destination,
  transitTime,
  combo,
  maxOptions = 6,
}) {
  const kind = transitTime?.kind ?? "NOW";
  const tDate = transitTime?.date instanceof Date && !Number.isNaN(transitTime.date.getTime()) ? transitTime.date : null;
  const now = new Date();

  const accessCache = new Map();

  // ----------------------------------
  // Direct SKATE-only options (no transit)
  // ----------------------------------
  // For SKATE mode, we intentionally do NOT request transit routes.
  // We compare WALKING vs BICYCLING geometries, convert each to skateboard time
  // using assumed speeds, and return the fastest options.
  if (combo === ROUTE_COMBO.SKATE) {
    const bikeReq = {
      origin,
      destination,
      travelMode: "BICYCLING",
      provideRouteAlternatives: true,
      avoidFerries: true,
    };
    const walkReq = {
      origin,
      destination,
      travelMode: "WALKING",
      // Some regions may ignore alternatives for walking; that's fine.
      provideRouteAlternatives: true,
      avoidFerries: true,
    };

    let bikeResult = null;
    let walkResult = null;
    try {
      bikeResult = await routeOnce(ds, bikeReq);
    } catch {
      // If bicycling directions are unavailable here, we still try walking-based skate fallback.
    }
    try {
      walkResult = await routeOnce(ds, walkReq);
    } catch {
      // If walking directions are unavailable here, we may still have bicycling-based skate fallback.
    }

    let bikeRoutes = bikeResult?.routes ?? [];
    let walkRoutes = walkResult?.routes ?? [];

    if (bikeRoutes.length) {
      bikeRoutes = await filterRoutesByFerrySchedule({
        ds,
        routes: bikeRoutes,
        transitTime,
        now,
      });
    }
    if (walkRoutes.length) {
      walkRoutes = await filterRoutesByFerrySchedule({
        ds,
        routes: walkRoutes,
        transitTime,
        now,
      });
    }

    const opts = [];

    function addSkateOption(route, result, geometryMode) {
      if (!route) return;
      const { dist, dur } = routeTotals(route);
      const sec = geometryMode === "WALKING"
        ? skateSecondsFromWalkSeconds(dur)
        : skateSecondsFromGoogleBikeSeconds(dur);

      const start =
        kind === "ARRIVE_BY" && tDate
          ? new Date(tDate.getTime() - sec * 1000)
          : kind === "DEPART_AT" && tDate
            ? tDate
            : now;
      const arrive = new Date(start.getTime() + sec * 1000);

      opts.push({
        kind: "DIRECT_SKATE",
        baseRoute: route,
        baseResult: result,
        departTime: start,
        arriveTime: arrive,
        distanceMeters: dist,
        durationSec: sec,
        summary: route?.summary ?? "Skate",
        segments: [
          {
            mode: "SKATE",
            seconds: sec,
            distanceMeters: dist,
            route,
            directionsResult: result,
            skateGeometryMode: geometryMode,
          },
        ],
      });
    }

    // Prefer multiple bike alternatives (they tend to include useful trail/greenway variants).
    for (const r of bikeRoutes.slice(0, 4)) addSkateOption(r, bikeResult, "BICYCLING");

    // Include the best walking geometry as an additional candidate.
    if (walkRoutes?.[0]) addSkateOption(walkRoutes[0], walkResult, "WALKING");

    // Sort + cap (same rules as below).
    const targetArrive = kind === "ARRIVE_BY" && tDate ? tDate : null;
    if (kind === "ARRIVE_BY" && targetArrive) {
      opts.sort((a, b) => {
        const aOk = a.arriveTime && a.arriveTime <= targetArrive;
        const bOk = b.arriveTime && b.arriveTime <= targetArrive;
        if (aOk !== bOk) return aOk ? -1 : 1;
        const aDep = a.departTime?.getTime?.() ?? 0;
        const bDep = b.departTime?.getTime?.() ?? 0;
        if (aDep !== bDep) return bDep - aDep;
        const aDur = a.durationSec ?? 0;
        const bDur = b.durationSec ?? 0;
        if (aDur !== bDur) return aDur - bDur;
        const aArr = a.arriveTime?.getTime?.() ?? 0;
        const bArr = b.arriveTime?.getTime?.() ?? 0;
        return bArr - aArr;
      });
    } else {
      opts.sort((a, b) => {
        const aArr = a.arriveTime?.getTime?.() ?? (a.departTime?.getTime?.() ?? 0) + a.durationSec * 1000;
        const bArr = b.arriveTime?.getTime?.() ?? (b.departTime?.getTime?.() ?? 0) + b.durationSec * 1000;
        if (aArr !== bArr) return aArr - bArr;
        const aDep = a.departTime?.getTime?.() ?? 0;
        const bDep = b.departTime?.getTime?.() ?? 0;
        if (aDep !== bDep) return bDep - aDep;
        return (a.durationSec ?? 0) - (b.durationSec ?? 0);
      });
    }

    const capped = opts.slice(0, Math.max(1, maxOptions));

    return capped.map((o, idx) => {
      const durationText = fmtDurationSec(o.durationSec);
      const distanceText = fmtDistanceMeters(o.distanceMeters);
      const summary = o.summary;
      const departTimeText = o.departTime ? fmtTime(o.departTime) : "";
      const arriveTimeText = o.arriveTime ? fmtTime(o.arriveTime) : "";
      const timeRangeText = departTimeText && arriveTimeText ? `${departTimeText}–${arriveTimeText}` : "";
      return {
        ...o,
        index: idx,
        durationText,
        distanceText,
        summary,
        departTimeText,
        arriveTimeText,
        timeRangeText,
        sidebarSegments: [{ mode: "SKATE", durationText }],
      };
    });
  }

  // Transit alternatives
  const transitReq = {
    origin,
    destination,
    travelMode: "TRANSIT",
    provideRouteAlternatives: true,
  };

  if (kind === "ARRIVE_BY" && tDate) transitReq.transitOptions = { arrivalTime: tDate };
  else if (kind === "DEPART_AT" && tDate) transitReq.transitOptions = { departureTime: tDate };

  // --- Transit alternatives (optionally 2-pass in DEPART_AT to surface earlier vehicles
  //     that become reachable when the access leg is BIKE/SKATE instead of WALK).
  let transitResult1 = null;
  let transitCandidates = [];
  try {
    transitResult1 = await routeOnce(ds, transitReq);
    const transitRoutes1 = transitResult1?.routes ?? [];
    transitCandidates = transitRoutes1.map((r) => ({ route: r, result: transitResult1 }));
  } catch {
    // Transit can be unavailable for a valid trip. Keep going so direct bike/skate options can render.
    transitResult1 = null;
    transitCandidates = [];
  }

  if (kind === "DEPART_AT" && tDate && (combo === ROUTE_COMBO.TRANSIT_BIKE || combo === ROUTE_COMBO.TRANSIT_SKATE) && transitCandidates.length) {
    // Compute how much faster micro-mobility is vs Google's walking-to-first-stop,
    // then back-shift the query by that delta to surface earlier departures.
    let maxDeltaSec = 0;
    const sample = transitCandidates.slice(0, Math.min(4, transitCandidates.length));

    for (const cand of sample) {
      const tr = cand.route;
      const walkAccessSec = walkAccessSecondsToFirstTransit(tr);
      const ft = firstTransitStep(tr);
      const stopLoc = ft?.step?.start_location ?? null;
      if (!stopLoc || !Number.isFinite(walkAccessSec) || walkAccessSec <= 0) continue;

      const microSec = await microAccessSecondsToStop({
        ds,
        origin,
        stopLoc,
        combo,
        cache: accessCache,
      });

      if (!Number.isFinite(microSec) || microSec <= 0) continue;
      const delta = walkAccessSec - microSec;
      if (delta > maxDeltaSec) maxDeltaSec = delta;
    }

    // Only worth a second query if micro access materially beats walking.
    if (maxDeltaSec >= 60) {
      const BUFFER_SEC = 60;
      const CAP_SEC = 25 * 60;
      const shiftSec = Math.min(CAP_SEC, Math.ceil(maxDeltaSec + BUFFER_SEC));

      const earlier = new Date(tDate.getTime() - shiftSec * 1000);
      const clampedEarlier = earlier < now ? now : earlier;

      const transitReq2 = {
        ...transitReq,
        transitOptions: { departureTime: clampedEarlier },
      };

      try {
        const transitResult2 = await routeOnce(ds, transitReq2);
        const transitRoutes2 = transitResult2?.routes ?? [];

        const seen = new Set(transitCandidates.map((c) => routeSignature(c.route)));
        // Put earlier-query routes first so they have a chance to be expanded.
        const merged = [];
        for (const r of transitRoutes2) {
          const sig = routeSignature(r);
          if (seen.has(sig)) continue;
          seen.add(sig);
          merged.push({ route: r, result: transitResult2 });
        }
        transitCandidates = [...merged, ...transitCandidates];
      } catch {
        // ignore (fallback to 1-pass)
      }
    }
  }

  // Direct bike alternatives (for BIKE and TRANSIT_BIKE) and as an input to direct skate.
  const bikeReq = {
    origin,
    destination,
    travelMode: "BICYCLING",
    provideRouteAlternatives: true,
  };
  let bikeResult = null;
  try {
    bikeResult = await routeOnce(ds, bikeReq);
  } catch {
    // Keep going; walk-based skate or transit-based options may still exist.
  }
  let bikeRoutes = bikeResult?.routes ?? [];
  if (bikeRoutes.length) {
    bikeRoutes = await filterRoutesByFerrySchedule({
      ds,
      routes: bikeRoutes,
      transitTime,
      now,
    });
  }

  // Direct walk (for direct skate candidate)
  const walkReq = {
    origin,
    destination,
    travelMode: "WALKING",
    provideRouteAlternatives: false,
  };
  let walkResult = null;
  try {
    walkResult = await routeOnce(ds, walkReq);
  } catch {
    // Keep going; bike/transit options may still exist.
  }
  let walkRoute = walkResult?.routes?.[0] ?? null;
  if (walkRoute) {
    const filteredWalkRoutes = await filterRoutesByFerrySchedule({
      ds,
      routes: [walkRoute],
      transitTime,
      now,
    });
    walkRoute = filteredWalkRoutes[0] ?? null;
  }

  const options = [];

  // Helper to create a simplified segments view for the sidebar.
  const toSidebarSegments = (segments) =>
    segments
      .filter((s) => s.mode !== "WAIT")
      .map((s) => ({ mode: s.mode, durationText: fmtDurationSec(s.seconds) }));

  // Direct no-transit options
  const directBikeCandidates = bikeRoutes.slice(0, 3).map((r) => {
    const { dist, dur } = routeTotals(r);
    const start = kind === "ARRIVE_BY" && tDate ? new Date(tDate.getTime() - dur * 1000) : kind === "DEPART_AT" && tDate ? tDate : now;
    const arrive = new Date(start.getTime() + dur * 1000);
    return {
      kind: "DIRECT_BIKE",
      baseRoute: r,
      baseResult: bikeResult,
      departTime: start,
      arriveTime: arrive,
      distanceMeters: dist,
      durationSec: dur,
      summary: r?.summary ?? "Bike",
      segments: [
        {
          mode: "BIKE",
          seconds: dur,
          distanceMeters: dist,
          route: r,
          directionsResult: bikeResult,
        },
      ],
    };
  });

  const directSkateCandidate = (() => {
    const bikeTop = directBikeCandidates[0];
    const walkTot = walkRoute ? routeTotals(walkRoute) : { dist: 0, dur: Infinity };
    const walkSkateSec = skateSecondsFromWalkSeconds(walkTot.dur);
    const bikeSkateSec = bikeTop ? skateSecondsFromGoogleBikeSeconds(bikeTop.durationSec) : Infinity;

    const hasBike = Number.isFinite(bikeSkateSec);
    const hasWalk = Number.isFinite(walkSkateSec);
    if (!hasBike && !hasWalk) return null;

    const useBike = hasBike && (!hasWalk || bikeSkateSec <= walkSkateSec);
    const dist = useBike ? bikeTop?.distanceMeters ?? 0 : walkTot.dist;
    const sec = useBike ? bikeSkateSec : walkSkateSec;
    const start = kind === "ARRIVE_BY" && tDate ? new Date(tDate.getTime() - sec * 1000) : kind === "DEPART_AT" && tDate ? tDate : now;
    const arrive = new Date(start.getTime() + sec * 1000);

    return {
      kind: "DIRECT_SKATE",
      departTime: start,
      arriveTime: arrive,
      distanceMeters: dist,
      durationSec: sec,
      summary: "Skate",
      segments: [
        {
          mode: "SKATE",
          seconds: sec,
          distanceMeters: dist,
          route: useBike ? bikeTop?.baseRoute ?? null : walkRoute,
          directionsResult: useBike ? bikeResult : walkResult,
          // Indicates which Google mode geometry we used for skating
          skateGeometryMode: useBike ? "BICYCLING" : "WALKING",
        },
      ],
    };
  })();

  // Build hybrid options from transit alternatives.
  // We don't fully expand all 6 transit alternatives to avoid an explosion of micro queries.
  // We'll expand up to 4, then rely on direct options to fill the list to 6.
  // We don't fully expand all transit alternatives to avoid an explosion of micro queries.
  const expandTransitLimit = Math.min(transitCandidates.length, 4);

  for (let i = 0; i < expandTransitLimit; i++) {
    const cand = transitCandidates[i];
    const tr = cand?.route;
    const baseResult = cand?.result ?? transitResult1;
    const legs = tr?.legs ?? [];
    if (!legs.length) continue;

    const tripStart = getLegDeparture(tr, kind === "DEPART_AT" && tDate ? tDate : now) ?? (kind === "DEPART_AT" && tDate ? tDate : now);
    let currentTime = new Date(tripStart);

    const segments = [];
    let totalDist = 0;
    let totalSec = 0;

    // Only supports single-leg routes for now (Google often returns 1 leg anyway).
    const stepList = legs[0]?.steps ?? [];

    for (const step of stepList) {
      const mode = step?.travel_mode;
      if (mode === "WALKING") {
        const o = step.start_location;
        const d = step.end_location;

        // Query both walk + bike so cyclists can walk bikes, and skaters can use both geometries.
        const [walkRes, bikeResLeg] = await Promise.all([
          routeOnce(ds, { origin: o, destination: d, travelMode: "WALKING", provideRouteAlternatives: false }),
          routeOnce(ds, { origin: o, destination: d, travelMode: "BICYCLING", provideRouteAlternatives: false }),
        ]);

        const wRoute = walkRes?.routes?.[0] ?? null;
        const bRoute = bikeResLeg?.routes?.[0] ?? null;
        const w = wRoute ? routeTotals(wRoute) : { dist: 0, dur: Infinity };
        const b = bRoute ? routeTotals(bRoute) : { dist: 0, dur: Infinity };

        if (combo === ROUTE_COMBO.TRANSIT_BIKE) {
          const useBike = b.dur <= w.dur;
          const chosen = useBike ? bRoute : wRoute;
          const chosenRes = useBike ? bikeResLeg : walkRes;
          const chosenDur = useBike ? b.dur : w.dur;
          const chosenDist = useBike ? b.dist : w.dist;
          segments.push({
            mode: useBike ? "BIKE" : "WALK",
            seconds: chosenDur,
            distanceMeters: chosenDist,
            route: chosen,
            directionsResult: chosenRes,
          });
          totalSec += chosenDur;
          totalDist += chosenDist;
          currentTime = new Date(currentTime.getTime() + chosenDur * 1000);
          continue;
        }

        // TRANSIT_SKATE
        const wSkate = skateSecondsFromWalkSeconds(w.dur);
        const bSkate = skateSecondsFromGoogleBikeSeconds(b.dur);
        const useBike = bSkate <= wSkate;
        const chosen = useBike ? bRoute : wRoute;
        const chosenRes = useBike ? bikeResLeg : walkRes;
        const chosenSec = useBike ? bSkate : wSkate;
        const chosenDist = useBike ? b.dist : w.dist;

        segments.push({
          mode: "SKATE",
          seconds: chosenSec,
          distanceMeters: chosenDist,
          route: chosen,
          directionsResult: chosenRes,
          skateGeometryMode: useBike ? "BICYCLING" : "WALKING",
        });
        totalSec += chosenSec;
        totalDist += chosenDist;
        currentTime = new Date(currentTime.getTime() + chosenSec * 1000);
        continue;
      }

      if (mode === "TRANSIT") {
        const td = getTransitDetailsFromStep(step);
        const dep = coerceDate(td?.departure_time);
        const arr = coerceDate(td?.arrival_time);

        if (dep && currentTime < dep) {
          const waitSec = (dep.getTime() - currentTime.getTime()) / 1000;
          if (waitSec > 20) {
            segments.push({ mode: "WAIT", seconds: waitSec, distanceMeters: 0, atStop: td?.departure_stop });
            totalSec += waitSec;
            currentTime = dep;
          }
        }

        const dur = step?.duration?.value ?? (arr && dep ? (arr.getTime() - dep.getTime()) / 1000 : 0);
        const dist = step?.distance?.value ?? 0;
        segments.push({
          mode: "TRANSIT",
          seconds: dur,
          distanceMeters: dist,
          transitDetails: td ?? null,
          step,
          // Fallback geometry source if step.path is missing in some Maps payloads.
          route: tr,
          directionsResult: baseResult,
        });
        totalSec += dur;
        totalDist += dist;
        currentTime = new Date(currentTime.getTime() + dur * 1000);
        continue;
      }

      // Fallback: keep Google's estimate for any other step type.
      const dur = step?.duration?.value ?? 0;
      const dist = step?.distance?.value ?? 0;
      segments.push({ mode: "OTHER", seconds: dur, distanceMeters: dist, step });
      totalSec += dur;
      totalDist += dist;
      currentTime = new Date(currentTime.getTime() + dur * 1000);
    }

    const departTime = tripStart;
    const arriveTime = currentTime;

    let opt = {
      kind: "HYBRID",
      baseRoute: tr,
      baseResult,
      departTime,
      arriveTime,
      distanceMeters: totalDist,
      durationSec: totalSec,
      summary: tr?.summary ?? "Transit",
      segments,
      sidebarSegments: toSidebarSegments(segments),
    };

    // Critical: After swapping WALK steps for BIKE/SKATE micro legs, update the trip start time
    // so we don't show "leave earlier just to wait at the first stop".
    opt = compressFirstStopWait({ option: opt, transitTime, now });
    opt.sidebarSegments = toSidebarSegments(opt.segments);
    options.push(opt);
  }

  // Include direct option unless taxing AND we already have enough other options.
  // Even if taxing, include it if we need it to fill the list to maxOptions.
  const addDirectBike = combo === ROUTE_COMBO.TRANSIT_BIKE || combo === ROUTE_COMBO.BIKE;
  const addDirectSkate = combo === ROUTE_COMBO.TRANSIT_SKATE || combo === ROUTE_COMBO.SKATE;

  if (addDirectBike) {
    for (const cand of directBikeCandidates) {
      const taxing = isTaxingDirect(cand.distanceMeters, cand.durationSec);
      if (!taxing || options.length < maxOptions - 1) options.push(cand);
      if (options.length >= maxOptions) break;
    }
  } else if (addDirectSkate) {
    if (directSkateCandidate && Number.isFinite(directSkateCandidate.durationSec)) {
      const taxing = isTaxingDirect(directSkateCandidate.distanceMeters, directSkateCandidate.durationSec);
      if (!taxing || options.length < maxOptions - 1) options.push(directSkateCandidate);
    }
  }

  // Sorting
  const targetArrive = kind === "ARRIVE_BY" && tDate ? tDate : null;
  if (kind === "ARRIVE_BY" && targetArrive) {
    options.sort((a, b) => {
      const aOk = a.arriveTime && a.arriveTime <= targetArrive;
      const bOk = b.arriveTime && b.arriveTime <= targetArrive;
      if (aOk !== bOk) return aOk ? -1 : 1;
      const aDep = a.departTime?.getTime?.() ?? 0;
      const bDep = b.departTime?.getTime?.() ?? 0;
      if (aDep !== bDep) return bDep - aDep; // latest departure first
      const aDur = a.durationSec ?? 0;
      const bDur = b.durationSec ?? 0;
      if (aDur !== bDur) return aDur - bDur; // shortest duration first (your preference)
      const aArr = a.arriveTime?.getTime?.() ?? 0;
      const bArr = b.arriveTime?.getTime?.() ?? 0;
      return bArr - aArr; // if still tied, arrive as late as possible
    });
  } else {
    options.sort((a, b) => {
      const aArr = a.arriveTime?.getTime?.() ?? (a.departTime?.getTime?.() ?? 0) + a.durationSec * 1000;
      const bArr = b.arriveTime?.getTime?.() ?? (b.departTime?.getTime?.() ?? 0) + b.durationSec * 1000;
      if (aArr !== bArr) return aArr - bArr;
      const aDep = a.departTime?.getTime?.() ?? 0;
      const bDep = b.departTime?.getTime?.() ?? 0;
      if (aDep !== bDep) return bDep - aDep; // latest departure first (tie-break)
      return (a.durationSec ?? 0) - (b.durationSec ?? 0);
    });
  }

  // Cap final list
  const capped = options.slice(0, Math.max(1, maxOptions));

  // Normalize indices + sidebar segments
  return capped.map((o, idx) => {
    const durationText = fmtDurationSec(o.durationSec);
    const distanceText = fmtDistanceMeters(o.distanceMeters);
    const summary = o.summary;
    const departTimeText = o.departTime ? fmtTime(o.departTime) : "";
    const arriveTimeText = o.arriveTime ? fmtTime(o.arriveTime) : "";
    const timeRangeText = departTimeText && arriveTimeText ? `${departTimeText}–${arriveTimeText}` : "";
    return {
      ...o,
      index: idx,
      durationText,
      distanceText,
      summary,
      departTimeText,
      arriveTimeText,
      timeRangeText,
      sidebarSegments: o.sidebarSegments ?? toSidebarSegments(o.segments ?? []),
    };
  });
}

// Elevation-based refinement for SKATE segments (selected route only).
// Conservative recreational model:
// - Downhill boosts up to 10 mph
// - Uphill slows
// - At >= 8° uphill, clamp to walking speed
