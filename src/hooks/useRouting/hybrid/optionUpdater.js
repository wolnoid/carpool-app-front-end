import { buildHybridOptions } from "../../../routing/hybridPlanner/build";
import { refineSkateSegmentsWithElevation } from "../../../routing/hybridPlanner/skateRefine";
import { ROUTE_COMBO } from "../../../routing/routeCombos";
import { rebuildWaitSegments } from "./waitSegments";
import { itineraryForSidebar, getFirstLastMicroSegIndices } from "./itinerary";
import { applyRecommendedDepartShift } from "./departureShift";
import { skateSecondsFromBase } from "./helpers";

export function createHybridOptionUpdater({
  // core refs/state
  serviceRef,
  routeComboRef,
  transitTimeRef,
  requestSeqRef,
  isStaleSeq,
  selectedIdxRef,
  hybridOptionsRef,
  hybridReplanInFlightRef,
  microSegIndexRef,
  microViaPointsRef,
  microRefineTimersRef,
  // location refs
  originRef,
  destinationRef,
  userLocRef,
  fallbackCenter,
  // state setters
  setRouteOptions,
  setSelectedSegments,
  setSelectedRouteIndex,
  setShowGooglePanel,
  // map clear/render hooks
  clearHybridMapOnly,
  renderHybridSelection,
  // micro manager hooks
  syncMicroDetours,
  syncMicroShadow,
  syncMicroMain,
  rerouteMicroLegFromViaPoints,
}) {
  function updateHybridOptionsAtIndex(optIdx, nextOpt) {
    const cur = hybridOptionsRef.current;
    if (!cur?.length) return;
    const next = cur.map((o, i) => (i === optIdx ? { ...nextOpt, index: i } : o));
    hybridOptionsRef.current = next;
    setRouteOptions(next);
    setSelectedSegments(itineraryForSidebar(next[optIdx]));
  }

  function scheduleSkateRefine(which, optIdx, opt) {
    const seq = requestSeqRef.current;

    try {
      const t = microRefineTimersRef.current?.[which];
      if (t) clearTimeout(t);
    } catch {
      // ignore
    }

    if (!microRefineTimersRef.current) return;

    microRefineTimersRef.current[which] = setTimeout(() => {
      if (isStaleSeq(seq)) return;

      refineSkateSegmentsWithElevation({ option: opt })
        .then((refined) => {
          if (isStaleSeq(seq)) return;
          if (!refined) return;

          let next = rebuildWaitSegments(refined, refined.segments);

          const shifted = applyRecommendedDepartShift(next, transitTimeRef);
          const comboNow = routeComboRef?.current ?? null;

          if (shifted?.missed && comboNow === ROUTE_COMBO.TRANSIT_SKATE) {
            replanHybridAfterMissedDeparture({ departTime: shifted.departTime, preserveVia: true }).catch(
              () => {}
            );
            return;
          }

          next = shifted?.option ?? next;
          updateHybridOptionsAtIndex(optIdx, next);
        })
        .catch(() => {});
    }, 650);
  }

  async function replanHybridAfterMissedDeparture({ departTime, preserveVia = true } = {}) {
    if (hybridReplanInFlightRef.current) return;
    hybridReplanInFlightRef.current = true;

    const seq = requestSeqRef.current;
    if (isStaleSeq(seq)) return;

    try {
      const ds = serviceRef.current;
      if (!ds) return;

      const origin = originRef.current ?? userLocRef?.current ?? fallbackCenter;
      const destination = destinationRef.current;
      if (!destination) return;

      const combo = routeComboRef?.current ?? null;
      if (combo !== ROUTE_COMBO.TRANSIT_BIKE && combo !== ROUTE_COMBO.TRANSIT_SKATE) return;

      const savedFirst = preserveVia ? [...(microViaPointsRef.current?.first ?? [])] : [];
      const savedLast = preserveVia ? [...(microViaPointsRef.current?.last ?? [])] : [];

      const tOverride = {
        kind: "DEPART_AT",
        date: departTime instanceof Date ? departTime : new Date(),
      };

      const options = await buildHybridOptions({
        ds,
        origin,
        destination,
        transitTime: tOverride,
        combo,
        maxOptions: 6,
      });

      if (isStaleSeq(seq)) return;
      if (!options?.length) return;

      // Replace options list and re-render selection.
      clearHybridMapOnly();
      hybridOptionsRef.current = options;
      setRouteOptions(options);

      // Ensure UI selection state is coherent.
      setSelectedRouteIndex(0);
      selectedIdxRef.current = 0;
      setShowGooglePanel(false);

      await renderHybridSelection(0, { fitToRoutes: false, requestSeq: seq });
      if (isStaleSeq(seq)) return;

      // Re-apply user detours to first/last micro legs.
      if (savedFirst.length) {
        microViaPointsRef.current.first = savedFirst;
        await rerouteMicroLegFromViaPoints("first", savedFirst);
        if (isStaleSeq(seq)) return;
      }
      if (savedLast.length) {
        microViaPointsRef.current.last = savedLast;
        await rerouteMicroLegFromViaPoints("last", savedLast);
        if (isStaleSeq(seq)) return;
      }

      // Elevation refinement for selected transit+skate option.
      if (combo === ROUTE_COMBO.TRANSIT_SKATE) {
        const opt = hybridOptionsRef.current?.[0];
        if (opt) {
          try {
            const refined = await refineSkateSegmentsWithElevation({ option: opt });
            if (isStaleSeq(seq)) return;
            if (refined) {
              let next = rebuildWaitSegments(refined, refined.segments);
              const shifted = applyRecommendedDepartShift(next, transitTimeRef);
              next = shifted?.option ?? next;
              updateHybridOptionsAtIndex(0, next);
            }
          } catch {
            // ignore
          }
        }
      }
    } finally {
      hybridReplanInFlightRef.current = false;
    }
  }

  function onMicroLegDirectionsChanged(which, res, route) {
    const opts = hybridOptionsRef.current;
    const optIdx = selectedIdxRef.current;
    if (!opts?.length) return;

    const segIdx = microSegIndexRef.current?.[which];
    if (segIdx == null || segIdx < 0) return;

    const currentOpt = opts[optIdx];
    const segs = [...(currentOpt?.segments ?? [])];
    const oldSeg = segs[segIdx];

    const leg0 = route?.legs?.[0];
    const baseSec = leg0?.duration?.value ?? 0;
    const dist = leg0?.distance?.value ?? 0;

    let sec = baseSec;
    if (oldSeg?.mode === "SKATE") sec = skateSecondsFromBase(oldSeg, baseSec);

    segs[segIdx] = {
      ...oldSeg,
      seconds: sec,
      distanceMeters: dist,
      route,
      directionsResult: res,
    };

    // Sync detours/overlays first so replans preserve latest via.
    syncMicroDetours(which, segs[segIdx]);
    syncMicroShadow(which, oldSeg?.mode ?? segs[segIdx]?.mode, route);
    syncMicroMain(which, oldSeg?.mode ?? segs[segIdx]?.mode, route);

    let nextOpt = rebuildWaitSegments(currentOpt, segs);

    if (which === "first") {
      const shifted = applyRecommendedDepartShift(nextOpt, transitTimeRef);
      if (shifted?.missed) {
        replanHybridAfterMissedDeparture({ departTime: shifted.departTime, preserveVia: true }).catch(
          () => {}
        );
        return;
      }
      nextOpt = shifted?.option ?? nextOpt;
    }

    updateHybridOptionsAtIndex(optIdx, nextOpt);

    // Re-render selected hybrid overlays so any static segment geometry updates immediately.
    // This prevents stale pre-drag polylines from persisting under updated micro-leg paths.
    const seqNow = requestSeqRef.current;
    renderHybridSelection(optIdx, { fitToRoutes: false, requestSeq: seqNow }).catch(() => {});

    if ((nextOpt?.segments ?? []).some((s) => s.mode === "SKATE")) {
      scheduleSkateRefine(which, optIdx, nextOpt);
    }
  }

  // Used by route-builders to seed micro leg indices after options update.
  function setMicroIndicesFromOption(option) {
    const { first, last } = getFirstLastMicroSegIndices(option);
    if (microSegIndexRef.current) {
      microSegIndexRef.current.first = first;
      microSegIndexRef.current.last = last;
    }
    return { first, last };
  }

  return {
    updateHybridOptionsAtIndex,
    scheduleSkateRefine,
    replanHybridAfterMissedDeparture,
    onMicroLegDirectionsChanged,
    setMicroIndicesFromOption,
  };
}
