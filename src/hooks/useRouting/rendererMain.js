export function createMainRendererTools({ rendererRef, panelRef, map }) {
  function clearRendererDirections(dr) {
    if (!dr) return;

    // Best-effort: clear any retained directions payload before reattaching.
    // Some Maps JS builds keep rendering transit shields when map is reattached
    // unless the internal directions object is explicitly nulled.
    try {
      dr.set?.("directions", null);
    } catch {
      // ignore
    }
    try {
      dr.set?.("routeIndex", 0);
    } catch {
      // ignore
    }
    try {
      if (typeof dr.setRouteIndex === "function") dr.setRouteIndex(0);
    } catch {
      // ignore
    }
    try {
      // `setDirections(null)` can throw on some builds; keep as guarded fallback only.
      dr.setDirections?.(null);
    } catch {
      // ignore
    }
  }

  function hardResetMainRenderer({ reattach = true, clearPanel = false } = {}) {
    const dr = rendererRef.current;
    if (!dr) return;

    // NOTE: Newer Maps JS builds can throw if setDirections is called with null
    // or a stub object. Clearing by detaching/reattaching avoids InvalidValueError
    // and the downstream 'travelMode' crashes.
    try {
      dr.setPanel?.(null);
    } catch {
      // ignore
    }
    clearRendererDirections(dr);
    try {
      dr.setMap?.(null);
    } catch {
      // ignore
    }

    if (reattach) {
      try {
        dr.setMap?.(map);
      } catch {
        // ignore
      }
      try {
        dr.setPanel?.(clearPanel ? null : panelRef?.current ?? null);
      } catch {
        // ignore
      }
    }
  }

  function configureMainRendererForNormal() {
    const dr = rendererRef.current;
    if (!dr) return;
    try {
      dr.setOptions?.({
        draggable: true,
        suppressMarkers: true,
        hideRouteList: true,
        preserveViewport: true,
        // Keep the renderer polyline invisible but draggable/selectable.
        polylineOptions: { strokeOpacity: 0, strokeWeight: 10 },
      });
    } catch {
      // ignore
    }
    try {
      dr.setPanel?.(panelRef?.current ?? null);
    } catch {
      // ignore
    }
    try {
      dr.setMap?.(map);
    } catch {
      // ignore
    }
  }

  function configureMainRendererForHybrid() {
    const dr = rendererRef.current;
    if (!dr) return;
    try {
      dr.setOptions?.({
        draggable: false,
        suppressMarkers: true,
        hideRouteList: true,
        preserveViewport: true,
        // We only want Google's transit glyphs/route shields; keep the underlying polyline invisible
        // and non-interactive so it doesn't interfere with our custom overlays.
        polylineOptions: { strokeOpacity: 0, strokeWeight: 10, clickable: false },
      });
    } catch {
      // ignore
    }
    // Hybrid UI hides the Google panel; keep it detached even if the renderer exists.
    try {
      dr.setPanel?.(null);
    } catch {
      // ignore
    }
    try {
      dr.setMap?.(map);
    } catch {
      // ignore
    }
  }

  return {
    hardResetMainRenderer,
    configureMainRendererForNormal,
    configureMainRendererForHybrid,
  };
}
