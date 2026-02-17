import { extractViaPointsFromRoute, summarizeDirectionsRoutes } from "../../maps/directionsUtils";
import { toLatLngLiteral } from "../../maps/googleUtils";

import { ROUTE_COMBO } from "../../routing/routeCombos";
import { filterRoutesByFerrySchedule } from "../../routing/ferrySchedule";
import { buildHybridOptions } from "../../routing/hybridPlanner/build";
import { refineSkateSegmentsWithElevation } from "../../routing/hybridPlanner/skateRefine";

import { clearAltPolylines, drawAlternatePolylines } from "./alternatePolylines";
import { clearPrimaryPolylines, drawPrimaryPolylinesFromRoute } from "./primaryPolylines";
import { fitAllRoutesInView } from "./fit";
import { clearRouteMarkers, syncMarkersFromRoute, syncMarkersFromEndpoints } from "./markers";


const ROUTE_COMBO_SET = new Set(Object.values(ROUTE_COMBO));

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(label || `Timed out after ${ms}ms`));
    }, ms);

    Promise.resolve(promise).then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

function yieldForPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function validDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function coerceRouteCombo(combo) {
  return ROUTE_COMBO_SET.has(combo) ? combo : ROUTE_COMBO.TRANSIT;
}

function normalizeViaPoints(viaPoints) {
  if (!Array.isArray(viaPoints)) return [];
  return viaPoints
    .map((p) => toLatLngLiteral(p))
    .filter(Boolean)
    .map((p) => ({ lat: p.lat, lng: p.lng }));
}

function normalizeTransitTime(transitTime) {
  const kind = transitTime?.kind;
  const date = validDate(transitTime?.date) ? transitTime.date : null;

  if ((kind === "DEPART_AT" || kind === "ARRIVE_BY") && date) {
    return { kind, date };
  }

  return { kind: "NOW", date: null };
}

function setCommittedAndDraftVia(ctx, viaPoints) {
  const clean = normalizeViaPoints(viaPoints);
  if (ctx.viaPointsRef) ctx.viaPointsRef.current = clean;
  if (ctx.draftViaPointsRef) ctx.draftViaPointsRef.current = clean;
  if (ctx.committedViaPointsRef) ctx.committedViaPointsRef.current = clean;
  return clean;
}

function buildSuccessfulQueryState({
  origin,
  destination,
  mode,
  viaPoints,
  transitTime,
  hillMaxDeg,
}) {
  return {
    origin: toLatLngLiteral(origin),
    destination: toLatLngLiteral(destination),
    mode: coerceRouteCombo(mode),
    via: normalizeViaPoints(viaPoints),
    when: normalizeTransitTime(transitTime),
    hillMaxDeg: Number(hillMaxDeg),
  };
}

function notifySearchSuccess(ctx, payload) {
  try {
    ctx.onSearchSuccess?.(payload);
  } catch {
    // ignore
  }
}

export function setMainSingleRoute(
  { rendererRef, programmaticUpdateRef },
  fullDirections,
  routeIndex
) {
  const dr = rendererRef.current;
  const routes = fullDirections?.routes;
  if (!dr || !fullDirections || !Array.isArray(routes) || !routes.length) return;

  const idx = Math.max(0, Math.min(routeIndex ?? 0, routes.length - 1));

  // Avoid cloning DirectionsResult objects. Some internal fields (e.g. request/travelMode)
  // may be non-enumerable; spreading can drop them and cause Google internals to crash.
  programmaticUpdateRef.current = true;
  try {
    dr.setDirections(fullDirections);
    if (typeof dr.setRouteIndex === "function") dr.setRouteIndex(idx);
  } catch {
    // ignore
  }
  setTimeout(() => {
    programmaticUpdateRef.current = false;
  }, 0);
}

export function clearNormalOverlays(ctx) {
  clearAltPolylines(ctx.altPolylinesRef, ctx.altPolylineListenersRef);
  clearPrimaryPolylines(ctx.primaryPolylinesRef);
  clearRouteMarkers({ markersRef: ctx.markersRef, viaPointsRef: ctx.viaPointsRef });
  ctx.fullDirectionsRef.current = null;
}

