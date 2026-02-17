import { useEffect, useMemo, useRef, useState } from "react";
import {
  extractViaPointsFromRoute,
  summarizeDirectionsRoutes,
  toLatLngLiteral,
} from "../../maps/directionsUtils";
import { ROUTE_COMBO } from "../../routing/routeCombos";
import { SEARCH_TRIGGER } from "../../routing/urlState";

import { clearAltPolylines, drawAlternatePolylines } from "./alternatePolylines";
import { clearPrimaryPolylines, drawPrimaryPolylinesFromRoute } from "./primaryPolylines";
import { fitAllRoutesInView, fitPathInView, getRouteOverviewPath } from "./fit";
import { syncMarkersFromRoute } from "./markers";
import { createRestScaleManager } from "./restScale";
import { createShadowDrawer } from "./shadow";
import { setupMicroDragGuard } from "./microDragGuard";
import { createBikeLayerManager } from "./bikeLayer";
import { createMainRendererTools } from "./rendererMain";

import { createHybridMicroManager } from "./hybrid/microManager";
import { createHybridSelectionManager } from "./hybrid/selectionManager";
import { createHybridOptionUpdater } from "./hybrid/optionUpdater";
import { syncHybridTransitGlyphs } from "./hybrid/glyphs";
import { asSingleResult } from "./hybrid/helpers";
import { drawHybridAlternates } from "./hybrid/draw";
import { decodeStepPath } from "./polylineStyles";

import {
  buildRoute as buildRouteAction,
  clearRoute as clearRouteAction,
  rebuildWithoutAlternatives as rebuildWithoutAlternativesAction,
  selectRoute as selectRouteAction,
} from "./actions";

const FALLBACK_CENTER = { lat: 38.5816, lng: -121.4944 }; // Sacramento

function validDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function normalizeTransitTime(transitTime) {
  const kind = transitTime?.kind;
  const date = validDate(transitTime?.date) ? transitTime.date : null;
  if ((kind === "DEPART_AT" || kind === "ARRIVE_BY") && date) {
    return { kind, date };
  }
  return { kind: "NOW", date: null };
}

function singleRouteDirectionsResult(dir, route) {
  if (!dir || !route) return dir;
  return asSingleResult(dir, route) ?? dir;
}

function getHybridOptionCombinedPath(option) {
  const segs = option?.segments ?? [];
  const out = [];

  for (const seg of segs) {
    if (!seg || seg.mode === "WAIT") continue;

    const raw =
      seg.mode === "TRANSIT"
        ? decodeStepPath(seg.step)
        : getRouteOverviewPath(seg.route);
    if (!raw?.length) continue;

    if (!out.length) out.push(...raw);
    else out.push(...raw.slice(1));
  }

  return out;
}

