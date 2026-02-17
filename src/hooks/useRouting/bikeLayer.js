import { ROUTE_COMBO } from "../../routing/routeCombos";

export function createBikeLayerManager({
  enabled,
  map,
  routeComboRef,
  bikeLayerRef,
  bikeLayerShownRef,
  bikeLayerSessionRef,
  bikeLayerLoadPromiseRef,
  bikeKeepAliveRef,
  bikeResyncTimersRef,
}) {
  let bikeLayerImportAttempted = false;
  let pendingHideTimer = null;

  const clearPendingHide = () => {
    if (!pendingHideTimer) return;
    try {
      clearTimeout(pendingHideTimer);
    } catch {
      // ignore
    }
    pendingHideTimer = null;
  };

  const clearBikeResyncTimers = () => {
    clearPendingHide();
    const timers = bikeResyncTimersRef.current;
    if (!timers) return;
    [timers.t1, timers.t2, timers.t3, timers.t4, timers.t5].forEach((t) => {
      if (!t) return;
      try {
        clearTimeout(t);
      } catch {
        // ignore
      }
    });
    bikeResyncTimersRef.current = { t1: null, t2: null, t3: null, t4: null, t5: null };
  };

  const wantsBikeLayerForCombo = () => {
    const combo = routeComboRef?.current ?? null;
    return (
      combo === ROUTE_COMBO.TRANSIT_BIKE ||
      combo === ROUTE_COMBO.TRANSIT_SKATE ||
      combo === ROUTE_COMBO.BIKE ||
      combo === ROUTE_COMBO.SKATE
    );
  };

  const ensureBikeLayer = () => {
    if (bikeLayerRef.current) return bikeLayerRef.current;
    const Ctor = window.google?.maps?.BicyclingLayer;
    if (!Ctor) return null;
    bikeLayerRef.current = new Ctor();
    return bikeLayerRef.current;
  };

  const setBikeLayerVisible = (visible, { force = false, allowHide = true } = {}) => {
    if (!enabled) return;
    const layer = ensureBikeLayer();
    if (!layer) return;

    // Lazy-load the maps library to make sure Bicycling tiles are available.
    try {
      if (visible && !bikeLayerImportAttempted && !bikeLayerLoadPromiseRef.current) {
        bikeLayerImportAttempted = true;
        const importer = window.google?.maps?.importLibrary;
        if (typeof importer === "function") {
          bikeLayerLoadPromiseRef.current = importer("maps")
            .catch(() => {})
            .finally(() => {
              bikeLayerLoadPromiseRef.current = null;
              // One-time post-load resync (guarded by bikeLayerImportAttempted).
              syncBikeLayer({ force: true });
            });
        }
      }
    } catch {
      // ignore
    }

    const next = Boolean(visible && map);

    let actualShown = null;
    try {
      actualShown = layer.getMap?.() ? true : false;
    } catch {
      // ignore
    }

    const refMatches = bikeLayerShownRef.current === next;
    const actualMatches = actualShown == null ? !force : actualShown === next;
    // If force=true and we're trying to show, allow reasserting setMap(map)
    // even when internal state already says "shown".
    if (refMatches && actualMatches && !(force && next)) return;

    if (next) {
      clearPendingHide();
      bikeLayerShownRef.current = true;
      try {
        layer.setMap(map);
      } catch {
        // ignore
      }

      // Keep a small keep-alive pulse when visible so the layer doesn't disappear.
      bikeKeepAliveRef.current.lastVisibleAt = Date.now();
      return;
    }

    // During route-selection resyncs we may want a "show-only" pass:
    // reassert visibility if needed, but never hide.
    if (!allowHide) {
      clearPendingHide();
      return;
    }

    // Avoid brief off-flickers from transient "not wanted" checks during route/UI transitions.
    // Confirm the layer should be hidden a moment later before detaching it.
    if (!force) {
      if (pendingHideTimer) return;
      pendingHideTimer = setTimeout(() => {
        pendingHideTimer = null;
        const wantsByModeNow = wantsBikeLayerForCombo();
        const wantsBySessionNow = Boolean(bikeLayerSessionRef?.current);
        if (wantsByModeNow || wantsBySessionNow) return;

        let shownNow = bikeLayerShownRef.current;
        try {
          shownNow = shownNow || Boolean(layer.getMap?.());
        } catch {
          // ignore
        }
        if (!shownNow) return;

        bikeLayerShownRef.current = false;
        try {
          layer.setMap(null);
        } catch {
          // ignore
        }
      }, 280);
      return;
    }

    clearPendingHide();
    bikeLayerShownRef.current = false;
    try {
      layer.setMap(null);
    } catch {
      // ignore
    }
  };

  const syncBikeLayer = ({ force = false, allowHide = true } = {}) => {
    const wantsByMode = wantsBikeLayerForCombo();
    const wantsBySession = Boolean(bikeLayerSessionRef?.current);
    setBikeLayerVisible(wantsByMode || wantsBySession, { force, allowHide });
  };

  const resyncBikeLayerSoon = ({ allowHide = true } = {}) => {
    const timers = bikeResyncTimersRef.current;
    if (!timers) return;

    if (!timers.t1) {
      timers.t1 = setTimeout(() => {
        timers.t1 = null;
        syncBikeLayer({ allowHide });
      }, 90);
    }
    if (!timers.t2) {
      timers.t2 = setTimeout(() => {
        timers.t2 = null;
        syncBikeLayer({ allowHide });
      }, 280);
    }
    if (!timers.t3) {
      timers.t3 = setTimeout(() => {
        timers.t3 = null;
        syncBikeLayer({ force: true, allowHide });
      }, 650);
    }
    if (!timers.t4) {
      timers.t4 = setTimeout(() => {
        timers.t4 = null;
        syncBikeLayer({ force: true, allowHide });
      }, 1400);
    }
    if (!timers.t5) {
      timers.t5 = setTimeout(() => {
        timers.t5 = null;
        syncBikeLayer({ allowHide });
      }, 2400);
    }
  };

  const setupKeepAlive = () => {
    if (!enabled || !map) return () => {};

    const keepAlive = bikeKeepAliveRef.current;

    const onIdle = () => {
      const wantsByMode = wantsBikeLayerForCombo();
      const wantsBySession = Boolean(bikeLayerSessionRef?.current);
      resyncBikeLayerSoon({ allowHide: !(wantsByMode || wantsBySession) });

      // If we're showing it, keep it pinned to map after idle.
      if (bikeLayerShownRef.current) {
        keepAlive.lastVisibleAt = Date.now();
      }
    };

    const idleListener = map.addListener?.("idle", onIdle);
    const zoomListener = map.addListener?.("zoom_changed", onIdle);

    // Initial assertion
    syncBikeLayer({ force: true });

    return () => {
      try {
        idleListener?.remove?.();
        zoomListener?.remove?.();
      } catch {
        // ignore
      }
      clearBikeResyncTimers();
      clearPendingHide();
    };
  };

  return {
    clearBikeResyncTimers,
    syncBikeLayer,
    resyncBikeLayerSoon,
    setupKeepAlive,
  };
}