export function clearAllRoutesState(ctx) {
  ctx.setRouteOptions(null);
  ctx.setSelectedRouteIndex(0);
  ctx.setSelectedSegments(null);
  ctx.setShowGooglePanel(true);
  ctx.hybridOptionsRef.current = null;
  ctx.selectedIdxRef.current = 0;
}

export async function clearRoute(ctx) {
  ctx.bumpRequestSeq();

  ctx.setIsLoading(false);
  ctx.setRouteError?.(null);
  clearNormalOverlays(ctx);

  ctx.selectionMgr?.clearHybridOverlays?.({ resetState: true });

  try {
    // Keep the main renderer detached after clear so stale transit glyphs/shields
    // cannot redraw from any retained Directions payload.
    ctx.rendererTools.hardResetMainRenderer({ reattach: false, clearPanel: true });
  } catch {
    // ignore
  }

  ctx.bikeLayerMgr?.clearBikeResyncTimers?.();
  ctx.bikeLayerSessionRef.current = false;
  ctx.bikeLayerMgr?.syncBikeLayer?.({ force: true });

  setCommittedAndDraftVia(ctx, []);

  clearAllRoutesState(ctx);
}

export async function rebuildWithoutAlternatives(ctx, viaPointsOverride, opts = {}) {
  clearNormalOverlays(ctx);
  return await buildRoute(ctx, {
    viaPointsOverride,
    alternatives: false,
    fitToRoutes: true,
    ...opts,
  });
}