export function useRouting({
  enabled,
  map,
  // Landing.jsx passes panelRef; older callers used directionsPanelRef.
  panelRef,
  directionsPanelRef,
  originRef,
  destinationRef,
  destRef,
  travelModeRef,
  userLocRef: externalUserLocRef,
  // Back-compat: some callers passed these as values (not refs).
  origin,
  destination,
  userLoc,
  fallbackCenter = FALLBACK_CENTER,
  setOrigin,
  setDestination,
  routeComboRef,
  hillMaxDegRef,
  transitTimeRef,
  markFromPicked,
  originPickerRef,
  destPickerRef,
  onSearchSuccess,
}) {
  const effectivePanelRef = panelRef ?? directionsPanelRef;
  const effectiveDestRef = destinationRef ?? destRef;

  const [routeOptions, setRouteOptions] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [selectedSegments, setSelectedSegments] = useState(null);
  const [showGooglePanel, setShowGooglePanel] = useState(true);
  const [isReady, setIsReady] = useState(false);

  const serviceRef = useRef(null);
  const rendererRef = useRef(null);
  const programmaticUpdateRef = useRef(false);

  const iconsRef = useRef(null);

  const requestSeqRef = useRef(0);
  const isStaleSeq = (seq) => seq !== requestSeqRef.current;
  const bumpRequestSeq = () => {
    requestSeqRef.current += 1;
    return requestSeqRef.current;
  };

  // Normal-route overlays
  const fullDirectionsRef = useRef(null);
  const markersRef = useRef({ start: null, end: null, vias: [] });
  const viaPointsRef = useRef([]);
  const committedViaPointsRef = useRef([]);
  const draftViaPointsRef = useRef([]);

  const primaryPolylinesRef = useRef([]);
  const altPolylinesRef = useRef([]);
  const altPolylineListenersRef = useRef([]);

  // Hybrid-route state & overlays
  const hybridOptionsRef = useRef(null);
  const selectedIdxRef = useRef(0);
  const hybridReplanInFlightRef = useRef(false);

  const hybridPolylinesRef = useRef([]);
  const hybridAltPolylinesRef = useRef([]);
  const hybridAltListenersRef = useRef([]);
  const hybridStopMarkersRef = useRef([]);

  const microSegIndexRef = useRef({ first: -1, last: -1 });
  const microRefineTimersRef = useRef({ first: null, last: null });

  const microFirstRendererRef = useRef(null);
  const microLastRendererRef = useRef(null);
  const microFirstListenerRef = useRef(null);
  const microLastListenerRef = useRef(null);
  const microProgrammaticRef = useRef({ first: false, last: false });
  const userLocRef = useRef(null);
  const resolvedUserLoc = externalUserLocRef?.current ?? userLoc;
  userLocRef.current = resolvedUserLoc;


  const microViaMarkersRef = useRef({ first: [], last: [] });
  const microViaPointsRef = useRef({ first: [], last: [] });
  const microShadowPolylinesRef = useRef({ first: null, last: null });
  const microMainPolylinesRef = useRef({ first: null, last: null });

  // Bike layer
  const bikeLayerRef = useRef(null);
  const bikeLayerShownRef = useRef(false);
  const bikeLayerSessionRef = useRef(false);
  const bikeLayerLoadPromiseRef = useRef(null);
  const bikeKeepAliveRef = useRef({ lastVisibleAt: 0 });
  const bikeResyncTimersRef = useRef({ t1: null, t2: null, t3: null, t4: null, t5: null });

  const bikeLayerMgr = useMemo(() => {
    if (!map) return null;
    return createBikeLayerManager({
      enabled,
      map,
      routeComboRef,
      bikeLayerRef,
      bikeLayerShownRef,
      bikeLayerSessionRef,
      bikeLayerLoadPromiseRef,
      bikeKeepAliveRef,
      bikeResyncTimersRef,
    });
  }, [enabled, map, routeComboRef]);

  useEffect(() => {
    if (!bikeLayerMgr) return;
    return bikeLayerMgr.setupKeepAlive();
  }, [bikeLayerMgr]);

  // Rest-scale + shadow drawer
  const polyBaseRef = useRef(new WeakMap());
  const lastRestScaleRef = useRef(1);

  const restScaleMgr = useMemo(() => {
    if (!map) return null;
    return createRestScaleManager({
      map,
      polyBaseRef,
      lastRestScaleRef,
      altPolylinesRef,
      primaryPolylinesRef,
      hybridPolylinesRef,
      hybridAltPolylinesRef,
      microMainPolylinesRef,
      microShadowPolylinesRef,
      microFirstRendererRef,
      microLastRendererRef,
    });
  }, [map]);

  const shadowDrawer = useMemo(() => {
    if (!map || !restScaleMgr) return null;
    return createShadowDrawer({
      map,
      getRestOverlayScale: restScaleMgr.getRestOverlayScale,
      registerPolylineBase: restScaleMgr.registerPolylineBase,
    });
  }, [map, restScaleMgr]);

  const rendererTools = useMemo(
    () => createMainRendererTools({ rendererRef, panelRef: effectivePanelRef, map }),
    [map, effectivePanelRef]
  );

  const syncGlyphsRef = useRef(null);
  syncGlyphsRef.current = (option, seq) =>
    syncHybridTransitGlyphs({
      option,
      seq,
      rendererRef,
      map,
      programmaticUpdateRef,
      isStaleSeq,
      hardResetMainRenderer: rendererTools.hardResetMainRenderer,
      configureMainRendererForHybrid: rendererTools.configureMainRendererForHybrid,
    });

  const onMicroLegDirectionsChangedRef = useRef(null);
  const onSearchSuccessRef = useRef(onSearchSuccess);
  useEffect(() => {
    onSearchSuccessRef.current = onSearchSuccess;
  }, [onSearchSuccess]);

  const microMgr = useMemo(() => {
    if (!map || !shadowDrawer || !restScaleMgr) return null;
    return createHybridMicroManager({
      map,
      serviceRef,
      iconsRef,
      isStaleSeq,
      registerPolylineBase: restScaleMgr.registerPolylineBase,
      addShadowPolyline: shadowDrawer.addShadowPolyline,
      microFirstRendererRef,
      microLastRendererRef,
      microFirstListenerRef,
      microLastListenerRef,
      microProgrammaticRef,
      microViaMarkersRef,
      microViaPointsRef,
      microShadowPolylinesRef,
      microMainPolylinesRef,
      onMicroLegDirectionsChanged: (...args) =>
        onMicroLegDirectionsChangedRef.current?.(...args),
    });
  }, [map, shadowDrawer, restScaleMgr]);

  const drawCtx = useMemo(() => {
    if (!map || !shadowDrawer || !restScaleMgr) return null;
    return {
      map,
      hybridPolylinesRef,
      hybridAltPolylinesRef,
      hybridAltListenersRef,
      addShadowPolyline: shadowDrawer.addShadowPolyline,
      registerPolylineBase: restScaleMgr.registerPolylineBase,
    };
  }, [map, shadowDrawer, restScaleMgr]);

  const selectRouteRef = useRef(null);
  const buildRouteRef = useRef(null);
  const rebuildNoAltRef = useRef(null);

  const selectionMgr = useMemo(() => {
    if (!map || !microMgr || !drawCtx) return null;
    return createHybridSelectionManager({
      map,
      requestSeqRef,
      isStaleSeq,
      hybridOptionsRef,
      selectedIdxRef,
      microSegIndexRef,
      microRefineTimersRef,
      microViaMarkersRef,
      microViaPointsRef,
      hybridPolylinesRef,
      hybridAltPolylinesRef,
      hybridAltListenersRef,
      hybridStopMarkersRef,
      setSelectedRouteIndex,
      setSelectedSegments,
      setShowGooglePanel,
      syncHybridTransitGlyphs: (opt, seq) => syncGlyphsRef.current?.(opt, seq),
      microMgr,
      drawCtx,
      onSelectRoute: (idx) => selectRouteRef.current?.(idx),
    });
  }, [map, microMgr, drawCtx]);

  const optionUpdater = useMemo(() => {
    if (!microMgr || !selectionMgr) return null;
    return createHybridOptionUpdater({
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
      originRef,
      destinationRef: effectiveDestRef,
      userLocRef,
      fallbackCenter: fallbackCenter,
      setRouteOptions,
      setSelectedSegments,
      setSelectedRouteIndex,
      setShowGooglePanel,
      clearHybridMapOnly: selectionMgr.clearHybridMapOnly,
      renderHybridSelection: selectionMgr.renderHybridSelection,
      syncMicroDetours: microMgr.syncMicroDetours,
      syncMicroShadow: microMgr.syncMicroShadow,
      syncMicroMain: microMgr.syncMicroMain,
      rerouteMicroLegFromViaPoints: microMgr.rerouteMicroLegFromViaPoints,
    });
  }, [
    microMgr,
    selectionMgr,
    originRef,
    effectiveDestRef,
    fallbackCenter,
    routeComboRef,
    transitTimeRef,
  ]);

  useEffect(() => {
    if (optionUpdater)
      onMicroLegDirectionsChangedRef.current =
        optionUpdater.onMicroLegDirectionsChanged;
  }, [optionUpdater]);

  // Init/cleanup Google directions service + main renderer.
  useEffect(() => {
    if (!enabled || !map) {
      setIsReady(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const { DirectionsService, DirectionsRenderer } =
        await window.google.maps.importLibrary("routes");
      if (cancelled) return;

      serviceRef.current = new DirectionsService();

      const dr = new DirectionsRenderer({
        map,
        panel: effectivePanelRef?.current ?? null,
        preserveViewport: true,
        suppressMarkers: true,
        hideRouteList: true,
      });
      rendererRef.current = dr;

      // Default to normal configuration; buildRoute will switch for hybrid.
      rendererTools.configureMainRendererForNormal();
      setIsReady(true);
    })();

    return () => {
      cancelled = true;
      setIsReady(false);
      try {
        rendererTools.hardResetMainRenderer({ reattach: false, clearPanel: true });
      } catch {
        // ignore
      }
      serviceRef.current = null;
    };
  }, [enabled, map, effectivePanelRef, rendererTools]);

  // When the user drags the (nearly invisible) Google polyline, keep our custom overlays + markers in sync.
  const mainDirectionsListenerRef = useRef(null);
  useEffect(() => {
    if (!enabled || !map) return;
    const dr = rendererRef.current;
    if (!dr) return;

    try {
      mainDirectionsListenerRef.current?.remove?.();
    } catch {
      // ignore
    }

    const listener = dr.addListener("directions_changed", () => {
      if (programmaticUpdateRef.current) return;
      if (hybridOptionsRef.current?.length) return;

      const dir = dr.getDirections?.();
      const routes = dir?.routes ?? [];
      if (!dir || !routes.length) return;

      // Drag events should use the renderer's active route index (not always route[0]).
      let activeIdx = Math.max(0, Math.min(selectedRouteIndex ?? 0, routes.length - 1));
      try {
        const idx = dr.getRouteIndex?.();
        if (Number.isFinite(idx)) {
          activeIdx = Math.max(0, Math.min(idx, routes.length - 1));
        }
      } catch {
        // ignore
      }

      const route = routes[activeIdx];
      if (!route) return;

      // User dragging creates a custom route. Collapse to a single selected route so
      // stale pre-drag alternatives are not redrawn on map idle.
      const single = singleRouteDirectionsResult(dir, route);

      // Keep renderer internals aligned to the same single dragged route.
      if (single !== dir) {
        programmaticUpdateRef.current = true;
        try {
          dr.setDirections(single);
          if (typeof dr.setRouteIndex === "function") dr.setRouteIndex(0);
        } catch {
          // ignore
        }
        setTimeout(() => {
          programmaticUpdateRef.current = false;
        }, 0);
      }

      fullDirectionsRef.current = single;
      const transitTime = normalizeTransitTime(transitTimeRef?.current ?? null);
      setRouteOptions(summarizeDirectionsRoutes(single, transitTime));
      setSelectedRouteIndex(0);
      setShowGooglePanel(true);

      const addShadow = shadowDrawer?.addShadowPolyline ?? (() => null);
      const registerBase = restScaleMgr?.registerPolylineBase ?? (() => {});

      clearAltPolylines(altPolylinesRef, altPolylineListenersRef);
      clearPrimaryPolylines(primaryPolylinesRef);
      drawPrimaryPolylinesFromRoute(
        {
          map,
          routeComboRef,
          primaryPolylinesRef,
          addShadowPolyline: addShadow,
          registerPolylineBase: registerBase,
        },
        route
      );

      syncMarkersFromRoute(
        {
          map,
          markersRef,
          viaPointsRef,
          draftViaPointsRef,
          committedViaPointsRef,
          iconsRef,
          markFromPicked,
          setOrigin,
          setDestination,
          originPickerRef,
          destPickerRef,
          buildRoute: (...args) => buildRouteRef.current?.(...args),
          rebuildWithoutAlternatives: (...args) => rebuildNoAltRef.current?.(...args),
        },
        route
      );

      const committedVia = extractViaPointsFromRoute(route);
      draftViaPointsRef.current = committedVia;
      committedViaPointsRef.current = committedVia;

      const legs = route?.legs ?? [];
      const startLL =
        toLatLngLiteral(legs[0]?.start_location) ??
        toLatLngLiteral(originRef?.current ?? origin);
      const endLL =
        toLatLngLiteral(legs[legs.length - 1]?.end_location) ??
        toLatLngLiteral(effectiveDestRef?.current ?? destination);

      try {
        onSearchSuccessRef.current?.({
          triggerType: SEARCH_TRIGGER.ADJUSTMENT_DETOUR_DRAG_END,
          queryState: {
            origin: startLL,
            destination: endLL,
            mode: routeComboRef?.current ?? ROUTE_COMBO.TRANSIT,
            via: committedVia,
            when: transitTime,
            hillMaxDeg: Number(hillMaxDegRef?.current),
          },
        });
      } catch {
        // ignore
      }
    });

    mainDirectionsListenerRef.current = listener;
    return () => {
      try {
        listener?.remove?.();
      } catch {
        // ignore
      }
      mainDirectionsListenerRef.current = null;
    };
  }, [
    enabled,
    map,
    shadowDrawer,
    restScaleMgr,
    selectedRouteIndex,
    markFromPicked,
    setOrigin,
    setDestination,
    originPickerRef,
    destPickerRef,
    routeComboRef,
    hillMaxDegRef,
    transitTimeRef,
    originRef,
    effectiveDestRef,
    destination,
    origin,
  ]);

  // Map idle: apply rest-scale + refresh alternate masking.
  useEffect(() => {
    if (!enabled || !map || !restScaleMgr) return;

    const onIdle = () => {
      restScaleMgr.applyRestScaleToAllPolylines();

      const full = fullDirectionsRef.current;
      const idx = selectedRouteIndex;
      const combo = routeComboRef?.current ?? null;
      const isHybridCombo =
        combo === ROUTE_COMBO.TRANSIT_BIKE ||
        combo === ROUTE_COMBO.TRANSIT_SKATE ||
        combo === ROUTE_COMBO.SKATE;
      const addShadow = shadowDrawer?.addShadowPolyline ?? (() => null);
      const registerBase = restScaleMgr.registerPolylineBase ?? (() => {});
      if (!isHybridCombo && full?.routes?.length > 1) {
        drawAlternatePolylines(
          {
            map,
            altPolylinesRef,
            altPolylineListenersRef,
            addShadowPolyline: addShadow,
            registerPolylineBase: registerBase,
          },
          full,
          idx,
          (i) => selectRouteRef.current?.(i)
        );
        return;
      }

      const hybridOpts = hybridOptionsRef.current;
      if (isHybridCombo && hybridOpts?.length > 1) {
        drawHybridAlternates(
          {
            map,
            hybridAltPolylinesRef,
            hybridAltListenersRef,
            addShadowPolyline: addShadow,
            registerPolylineBase: registerBase,
          },
          hybridOpts,
          selectedIdxRef.current ?? idx,
          (i) => selectRouteRef.current?.(i)
        );
      }
    };

    const listener = map.addListener("idle", onIdle);
    return () => listener?.remove?.();
  }, [enabled, map, restScaleMgr, shadowDrawer, selectedRouteIndex, routeComboRef]);

  // Guard against the hybrid micro-leg detour dragging glitch.
  const microDragGuardRef = useRef({ disabled: false, restoreTimer: null });
  useEffect(() => {
    return setupMicroDragGuard({
      enabled,
      map,
      hybridOptionsRef,
      microFirstRendererRef,
      microLastRendererRef,
      microMainPolylinesRef,
      microDragGuardRef,
    });
  }, [enabled, map]);

  // --- Actions ---
  const ctxRef = useRef(null);
  ctxRef.current = {
    // map + services
    enabled,
    map,
    fallbackCenter: fallbackCenter,
    serviceRef,
    rendererRef,
    rendererTools,
    programmaticUpdateRef,

    // state
    setRouteOptions,
    setIsLoading,
    setRouteError,
    setSelectedRouteIndex,
    setSelectedSegments,
    setShowGooglePanel,

    // values
    originValue: originRef?.current ?? origin,
    destinationValue: effectiveDestRef?.current ?? destination,
    userLocValue: resolvedUserLoc,

    // refs & overlays
    iconsRef,
    fullDirectionsRef,
    markersRef,
    viaPointsRef,
    draftViaPointsRef,
    committedViaPointsRef,
    primaryPolylinesRef,
    altPolylinesRef,
    altPolylineListenersRef,

    // hybrid
    hybridOptionsRef,
    selectedIdxRef,
    selectionMgr,
    restScaleMgr,
    shadowDrawer,

    // micro/hybrid updater support
    requestSeqRef,
    bumpRequestSeq,
    isStaleSeq,

    // bike layer
    bikeLayerMgr,
    bikeLayerSessionRef,

    // routing inputs
    routeComboRef,
    travelModeRef,
    hillMaxDegRef,
    transitTimeRef,

    // marker/picker wiring
    markFromPicked,
    setOrigin,
    setDestination,
    originPickerRef,
    destPickerRef,
    onSearchSuccess,

    // selectRoute callback used by alternates
    selectRoute: (idx) => selectRouteRef.current?.(idx),
  };

  const buildRoute = async (opts = {}) => buildRouteAction(ctxRef.current, opts);
  const clearRoute = async () => clearRouteAction(ctxRef.current);
  const rebuildWithoutAlternatives = async (viaPointsOverride, opts = {}) =>
    rebuildWithoutAlternativesAction(ctxRef.current, viaPointsOverride, opts);
  const selectRoute = (idx) => selectRouteAction(ctxRef.current, idx);

  // Keep refs for other subsystems (markers, selection manager, etc.)
  selectRouteRef.current = selectRoute;
  buildRouteRef.current = buildRoute;
  rebuildNoAltRef.current = rebuildWithoutAlternatives;

  function zoomToAllRoutes() {
    const full = fullDirectionsRef.current;
    const idx = selectedRouteIndex;
    if (full?.routes?.length) {
      fitAllRoutesInView(map, full, idx);
      return;
    }

    // Hybrid: fit combined paths
    const opts = hybridOptionsRef.current;
    if (!opts?.length || !map) return;

    try {
      const bounds = new window.google.maps.LatLngBounds();
      opts.forEach((o) => {
        const path = getHybridOptionCombinedPath(o);
        path?.forEach((p) => bounds.extend(p));
      });
      if (!bounds.isEmpty?.()) map.fitBounds(bounds);
    } catch {
      // ignore
    }
  }

  function zoomToRoute(idx) {
    const full = fullDirectionsRef.current;
    if (full?.routes?.length) {
      const maxIdx = full.routes.length - 1;
      const clamped = Math.max(0, Math.min(idx, maxIdx));
      const r = full.routes[clamped];
      const p = getRouteOverviewPath(r);
      if (p?.length) fitPathInView(map, p);
      return;
    }

    const opts = hybridOptionsRef.current;
    const maxIdx = (opts?.length ?? 0) - 1;
    const clamped = Math.max(0, Math.min(idx, maxIdx));
    const opt = opts?.[clamped];
    const p = getHybridOptionCombinedPath(opt);
    if (!p?.length) return;
    fitPathInView(map, p);
  }

  return {
    buildRoute,
    clearRoute,
    selectRoute,
    routeOptions,
    isLoading,
    routeError,
    isReady,
    selectedRouteIndex,
    selectedSegments,
    showGooglePanel,
    zoomToRoute,
    zoomToAllRoutes,
  };
}
