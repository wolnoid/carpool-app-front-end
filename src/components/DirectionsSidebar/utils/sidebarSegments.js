// Segment-building helpers extracted from DirectionsSidebar.jsx

import { isBikeOn, isSkateOn } from "../../../routing/routeCombos";
import { MODE_META } from "../components/icons";
import {
  coerceDate,
  ferryLabelFromStep,
  getExplicitLineColor,
  isFerryStep,
  readableTextColor,
  stepTransitDetails,
  transitLegLabel,
  transitServiceName,
  transitVehicleType,
  vehicleGlyphFromType,
} from "./sidebarFormat";

function buildSidebarSegmentsFromHybridOption(option) {
  const segs = option?.segments ?? [];
  const out = [];
  const FERRY_BG = "rgba(66,133,244,0.18)";
  const pushMove = (mode, i, suffix, durationSec, distanceMeters) => {
    const meta = MODE_META[mode] || { label: mode || "Move", dot: "•", bg: MODE_META.WALK.bg };
    out.push({
      key: `m-${i}${suffix ? `-${suffix}` : ""}`,
      kind: "MOVE",
      mode,
      label: meta.label,
      glyph: meta.dot,
      durationSec,
      distanceMeters,
      bg: meta.bg,
      text: "rgba(0,0,0,0.86)",
    });
  };
  const pushFerry = (step, i, suffix, durationSec, distanceMeters) => {
    out.push({
      key: `f-${i}${suffix ? `-${suffix}` : ""}`,
      kind: "TRANSIT",
      mode: "TRANSIT",
      label: ferryLabelFromStep(step),
      glyph: vehicleGlyphFromType("FERRY"),
      durationSec,
      distanceMeters,
      bg: FERRY_BG,
      text: readableTextColor(FERRY_BG),
      lineColor: null,
      _td: stepTransitDetails(step),
      _service: "",
    });
  };

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const mode = String(seg?.mode || "").toUpperCase();

    if (mode === "TRANSIT") {
      const td =
        seg?.transitDetails ||
        seg?.step?.transit ||
        seg?.step?.transit_details ||
        seg?.transit ||
        seg?.transit_details ||
        null;

      const explicit = getExplicitLineColor(td);
      const glyph = vehicleGlyphFromType(transitVehicleType(td));
      out.push({
        key: `t-${i}`,
        kind: "TRANSIT",
        mode: "TRANSIT",
        label: transitLegLabel(seg?.step, td),
        glyph,
        durationSec: seg?.seconds ?? 0,
        distanceMeters: seg?.distanceMeters ?? 0,
        bg: explicit || MODE_META.WALK.bg,
        text: readableTextColor(explicit || MODE_META.WALK.bg),
        lineColor: explicit,
        _service: transitServiceName(td),
      });
      continue;
    }

    if (mode === "WAIT") {
      out.push({
        key: `w-${i}`,
        kind: "WAIT",
        mode: "WAIT",
        label: MODE_META.WAIT.label,
        glyph: MODE_META.WAIT.dot,
        durationSec: seg?.seconds ?? 0,
        distanceMeters: 0,
        bg: MODE_META.WAIT.bg,
        text: "rgba(0,0,0,0.78)",
      });
      continue;
    }

    const routeSteps = seg?.route?.legs?.[0]?.steps ?? [];
    const ferrySteps = routeSteps.filter((st) => isFerryStep(st));
    if (!ferrySteps.length) {
      pushMove(mode, i, "", seg?.seconds ?? 0, seg?.distanceMeters ?? 0);
      continue;
    }

    const totalRawSec = routeSteps.reduce((sum, st) => sum + (st?.duration?.value ?? 0), 0);
    const totalSegSec = Number(seg?.seconds ?? 0);
    const scale = totalRawSec > 0 && Number.isFinite(totalSegSec) && totalSegSec > 0
      ? totalSegSec / totalRawSec
      : 1;

    let moveSec = 0;
    let moveDist = 0;
    let splitIdx = 0;
    const flushMove = () => {
      if (moveSec <= 0 && moveDist <= 0) return;
      pushMove(mode, i, String(splitIdx), moveSec, moveDist);
      splitIdx += 1;
      moveSec = 0;
      moveDist = 0;
    };

    for (const st of routeSteps) {
      const rawSec = Number(st?.duration?.value ?? 0);
      const sec = Number.isFinite(rawSec) ? rawSec * scale : 0;
      const dist = Number(st?.distance?.value ?? 0);

      if (isFerryStep(st)) {
        flushMove();
        pushFerry(st, i, String(splitIdx), sec, dist);
        splitIdx += 1;
        continue;
      }

      moveSec += Number.isFinite(sec) ? sec : 0;
      moveDist += Number.isFinite(dist) ? dist : 0;
    }

    flushMove();
  }

  return out;
}