export async function buildRoute(
  ctx,
  {
    originOverride,
    destinationOverride,
    viaPointsOverride,
    alternatives = true,
    fitToRoutes = true,
    routeComboOverride,
    transitTimeOverride,
    triggerType = null,
    suppressSuccessNotify = false,
  } = {}
) {
  const ds = ctx.serviceRef.current;
  const dr = ctx.rendererRef.current;
  if (!ds || !dr || !ctx.map) {
    return { success: false, reason: "not_ready" };
  }

  const seq = ctx.bumpRequestSeq();

  ctx.setIsLoading(true);
  ctx.setRouteError?.(null);
  ctx.setRouteOptions(null);
  ctx.setSelectedSegments(null);
  // Give React a frame to present the loading state before expensive route work starts.
  await yieldForPaint();

  try {

  // Clear everything immediately so no artifacts linger.
  clearNormalOverlays(ctx);
  ctx.selectionMgr?.clearHybridOverlays?.({ resetState: false });
  // A fresh build should never reuse prior hybrid options.
  ctx.hybridOptionsRef.current = null;
  ctx.selectedIdxRef.current = 0;

  const combo = coerceRouteCombo(routeComboOverride ?? ctx.routeComboRef?.current ?? ROUTE_COMBO.TRANSIT);
  const transitTime = normalizeTransitTime(transitTimeOverride ?? ctx.transitTimeRef?.current ?? null);
  const isHybridCombo =
    combo === ROUTE_COMBO.TRANSIT_BIKE ||
    combo === ROUTE_COMBO.TRANSIT_SKATE ||
    combo === ROUTE_COMBO.SKATE;

  // Keep the bicycling overlay stable during bike/skate-enabled sessions.
  ctx.bikeLayerSessionRef.current =
    combo === ROUTE_COMBO.TRANSIT_BIKE ||
    combo === ROUTE_COMBO.TRANSIT_SKATE ||
    combo === ROUTE_COMBO.BIKE ||
    combo === ROUTE_COMBO.SKATE;
  ctx.bikeLayerMgr?.clearBikeResyncTimers?.();
  ctx.bikeLayerMgr?.syncBikeLayer?.();

  // Reset main renderer so transit glyphs don’t linger between searches.
  ctx.rendererTools.hardResetMainRenderer({ reattach: true, clearPanel: isHybridCombo });

  const originLL =
    originOverride ??
    toLatLngLiteral(ctx.originValue) ??
    toLatLngLiteral(ctx.userLocValue) ??
    ctx.fallbackCenter;

  const destLL = destinationOverride ?? toLatLngLiteral(ctx.destinationValue);
  if (!destLL) {
    return { success: false, reason: "missing_destination" };
  }

  // HYBRID PATH: precompute options, custom draw, and use the main renderer only for transit glyphs.
  if (isHybridCombo) {
    ctx.rendererTools.configureMainRendererForHybrid();

    let options = null;
    try {
      options = await withTimeout(buildHybridOptions({
        ds,
        origin: originLL,
        destination: destLL,
        transitTime,
        combo,
        hillMaxDeg: ctx.hillMaxDegRef?.current ?? null,
        maxOptions: 6,
        }), 45000, "Hybrid build timed out");
    } catch (err) {
      // Prevent the UI from getting stuck in a "loading" state if hybrid planning throws.
      console.error("Hybrid route build failed", err);
      if (!ctx.isStaleSeq(seq)) {
        ctx.setRouteError?.("Couldn't build routes. Please try again.");
        ctx.setIsLoading(false);
      }
      return { success: false, reason: "request_failed" };
    }

    if (ctx.isStaleSeq(seq)) return { success: false, reason: "stale" };
    if (!options?.length) {
      ctx.setRouteError?.("No routes found for that trip.");
      return { success: false, reason: "no_routes" };
    }

    ctx.hybridOptionsRef.current = options;
    ctx.setRouteOptions(options);
    ctx.setSelectedRouteIndex(0);
    ctx.selectedIdxRef.current = 0;
    ctx.setShowGooglePanel(false);

    // Set endpoints (no via detours in hybrid mode).
    syncMarkersFromEndpoints(
      {
        map: ctx.map,
        markersRef: ctx.markersRef,
        viaPointsRef: ctx.viaPointsRef,
        iconsRef: ctx.iconsRef,
        markFromPicked: ctx.markFromPicked,
        setOrigin: ctx.setOrigin,
        setDestination: ctx.setDestination,
        originPickerRef: ctx.originPickerRef,
        destPickerRef: ctx.destPickerRef,
        buildRoute: (opts) => buildRoute(ctx, opts),
        draftViaPointsRef: ctx.draftViaPointsRef,
        committedViaPointsRef: ctx.committedViaPointsRef,
      },
      originLL,
      destLL
    );

    await ctx.selectionMgr?.renderHybridSelection?.(0, { fitToRoutes, requestSeq: seq });

    const committedVia = setCommittedAndDraftVia(ctx, []);
    const queryState = buildSuccessfulQueryState({
      origin: originLL,
      destination: destLL,
      mode: combo,
      viaPoints: committedVia,
      transitTime,
      hillMaxDeg: ctx.hillMaxDegRef?.current ?? null,
    });
    if (!suppressSuccessNotify) {
      notifySearchSuccess(ctx, { triggerType, queryState });
    }

    // Non-blocking elevation refinement for skate segments.
    if (combo === ROUTE_COMBO.TRANSIT_SKATE && options?.[0]) {
      refineSkateSegmentsWithElevation({ option: options[0] }).catch(() => {});
    }
    return { success: true, queryState, viaPoints: committedVia };
  }

  // NORMAL ROUTES
  ctx.rendererTools.configureMainRendererForNormal();

  const addShadow = ctx.shadowDrawer?.addShadowPolyline ?? (() => null);
  const registerBase = ctx.restScaleMgr?.registerPolylineBase ?? (() => {});

  const req = {
    origin: originLL,
    destination: destLL,
    provideRouteAlternatives: !!alternatives,
  };

  const travelMode =
    combo === ROUTE_COMBO.BIKE
      ? "BICYCLING"
      : combo === ROUTE_COMBO.TRANSIT
        ? "TRANSIT"
        : "WALKING";
  req.travelMode = travelMode;
  if (combo === ROUTE_COMBO.BIKE) req.avoidFerries = true;

  // Keep the external travelModeRef in sync (used by styling + other UI).
  try {
    if (ctx.travelModeRef) ctx.travelModeRef.current = travelMode;
  } catch {
    // ignore
  }


  if (travelMode === "TRANSIT") {
    if (transitTime.kind === "DEPART_AT" && validDate(transitTime.date))
      req.transitOptions = { departureTime: transitTime.date };
    if (transitTime.kind === "ARRIVE_BY" && validDate(transitTime.date))
      req.transitOptions = { arrivalTime: transitTime.date };
  }

  const viaPts = normalizeViaPoints(
    viaPointsOverride ?? ctx.draftViaPointsRef?.current ?? ctx.viaPointsRef.current
  );
  if (viaPts?.length) {
    req.waypoints = viaPts.map((p) => ({ location: p, stopover: false }));
    req.optimizeWaypoints = false;
  }

  let full;
  try {
    full = await withTimeout(ds.route(req), 45000, "Directions build timed out");
  } catch (err) {
    console.error("Directions route() failed", err);
    if (!ctx.isStaleSeq(seq)) {
      ctx.setRouteError?.("Couldn't build routes. Please try again.");
      ctx.setIsLoading(false);
    }
    return { success: false, reason: "request_failed" };
  }
  if (ctx.isStaleSeq(seq)) return { success: false, reason: "stale" };

  let routes = full?.routes ?? [];
  const initialRouteCount = routes.length;

  if (travelMode === "BICYCLING" && routes.length) {
    routes = await filterRoutesByFerrySchedule({
      ds,
      routes,
      transitTime,
      now: new Date(),
    });

    try {
      if (Array.isArray(full?.routes)) {
        full.routes.splice(0, full.routes.length, ...routes);
      }
    } catch {
      // ignore
    }
  }

  if (ctx.isStaleSeq(seq)) return { success: false, reason: "stale" };

  if (!routes.length) {
    const filteredByFerry = travelMode === "BICYCLING" && initialRouteCount > 0;
    ctx.setRouteError?.(
      filteredByFerry
        ? "No bike routes with active ferry departures were found near that time."
        : "No routes found for that trip."
    );
    return { success: false, reason: filteredByFerry ? "no_ferry_schedule_match" : "no_routes" };
  }

  ctx.fullDirectionsRef.current = full;
  ctx.setRouteOptions(summarizeDirectionsRoutes(full, transitTime));

  const idx = 0;
  ctx.setSelectedRouteIndex(idx);

  // Single-route directions render.
  setMainSingleRoute({ rendererRef: ctx.rendererRef, programmaticUpdateRef: ctx.programmaticUpdateRef }, full, idx);

  // Custom polylines
  clearPrimaryPolylines(ctx.primaryPolylinesRef);
  drawPrimaryPolylinesFromRoute(
    {
      map: ctx.map,
      routeComboRef: ctx.routeComboRef,
      travelModeRef: ctx.travelModeRef ?? { current: travelMode },
      primaryPolylinesRef: ctx.primaryPolylinesRef,
      addShadowPolyline: addShadow,
      registerPolylineBase: registerBase,
    },
    routes[idx]
  );

  drawAlternatePolylines(
    {
      map: ctx.map,
      altPolylinesRef: ctx.altPolylinesRef,
      altPolylineListenersRef: ctx.altPolylineListenersRef,
      addShadowPolyline: addShadow,
      registerPolylineBase: registerBase,
    },
    full,
    idx,
    (i) => ctx.selectRoute?.(i)
  );

  syncMarkersFromRoute(
    {
      map: ctx.map,
      markersRef: ctx.markersRef,
      viaPointsRef: ctx.viaPointsRef,
      iconsRef: ctx.iconsRef,
      markFromPicked: ctx.markFromPicked,
      setOrigin: ctx.setOrigin,
      setDestination: ctx.setDestination,
      originPickerRef: ctx.originPickerRef,
      destPickerRef: ctx.destPickerRef,
      buildRoute: (opts) => buildRoute(ctx, opts),
      rebuildWithoutAlternatives: (via, opts = {}) =>
        rebuildWithoutAlternatives(ctx, via, opts),
      draftViaPointsRef: ctx.draftViaPointsRef,
      committedViaPointsRef: ctx.committedViaPointsRef,
    },
    routes[idx]
  );

  if (fitToRoutes) fitAllRoutesInView(ctx.map, full, idx);

  ctx.setShowGooglePanel(true);

  const committedVia = setCommittedAndDraftVia(ctx, extractViaPointsFromRoute(routes[idx]));
  const queryState = buildSuccessfulQueryState({
    origin: originLL,
    destination: destLL,
    mode: combo,
    viaPoints: committedVia,
    transitTime,
    hillMaxDeg: ctx.hillMaxDegRef?.current ?? null,
  });
  if (!suppressSuccessNotify) {
    notifySearchSuccess(ctx, { triggerType, queryState });
  }
  return { success: true, queryState, viaPoints: committedVia };
  } finally {
    if (!ctx.isStaleSeq(seq)) ctx.setIsLoading(false);
  }
}

