// Route details model builder extracted from DirectionsSidebar.jsx

import { MODE_META } from "../components/icons";
import {
  coerceDate,
  ferryLabelFromStep,
  flattenGoogleStepList,
  isFerryStep,
  segMinutes,
  transitLegLabel,
  transitModeWordFromType,
  transitServiceName,
  transitVehicleType,
} from "../utils/sidebarFormat";

function pushFerryTransitSegment({
  segments,
  step,
  durationSec,
  distanceMeters,
  startTime,
}) {
  const td = step?.transit || step?.transit_details || step?.transitDetails || null;
  const depT = startTime;
  const arrT = new Date(depT.getTime() + Math.max(0, durationSec) * 1000);
  const shortName = ferryLabelFromStep(step);

  const depStop =
    td?.departure_stop?.name ||
    td?.departure_stop?.short_name ||
    td?.departure_stop;
  const arrStop =
    td?.arrival_stop?.name ||
    td?.arrival_stop?.short_name ||
    td?.arrival_stop;

  const rawSteps = flattenGoogleStepList([step]);
  const steps =
    rawSteps.length > 0
      ? rawSteps
      : [
          {
            html: `Take <b>${shortName || "Ferry"}</b>`,
            distanceText: step?.distance?.text || "",
            durationText: step?.duration?.text || segMinutes(durationSec),
          },
        ];

  segments.push({
    id: `t-${segments.length}`,
    kind: "MOVE",
    mode: "TRANSIT",
    modeLabel: "Transit",
    durationSec: Math.max(0, durationSec),
    distanceMeters: Math.max(0, distanceMeters),
    startTime: depT,
    endTime: arrT,
    transit: {
      vehicle: "ferry",
      shortName: shortName || "Ferry",
      agency: transitServiceName(td),
      headsign: td?.headsign || "",
      depStop: depStop || "",
      arrStop: arrStop || "",
      numStops: td?.num_stops || td?.numStops || 0,
    },
    steps,
  });

  return arrT;
}

