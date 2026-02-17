import { extractViaPointsFromRoute } from "../../../maps/directionsUtils";
import { disposeAnyMarker, toLatLngLiteral } from "../../../maps/googleUtils";
import { getIcons } from "../markers";
import { polylineStyleForMode } from "../../../routing/hybridPlanner/styles";
import { styleIsDotted, getRouteOverviewPath } from "../polylineStyles";
import { asSingleResult, microLegTravelMode } from "./helpers";

export function createHybridMicroManager({
  map,
  serviceRef,
  iconsRef,
  isStaleSeq,
  registerPolylineBase,
  addShadowPolyline,
  // renderers
  microFirstRendererRef,
  microLastRendererRef,
  microFirstListenerRef,
  microLastListenerRef,
  microProgrammaticRef,
  // via markers
  microViaMarkersRef,
  microViaPointsRef,
  // custom polylines
  microShadowPolylinesRef,
  microMainPolylinesRef,
  // callback
  onMicroLegDirectionsChanged,
}) {
  function clearMicroDetourMarkers(which) {
    (microViaMarkersRef.current?.[which] ?? []).forEach(disposeAnyMarker);
    if (microViaMarkersRef.current) microViaMarkersRef.current[which] = [];
  }

  function clearMicroViaMarkers() {
    clearMicroDetourMarkers("first");
    clearMicroDetourMarkers("last");
    if (microViaPointsRef.current) {
      microViaPointsRef.current.first = [];
      microViaPointsRef.current.last = [];
    }
  }

  function clearMicroShadow(which) {
    const cur = microShadowPolylinesRef.current?.[which] ?? null;
    if (cur) {
      try {
        cur.setMap(null);
      } catch {
        // ignore
      }
    }
    if (microShadowPolylinesRef.current) microShadowPolylinesRef.current[which] = null;
  }

  function clearMicroMain(which) {
    const cur = microMainPolylinesRef.current?.[which] ?? null;
    if (cur) {
      try {
        cur.setMap(null);
      } catch {
        // ignore
      }
    }
    if (microMainPolylinesRef.current) microMainPolylinesRef.current[which] = null;
  }

  function clearAllMicroPolylines() {
    clearMicroShadow("first");
    clearMicroShadow("last");
    clearMicroMain("first");
    clearMicroMain("last");
  }

  function syncMicroMain(which, mode, route) {
    clearMicroMain(which);

    const path = getRouteOverviewPath(route);
    if (!map || !path?.length) return;

    const style = polylineStyleForMode(mode, { isAlt: false });

    try {
      const poly = new window.google.maps.Polyline({
        map,
        path,
        clickable: false,
        ...style,
        zIndex: 41,
      });
      registerPolylineBase(poly);
      if (microMainPolylinesRef.current) microMainPolylinesRef.current[which] = poly;
    } catch {
      // ignore
    }
  }

  function syncMicroShadow(which, mode, route) {
    clearMicroShadow(which);

    const path = getRouteOverviewPath(route);
    if (!map || !path?.length) return;

    const style = polylineStyleForMode(mode, { isAlt: false });
    if (styleIsDotted(style)) return;

    const shadow = addShadowPolyline({
      path,
      strokeWeight: style?.strokeWeight ?? 8,
      zIndex: 40,
      isAlt: false,
    });

    if (microShadowPolylinesRef.current) microShadowPolylinesRef.current[which] = shadow;
  }

  async function rerouteMicroLegFromViaPoints(which, viaPoints) {
    const ds = serviceRef.current;
    if (!ds) return;

    const renderer =
      which === "first" ? microFirstRendererRef.current : microLastRendererRef.current;

    // infer the current segment from the renderer's directions (single-route)
    // and just re-route between its endpoints.
    const dir = renderer?.getDirections?.();
    const baseRoute = dir?.routes?.[0];
    const leg0 = baseRoute?.legs?.[0];
    const o = leg0?.start_location;
    const d = leg0?.end_location;
    if (!o || !d) return;

    const req = {
      origin: o,
      destination: d,
      travelMode: baseRoute?.travelMode ?? "WALKING",
      provideRouteAlternatives: false,
    };

    if (viaPoints?.length) {
      req.waypoints = viaPoints.map((p) => ({ location: p, stopover: false }));
      req.optimizeWaypoints = false;
    }

    const res = await ds.route(req);
    const route = res?.routes?.[0] ?? null;
    if (!route) return;

    // Update renderer programmatically
    if (renderer) {
      microProgrammaticRef.current[which] = true;
      try {
        // preserve any custom metadata
        route.travelMode = req.travelMode;
        renderer.setDirections(asSingleResult(res, route));
      } catch {
        // ignore
      }
      setTimeout(() => (microProgrammaticRef.current[which] = false), 0);
    }

    onMicroLegDirectionsChanged?.(which, res, route);
  }

  function syncMicroDetours(which, seg) {
    clearMicroDetourMarkers(which);

    const viaPts = seg?.route ? extractViaPointsFromRoute(seg.route) : [];
    if (microViaPointsRef.current) microViaPointsRef.current[which] = viaPts;

    if (!viaPts?.length || !map) return;

    const icons = getIcons(iconsRef);

    microViaMarkersRef.current[which] = viaPts.map((p, idx) => {
      const marker = new window.google.maps.Marker({
        map,
        position: p,
        draggable: true,
        zIndex: 999999,
        icon: icons.detour,
        cursor: "pointer",
      });

      marker.addListener("click", async () => {
        const next = (microViaPointsRef.current?.[which] ?? []).filter((_, i) => i !== idx);
        if (microViaPointsRef.current) microViaPointsRef.current[which] = next;
        await rerouteMicroLegFromViaPoints(which, next);
      });

      marker.addListener("dragend", async (e) => {
        const ll = toLatLngLiteral(e?.latLng);
        if (!ll) return;
        const next = [...(microViaPointsRef.current?.[which] ?? [])];
        next[idx] = ll;
        if (microViaPointsRef.current) microViaPointsRef.current[which] = next;
        await rerouteMicroLegFromViaPoints(which, next);
      });

      return marker;
    });
  }

  async function ensureMicroRenderer(which, mode, seq) {
    if (isStaleSeq(seq)) return null;
    const { DirectionsRenderer } = await window.google.maps.importLibrary("routes");
    if (isStaleSeq(seq)) return null;

    const isFirst = which === "first";
    const existing = isFirst ? microFirstRendererRef.current : microLastRendererRef.current;

    if (existing) {
      try {
        existing.setOptions?.({
          polylineOptions: { strokeOpacity: 0.01, strokeWeight: 18, zIndex: 40 },
        });
      } catch {
        // ignore
      }
      return existing;
    }

    const renderer = new DirectionsRenderer({
      map,
      draggable: true,
      suppressMarkers: true,
      preserveViewport: true,
      hideRouteList: true,
      polylineOptions: { strokeOpacity: 0.01, strokeWeight: 18, zIndex: 40 },
    });

    const listener = renderer.addListener("directions_changed", () => {
      if (microProgrammaticRef.current[which]) return;
      const dir = renderer.getDirections?.();
      const r = dir?.routes?.[0];
      if (!r) return;
      onMicroLegDirectionsChanged?.(which, dir, r);
    });

    if (isFirst) {
      microFirstRendererRef.current = renderer;
      microFirstListenerRef.current = listener;
    } else {
      microLastRendererRef.current = renderer;
      microLastListenerRef.current = listener;
    }

    return renderer;
  }

  async function setMicroRendererDirections(which, seg, seq) {
    if (isStaleSeq(seq)) return;
    if (!seg?.route || !seg?.directionsResult) return;

    const renderer = await ensureMicroRenderer(which, seg.mode, seq);
    if (!renderer || isStaleSeq(seq)) return;

    const single = asSingleResult(seg.directionsResult, seg.route);
    if (!single || isStaleSeq(seq)) return;

    microProgrammaticRef.current[which] = true;
    try {
      renderer.setDirections(single);
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (!isStaleSeq(seq)) microProgrammaticRef.current[which] = false;
    }, 0);

    if (isStaleSeq(seq)) return;
    syncMicroDetours(which, seg);

    syncMicroShadow(which, seg.mode, seg.route);
    syncMicroMain(which, seg.mode, seg.route);

    // Ensure travelMode metadata exists for reroute requests.
    try {
      const tm = microLegTravelMode(seg);
      const dir = renderer.getDirections?.();
      const r = dir?.routes?.[0];
      if (r) r.travelMode = tm;
    } catch {
      // ignore
    }
  }

  function clearMicroRenderers() {
    const entries = [
      {
        ref: microFirstRendererRef,
        listenerRef: microFirstListenerRef,
        which: "first",
      },
      {
        ref: microLastRendererRef,
        listenerRef: microLastListenerRef,
        which: "last",
      },
    ];

    entries.forEach(({ ref, listenerRef, which }) => {
      const dr = ref.current;
      if (!dr) return;

      try {
        listenerRef.current?.remove?.();
      } catch {
        // ignore
      }
      listenerRef.current = null;

      try {
        microProgrammaticRef.current[which] = true;
        // NOTE: Some Maps JS builds throw (and can even hard-hang) when calling
        // setDirections(null). Detaching the renderer from the map is enough.
        dr.setMap(null);
      } catch {
        // ignore
      }

      microProgrammaticRef.current[which] = false;
      ref.current = null;
    });
  }

  function clearAllMicro() {
    clearMicroRenderers();
    clearMicroViaMarkers();
    clearAllMicroPolylines();
  }

  return {
    clearMicroDetourMarkers,
    clearMicroViaMarkers,
    clearMicroShadow,
    clearMicroMain,
    clearAllMicroPolylines,
    syncMicroShadow,
    syncMicroMain,
    syncMicroDetours,
    rerouteMicroLegFromViaPoints,
    ensureMicroRenderer,
    setMicroRendererDirections,
    clearMicroRenderers,
    clearAllMicro,
  };
}