export function selectRoute(ctx, idx) {
  // Keep bike layer pinned in bike/skate-capable modes while switching routes.
  ctx.bikeLayerMgr?.syncBikeLayer?.({ allowHide: false });

  // Hybrid selection
  if (ctx.hybridOptionsRef.current?.length && ctx.selectionMgr) {
    ctx.selectionMgr.renderHybridSelection(idx, {
      fitToRoutes: false,
      requestSeq: ctx.requestSeqRef.current,
    });
    ctx.bikeLayerMgr?.resyncBikeLayerSoon?.({ allowHide: false });
    return;
  }

  const full = ctx.fullDirectionsRef.current;
  if (!full?.routes?.length) return;

  const maxIdx = full.routes.length - 1;
  const clamped = Math.max(0, Math.min(idx, maxIdx));
  ctx.setSelectedRouteIndex(clamped);

  setMainSingleRoute({ rendererRef: ctx.rendererRef, programmaticUpdateRef: ctx.programmaticUpdateRef }, full, clamped);

  const addShadow = ctx.shadowDrawer?.addShadowPolyline ?? (() => null);
  const registerBase = ctx.restScaleMgr?.registerPolylineBase ?? (() => {});

  clearPrimaryPolylines(ctx.primaryPolylinesRef);
  drawPrimaryPolylinesFromRoute(
    {
      map: ctx.map,
      routeComboRef: ctx.routeComboRef,
      travelModeRef: ctx.travelModeRef ?? { current: "TRANSIT" },
      primaryPolylinesRef: ctx.primaryPolylinesRef,
      addShadowPolyline: addShadow,
      registerPolylineBase: registerBase,
    },
    full.routes[clamped]
  );

  drawAlternatePolylines(
    {
      map: ctx.map,
      altPolylinesRef: ctx.altPolylinesRef,
      altPolylineListenersRef: ctx.altPolylineListenersRef,
      addShadowPolyline: addShadow,
      registerPolylineBase: registerBase,
    },
    full,
    clamped,
    (i) => ctx.selectRoute?.(i)
  );

  syncMarkersFromRoute(
    {
      map: ctx.map,
      markersRef: ctx.markersRef,
      viaPointsRef: ctx.viaPointsRef,
      iconsRef: ctx.iconsRef,
      markFromPicked: ctx.markFromPicked,
      setOrigin: ctx.setOrigin,
      setDestination: ctx.setDestination,
      originPickerRef: ctx.originPickerRef,
      destPickerRef: ctx.destPickerRef,
      buildRoute: (opts) => buildRoute(ctx, opts),
      rebuildWithoutAlternatives: (via, opts = {}) =>
        rebuildWithoutAlternatives(ctx, via, opts),
      draftViaPointsRef: ctx.draftViaPointsRef,
      committedViaPointsRef: ctx.committedViaPointsRef,
    },
    full.routes[clamped]
  );

  ctx.bikeLayerMgr?.syncBikeLayer?.({ allowHide: false });
  ctx.bikeLayerMgr?.resyncBikeLayerSoon?.({ allowHide: false });
}