function buildRouteDetailsModel(option) {
  if (!option) return null;

  // Hybrid options already have segments in our internal shape.
  if (option?.segments) {
    const route = {
      totalDurationSec:
        option.durationSec ??
        (option.segments ?? []).reduce((s, seg) => s + (seg?.seconds ?? 0), 0),
      totalDistanceMeters:
        option.distanceMeters ??
        (option.segments ?? []).reduce((s, seg) => s + (seg?.distanceMeters ?? 0), 0),
      departureTime: coerceDate(option.departTime) || new Date(),
      arrivalTime: coerceDate(option.arriveTime) || null,
      segments: [],
    };

    let cursor = coerceDate(option.departTime) || new Date();

    (option.segments ?? []).forEach((seg, i) => {
      const mode = String(seg?.mode || "").toUpperCase();

      if (mode === "WAIT") {
        const dur = seg?.seconds ?? 0;
        const startTime = cursor;
        const endTime = new Date(startTime.getTime() + dur * 1000);
        cursor = endTime;
        route.segments.push({
          id: `wait-${i}`,
          kind: "WAIT",
          mode: "WAIT",
          modeLabel: MODE_META.WAIT.label,
          durationSec: dur,
          distanceMeters: 0,
          startTime,
          endTime,
          at: seg?.atStop?.name || seg?.atStop || "",
          steps: [],
        });
        return;
      }

      if (mode === "TRANSIT") {
        const td =
          seg?.transitDetails ||
          seg?.step?.transit ||
          seg?.step?.transit_details ||
          seg?.transit ||
          seg?.transit_details ||
          null;

        const depT = coerceDate(td?.departure_time) || cursor;
        const arrT =
          coerceDate(td?.arrival_time) ||
          new Date(depT.getTime() + (seg?.seconds ?? 0) * 1000);
        cursor = arrT;

        const shortName = transitLegLabel(seg?.step, td);
        const vType = transitVehicleType(td);
        const vehicleWord = transitModeWordFromType(vType);

        const depStop =
          td?.departure_stop?.name ||
          td?.departure_stop?.short_name ||
          td?.departure_stop;
        const arrStop =
          td?.arrival_stop?.name ||
          td?.arrival_stop?.short_name ||
          td?.arrival_stop;

        const steps = [];
        if (depStop) steps.push({ html: `Board at <b>${depStop}</b>`, distanceText: "", durationText: "" });
        steps.push({
          html: `Ride <b>${shortName || "Transit"}</b>${td?.headsign ? ` toward <b>${td.headsign}</b>` : ""}`,
          distanceText: "",
          durationText: td?.num_stops ? `${td.num_stops} stops` : segMinutes(seg?.seconds ?? 0),
        });
        if (arrStop) steps.push({ html: `Get off at <b>${arrStop}</b>`, distanceText: "", durationText: "" });

        route.segments.push({
          id: `t-${i}`,
          kind: "MOVE",
          mode: "TRANSIT",
          modeLabel: "Transit",
          durationSec: seg?.seconds ?? 0,
          distanceMeters: seg?.distanceMeters ?? 0,
          startTime: depT,
          endTime: arrT,
          transit: {
            vehicle: vehicleWord,
            shortName,
            agency: transitServiceName(td),
            headsign: td?.headsign || "",
            depStop: depStop || "",
            arrStop: arrStop || "",
            numStops: td?.num_stops || td?.numStops || 0,
          },
          steps,
        });
        return;
      }

      // WALK / BIKE / SKATE
      const meta = MODE_META[mode] || MODE_META.WALK;
      const leg = seg?.route?.legs?.[0];
      const rawSteps = leg?.steps ?? [];
      const hasFerry = rawSteps.some((st) => isFerryStep(st));

      if (!hasFerry) {
        const dur = seg?.seconds ?? 0;
        const startTime = cursor;
        const endTime = new Date(startTime.getTime() + dur * 1000);
        cursor = endTime;
        const steps = flattenGoogleStepList(rawSteps);

        route.segments.push({
          id: `m-${i}`,
          kind: "MOVE",
          mode,
          modeLabel: meta.label,
          durationSec: dur,
          distanceMeters: seg?.distanceMeters ?? 0,
          startTime,
          endTime,
          steps,
        });
        return;
      }

      const totalRawSec = rawSteps.reduce((sum, st) => sum + (st?.duration?.value ?? 0), 0);
      const targetSec = Number(seg?.seconds ?? 0);
      const scale =
        totalRawSec > 0 && Number.isFinite(targetSec) && targetSec > 0
          ? targetSec / totalRawSec
          : 1;

      let group = null;
      const flushGroup = () => {
        if (!group) return;
        route.segments.push(group);
        group = null;
      };

      for (const st of rawSteps) {
        const rawSec = Number(st?.duration?.value ?? 0);
        const dur = Number.isFinite(rawSec) ? rawSec * scale : 0;
        const dist = Number(st?.distance?.value ?? 0);

        if (isFerryStep(st)) {
          flushGroup();
          cursor = pushFerryTransitSegment({
            segments: route.segments,
            step: st,
            durationSec: dur,
            distanceMeters: dist,
            startTime: cursor,
          });
          continue;
        }

        if (!group) {
          group = {
            id: `m-${route.segments.length}`,
            kind: "MOVE",
            mode,
            modeLabel: meta.label,
            durationSec: 0,
            distanceMeters: 0,
            startTime: cursor,
            endTime: cursor,
            steps: [],
          };
        }

        group.durationSec += Number.isFinite(dur) ? dur : 0;
        group.distanceMeters += Number.isFinite(dist) ? dist : 0;
        group.steps.push(...flattenGoogleStepList([st]));
        group.endTime = new Date(group.startTime.getTime() + group.durationSec * 1000);
        cursor = group.endTime;
      }

      flushGroup();
    });

    if (!route.arrivalTime && route.segments.length) {
      route.arrivalTime = route.segments[route.segments.length - 1].endTime;
    }

    return route;
  }

  // Google (non-hybrid) route.
  const gRoute = option?.__route;
  if (!gRoute) return null;

  const legs = gRoute?.legs ?? [];
  const totalDurationSec =
    option.durationSec ?? legs.reduce((s, l) => s + (l?.duration?.value ?? 0), 0);
  const totalDistanceMeters =
    option.distanceMeters ?? legs.reduce((s, l) => s + (l?.distance?.value ?? 0), 0);

  let cursor =
    coerceDate(option.departTime) ||
    coerceDate(legs?.[0]?.departure_time) ||
    new Date();

  const departureTime = cursor;
  const segments = [];

  const WAIT_THRESHOLD_SEC = 60;

  for (const leg of legs) {
    const steps = leg?.steps ?? [];

    // Group consecutive non-transit steps
    let group = null;
    const flush = () => {
      if (!group) return;
      segments.push(group);
      group = null;
    };

    for (const st of steps) {
      const tm = String(st?.travel_mode || st?.travelMode || "WALK").toUpperCase();

      if (tm === "TRANSIT") {
        flush();
        const td = st?.transit || st?.transit_details || null;
        const depScheduled = coerceDate(td?.departure_time) || null;

        // Explicit waiting time before the scheduled departure.
        if (cursor && depScheduled) {
          const gapSec = Math.round((depScheduled.getTime() - cursor.getTime()) / 1000);
          if (gapSec >= WAIT_THRESHOLD_SEC) {
            segments.push({
              id: `w-${segments.length}`,
              kind: "WAIT",
              mode: "WAIT",
              modeLabel: MODE_META.WAIT.label,
              durationSec: gapSec,
              distanceMeters: 0,
              startTime: cursor,
              endTime: depScheduled,
              at: td?.departure_stop?.name || td?.departure_stop?.short_name || "",
              steps: [],
            });
            cursor = depScheduled;
          }
        }

        const depT = depScheduled || cursor;
        const arrT =
          coerceDate(td?.arrival_time) ||
          new Date(depT.getTime() + (st?.duration?.value ?? 0) * 1000);
        cursor = arrT;

        const shortName = transitLegLabel(st, td);
        const vType = transitVehicleType(td);
        const vehicleWord = transitModeWordFromType(vType);

        const depStop =
          td?.departure_stop?.name ||
          td?.departure_stop?.short_name ||
          td?.departure_stop;
        const arrStop =
          td?.arrival_stop?.name ||
          td?.arrival_stop?.short_name ||
          td?.arrival_stop;

        const pseudo = [];
        if (depStop) pseudo.push({ html: `Board at <b>${depStop}</b>`, distanceText: "", durationText: "" });
        pseudo.push({
          html: `Ride <b>${shortName || "Transit"}</b>${td?.headsign ? ` toward <b>${td.headsign}</b>` : ""}`,
          distanceText: "",
          durationText: td?.num_stops ? `${td.num_stops} stops` : (st?.duration?.text || ""),
        });
        if (arrStop) pseudo.push({ html: `Get off at <b>${arrStop}</b>`, distanceText: "", durationText: "" });

        segments.push({
          id: `t-${segments.length}`,
          kind: "MOVE",
          mode: "TRANSIT",
          modeLabel: "Transit",
          durationSec: st?.duration?.value ?? 0,
          distanceMeters: st?.distance?.value ?? 0,
          startTime: depT,
          endTime: arrT,
          transit: {
            vehicle: vehicleWord,
            shortName,
            agency: transitServiceName(td),
            headsign: td?.headsign || "",
            depStop: depStop || "",
            arrStop: arrStop || "",
            numStops: td?.num_stops || td?.numStops || 0,
          },
          steps: pseudo,
        });
        continue;
      }

      if (isFerryStep(st)) {
        flush();
        const dur = st?.duration?.value ?? 0;
        const dist = st?.distance?.value ?? 0;
        cursor = pushFerryTransitSegment({
          segments,
          step: st,
          durationSec: dur,
          distanceMeters: dist,
          startTime: cursor,
        });
        continue;
      }

      // Non-transit move (walk/bike)
      if (!group || group.mode !== tm) {
        flush();
        const meta = MODE_META[tm] || MODE_META.WALK;
        const startTime = cursor;
        group = {
          id: `m-${segments.length}`,
          kind: "MOVE",
          mode: tm,
          modeLabel: meta.label,
          durationSec: 0,
          distanceMeters: 0,
          startTime,
          endTime: startTime,
          steps: [],
        };
      }

      group.durationSec += st?.duration?.value ?? 0;
      group.distanceMeters += st?.distance?.value ?? 0;
      group.steps.push(...flattenGoogleStepList([st]));

      group.endTime = new Date(group.startTime.getTime() + group.durationSec * 1000);
      cursor = group.endTime;
    }

    flush();

    // Per-leg arrival_time can be more authoritative
    const legArr = coerceDate(leg?.arrival_time);
    if (legArr) cursor = legArr;
  }

  const arrivalTime =
    coerceDate(option.arriveTime) ||
    coerceDate(legs?.[legs.length - 1]?.arrival_time) ||
    (totalDurationSec
      ? new Date(departureTime.getTime() + totalDurationSec * 1000)
      : null);

  return {
    totalDurationSec,
    totalDistanceMeters,
    departureTime,
    arrivalTime,
    segments,
  };
}

export { buildRouteDetailsModel };
