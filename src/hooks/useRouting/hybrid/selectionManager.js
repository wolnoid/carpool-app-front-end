import { disposeAnyMarker } from "../../../maps/googleUtils";
import {
  clearHybridAlternates,
  drawHybridOption,
  drawHybridStopsForOption,
  drawHybridAlternates,
  optionCombinedPath,
} from "./draw";
import { itineraryForSidebar, getFirstLastMicroSegIndices } from "./itinerary";

export function createHybridSelectionManager({
  map,
  requestSeqRef,
  isStaleSeq,
  // state/refs
  hybridOptionsRef,
  selectedIdxRef,
  microSegIndexRef,
  microRefineTimersRef,
  microViaMarkersRef,
  microViaPointsRef,
  // drawn overlay refs
  hybridPolylinesRef,
  hybridAltPolylinesRef,
  hybridAltListenersRef,
  hybridStopMarkersRef,
  // setters
  setSelectedRouteIndex,
  setSelectedSegments,
  setShowGooglePanel,
  // dependencies
  syncHybridTransitGlyphs,
  microMgr,
  drawCtx,
  onSelectRoute,
}) {
  function clearHybridOverlays({ resetState = true } = {}) {
    clearHybridAlternates(hybridAltPolylinesRef, hybridAltListenersRef);

    // polylines
    [...(hybridPolylinesRef.current ?? []), ...(hybridAltPolylinesRef.current ?? [])].forEach(
      (p) => {
        try {
          p?.setMap?.(null);
        } catch {
          // ignore
        }
      }
    );
    hybridPolylinesRef.current = [];
    hybridAltPolylinesRef.current = [];

    // stop markers
    (hybridStopMarkersRef.current ?? []).forEach((m) => disposeAnyMarker(m));
    hybridStopMarkersRef.current = [];

    // micro refine timers
    ["first", "last"].forEach((k) => {
      try {
        const t = microRefineTimersRef.current?.[k];
        if (t) clearTimeout(t);
      } catch {
        // ignore
      }
      if (microRefineTimersRef.current) microRefineTimersRef.current[k] = null;

      (microViaMarkersRef.current?.[k] ?? []).forEach((m) => disposeAnyMarker(m));
      if (microViaMarkersRef.current) microViaMarkersRef.current[k] = [];
      if (microViaPointsRef.current) microViaPointsRef.current[k] = [];
      if (microSegIndexRef.current) microSegIndexRef.current[k] = -1;
    });

    microMgr?.clearMicroRenderers?.();
    microMgr?.clearAllMicroPolylines?.();

    if (resetState) {
      hybridOptionsRef.current = null;
      setSelectedSegments(null);
      setShowGooglePanel(true);
    }
  }

  function clearHybridMapOnly() {
    clearHybridOverlays({ resetState: false });
  }

  async function renderHybridSelection(
    idx,
    { fitToRoutes = false, requestSeq = null } = {}
  ) {
    const seq = requestSeq ?? requestSeqRef.current;
    if (isStaleSeq(seq)) return;

    const options = hybridOptionsRef.current;
    if (!options?.length) return;

    const maxIdx = options.length - 1;
    const clamped = Math.max(0, Math.min(idx, maxIdx));

    setSelectedRouteIndex(clamped);
    selectedIdxRef.current = clamped;

    clearHybridMapOnly();
    if (isStaleSeq(seq)) return;
    setShowGooglePanel(false);

    const opt = options[clamped];

    // Re-enable Google's transit route shields/labels for the selected hybrid option.
    syncHybridTransitGlyphs(opt, seq);

    const { first, last } = getFirstLastMicroSegIndices(opt);
    if (microSegIndexRef.current) {
      microSegIndexRef.current.first = first;
      microSegIndexRef.current.last = last;
    }

    // Always draw the full selected option so there is a guaranteed visible route line,
    // even if micro renderers fail to initialize on some Maps builds.
    drawHybridOption(drawCtx, opt, { isAlt: false, zIndex: 20 });
    drawHybridStopsForOption({ map, hybridStopMarkersRef }, opt);
    drawHybridAlternates(drawCtx, options, clamped, onSelectRoute);

    if (first >= 0) await microMgr.setMicroRendererDirections("first", opt.segments[first], seq);
    if (isStaleSeq(seq)) return;
    if (last >= 0 && last !== first)
      await microMgr.setMicroRendererDirections("last", opt.segments[last], seq);
    if (isStaleSeq(seq)) return;

    setSelectedSegments(itineraryForSidebar(opt));

    if (fitToRoutes && map) {
      requestAnimationFrame(() => {
        if (isStaleSeq(seq)) return;
        requestAnimationFrame(() => {
          if (isStaleSeq(seq)) return;
          try {
            const bounds = new window.google.maps.LatLngBounds();
            let hasAny = false;

            const unionBounds = (b) => {
              if (!b) return;
              try {
                const ne = b.getNorthEast?.();
                const sw = b.getSouthWest?.();
                if (ne) {
                  bounds.extend(ne);
                  hasAny = true;
                }
                if (sw) {
                  bounds.extend(sw);
                  hasAny = true;
                }
              } catch {
                // ignore
              }
            };

            // Prefer route bounds (cheap) over extending every vertex (can be huge).
            options.forEach((o) => {
              unionBounds(o?.baseRoute?.bounds);
              (o?.segments ?? []).forEach((seg) => unionBounds(seg?.route?.bounds));
            });

            // Fallback if bounds weren't available for some reason.
            if (!hasAny) {
              let total = 0;
              const MAX_TOTAL_POINTS = 4000;
              options.forEach((o) => {
                if (total >= MAX_TOTAL_POINTS) return;
                const p = optionCombinedPath(o);
                if (!p?.length) return;
                const step = Math.max(1, Math.ceil(p.length / 400));
                for (let i = 0; i < p.length && total < MAX_TOTAL_POINTS; i += step) {
                  bounds.extend(p[i]);
                  total++;
                  hasAny = true;
                }
              });
            }

            if (hasAny) {
              const mapDiv = map.getDiv?.();
              const rect = mapDiv?.getBoundingClientRect?.();
              const mapW = rect?.width ?? 800;
              const basePad = Math.max(24, Math.min(60, Math.round(mapW * 0.08)));
              map.fitBounds(bounds, {
                top: basePad,
                bottom: basePad,
                left: basePad,
                right: basePad,
              });
            }
          } catch {
            // ignore
          }
        });
      });
    }
  }

  return {
    clearHybridOverlays,
    clearHybridMapOnly,
    renderHybridSelection,
  };
}