function buildSidebarSegmentsFromGoogleRoute(route, { defaultMode = "WALK" } = {}) {
  const out = [];
  const legs = route?.legs ?? [];
  const FERRY_BG = "rgba(66,133,244,0.18)";

  // For TRANSIT results, Google provides scheduled dep/arr times for transit steps.
  // We use those to synthesize explicit WAIT segments between transit legs.
  const WAIT_THRESHOLD_SEC = 60; // ignore tiny gaps
  let cursor = null; // Date

  let group = null;
  const flush = () => {
    if (!group) return;
    out.push(group);
    group = null;
  };

  for (const leg of legs) {
    cursor = cursor || coerceDate(leg?.departure_time) || null;
    const steps = leg?.steps ?? [];

    for (const st of steps) {
      const tmRaw = st?.travel_mode || st?.travelMode || defaultMode;
      const tm = String(tmRaw).toUpperCase();

      if (tm !== "TRANSIT" && isFerryStep(st)) {
        flush();
        out.push({
          key: `f-${out.length}`,
          kind: "TRANSIT",
          mode: "TRANSIT",
          label: ferryLabelFromStep(st),
          glyph: vehicleGlyphFromType("FERRY"),
          durationSec: st?.duration?.value ?? 0,
          distanceMeters: st?.distance?.value ?? 0,
          bg: FERRY_BG,
          text: readableTextColor(FERRY_BG),
          lineColor: null,
          _td: stepTransitDetails(st),
          _service: "",
        });
        if (cursor) cursor = new Date(cursor.getTime() + (st?.duration?.value ?? 0) * 1000);
        continue;
      }

      if (tm === "TRANSIT") {
        flush();
        const td = st?.transit || st?.transit_details || null;

        const depT = coerceDate(td?.departure_time) || null;
        const arrT = coerceDate(td?.arrival_time) || null;

        if (cursor && depT) {
          const gapSec = Math.round((depT.getTime() - cursor.getTime()) / 1000);
          if (gapSec >= WAIT_THRESHOLD_SEC) {
            out.push({
              key: `w-${out.length}`,
              kind: "WAIT",
              mode: "WAIT",
              label: MODE_META.WAIT.label,
              glyph: MODE_META.WAIT.dot,
              durationSec: gapSec,
              distanceMeters: 0,
              bg: MODE_META.WAIT.bg,
              text: "rgba(0,0,0,0.86)",
              _at: td?.departure_stop?.name || td?.departure_stop?.short_name || "",
            });
          }
        }

        const explicit = getExplicitLineColor(td);
        out.push({
          key: `t-${out.length}`,
          kind: "TRANSIT",
          mode: "TRANSIT",
          label: transitLegLabel(st, td),
          glyph: vehicleGlyphFromType(transitVehicleType(td)),
          durationSec: st?.duration?.value ?? 0,
          distanceMeters: st?.distance?.value ?? 0,
          bg: explicit || MODE_META.WALK.bg,
          text: readableTextColor(explicit || MODE_META.WALK.bg),
          lineColor: explicit,
          _td: td,
          _service: transitServiceName(td),
        });

        // advance cursor
        if (arrT) cursor = arrT;
        else if (depT) cursor = new Date(depT.getTime() + (st?.duration?.value ?? 0) * 1000);
        else if (cursor) cursor = new Date(cursor.getTime() + (st?.duration?.value ?? 0) * 1000);
        continue;
      }

      const meta = MODE_META[tm] || MODE_META[String(defaultMode).toUpperCase()] || MODE_META.WALK;

      if (!group || group.mode !== tm) {
        flush();
        group = {
          key: `m-${out.length}`,
          kind: "MOVE",
          mode: tm,
          label: meta.label,
          glyph: meta.dot,
          durationSec: 0,
          distanceMeters: 0,
          bg: meta.bg,
          text: "rgba(0,0,0,0.86)",
        };
      }

      group.durationSec += st?.duration?.value ?? 0;
      group.distanceMeters += st?.distance?.value ?? 0;

      if (cursor) cursor = new Date(cursor.getTime() + (st?.duration?.value ?? 0) * 1000);
    }
  }

  flush();
  return out;
}

function buildSidebarSegments(option, routeCombo) {
  if (option?.segments) return buildSidebarSegmentsFromHybridOption(option);

  if (option?.__route) {
    const def = routeCombo && isBikeOn(routeCombo) ? "BICYCLING" : "WALK";
    return buildSidebarSegmentsFromGoogleRoute(option.__route, { defaultMode: def });
  }

  const defMode =
    routeCombo && isBikeOn(routeCombo)
      ? "BIKE"
      : routeCombo && isSkateOn(routeCombo)
        ? "SKATE"
        : "WALK";

  const meta = MODE_META[defMode] || MODE_META.WALK;
  return [
    {
      key: "fallback",
      kind: "MOVE",
      mode: defMode,
      label: meta.label,
      glyph: meta.dot,
      durationSec: option?.durationSec ?? 0,
      distanceMeters: option?.distanceMeters ?? 0,
      bg: meta.bg,
      text: "rgba(0,0,0,0.86)",
    },
  ];
}

export { buildSidebarSegmentsFromHybridOption, buildSidebarSegmentsFromGoogleRoute, buildSidebarSegments };
