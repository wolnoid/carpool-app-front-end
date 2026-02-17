import { extractViaPointsFromRoute } from "../../maps/directionsUtils";
import { createDetourIcon, createEndIcon, createStartIcon } from "../../maps/markerIcons";
import { populatePlacePickerFromLatLng } from "../../maps/placePicker";
import { disposeAnyMarker, toLatLngLiteral } from "../../maps/googleUtils";
import { SEARCH_TRIGGER } from "../../routing/urlState";

export function getIcons(iconsRef) {
  const cur = iconsRef.current;
  if (cur?.start && cur?.end && cur?.detour) return cur;

  const detour = createDetourIcon();
  const start = createStartIcon();
  const end = createEndIcon();

  iconsRef.current = { detour, start, end };
  return iconsRef.current;
}

export function clearRouteMarkers({ markersRef, viaPointsRef }) {
  const m = markersRef.current;
  if (!m) return;

  disposeAnyMarker(m.start);
  disposeAnyMarker(m.end);
  (m.vias ?? []).forEach(disposeAnyMarker);

  markersRef.current = { start: null, end: null, vias: [] };
  viaPointsRef.current = [];
}

function normalizeViaPoints(viaPoints) {
  if (!Array.isArray(viaPoints)) return [];
  return viaPoints
    .map((p) => toLatLngLiteral(p))
    .filter(Boolean)
    .map((p) => ({ lat: p.lat, lng: p.lng }));
}

function viaListsEqual(a, b) {
  const left = normalizeViaPoints(a);
  const right = normalizeViaPoints(b);
  if (left.length !== right.length) return false;

  const key = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  for (let i = 0; i < left.length; i += 1) {
    if (key(left[i]) !== key(right[i])) return false;
  }
  return true;
}

function ensureEndpointMarker({ map, currentMarker, position, icon, title, onDragEnd }) {
  if (!position) return currentMarker;

  if (!currentMarker) {
    const marker = new window.google.maps.Marker({
      map,
      position,
      draggable: true,
      zIndex: 999990,
      icon,
      title,
    });

    marker.addListener("dragend", async (e) => {
      const ll = toLatLngLiteral(e?.latLng);
      if (!ll) return;
      await onDragEnd(ll);
    });

    return marker;
  }

  currentMarker.setPosition(position);
  currentMarker.setIcon(icon);
  return currentMarker;
}

export function syncMarkersFromRoute({
  map,
  markersRef,
  iconsRef,
  viaPointsRef,
  draftViaPointsRef,
  committedViaPointsRef,
  originPickerRef,
  destPickerRef,
  markFromPicked,
  setOrigin,
  setDestination,
  buildRoute,
  rebuildWithoutAlternatives,
}, route) {
  if (!map) return;

  const legs = route?.legs ?? [];
  if (!route || !legs.length) {
    clearRouteMarkers({ markersRef, viaPointsRef });
    if (draftViaPointsRef) draftViaPointsRef.current = [];
    if (committedViaPointsRef) committedViaPointsRef.current = [];
    return;
  }

  const icons = getIcons(iconsRef);

  const startPos = toLatLngLiteral(legs[0]?.start_location);
  const endPos = toLatLngLiteral(legs[legs.length - 1]?.end_location);

  markersRef.current.start = ensureEndpointMarker({
    map,
    currentMarker: markersRef.current.start,
    position: startPos,
    icon: icons.start,
    title: "Start",
    onDragEnd: async (ll) => {
      markFromPicked?.();
      setOrigin(ll);
      populatePlacePickerFromLatLng(originPickerRef.current, ll);

      await buildRoute({
        originOverride: ll,
        alternatives: true,
        fitToRoutes: true,
        triggerType: SEARCH_TRIGGER.EXPLICIT_MARKER_SET_FROM,
      });
    },
  });

  markersRef.current.end = ensureEndpointMarker({
    map,
    currentMarker: markersRef.current.end,
    position: endPos,
    icon: icons.end,
    title: "Destination",
    onDragEnd: async (ll) => {
      setDestination(ll);
      populatePlacePickerFromLatLng(destPickerRef.current, ll);

      await buildRoute({
        destinationOverride: ll,
        alternatives: true,
        fitToRoutes: true,
        triggerType: SEARCH_TRIGGER.EXPLICIT_MARKER_SET_TO,
      });
    },
  });

  const viaPts = extractViaPointsFromRoute(route);
  viaPointsRef.current = viaPts;
  if (draftViaPointsRef) draftViaPointsRef.current = viaPts;

  async function applyDetourDraft(next, triggerType) {
    const nextDraft = normalizeViaPoints(next);
    viaPointsRef.current = nextDraft;
    if (draftViaPointsRef) draftViaPointsRef.current = nextDraft;

    const res = await rebuildWithoutAlternatives(nextDraft, { triggerType });
    if (res?.success) return;

    const committed = normalizeViaPoints(committedViaPointsRef?.current ?? []);
    if (viaListsEqual(nextDraft, committed)) return;

    viaPointsRef.current = committed;
    if (draftViaPointsRef) draftViaPointsRef.current = committed;
    await rebuildWithoutAlternatives(committed, {
      suppressSuccessNotify: true,
    });
  }

  markersRef.current.vias.forEach(disposeAnyMarker);
  markersRef.current.vias = viaPts.map((p, idx) => {
    const marker = new window.google.maps.Marker({
      map,
      position: p,
      draggable: true,
      zIndex: 999999,
      icon: icons.detour,
      cursor: "pointer",
    });

    marker.addListener("click", async () => {
      const next = viaPointsRef.current.filter((_, i) => i !== idx);
      await applyDetourDraft(next, SEARCH_TRIGGER.ADJUSTMENT_DETOUR_REMOVE);
    });

    marker.addListener("dragend", async (e) => {
      const ll = toLatLngLiteral(e?.latLng);
      if (!ll) return;

      const next = [...viaPointsRef.current];
      next[idx] = ll;
      await applyDetourDraft(next, SEARCH_TRIGGER.ADJUSTMENT_DETOUR_DRAG_END);
    });

    return marker;
  });
}

export function syncMarkersFromEndpoints({
  map,
  markersRef,
  iconsRef,
  viaPointsRef,
  draftViaPointsRef,
  committedViaPointsRef,
  originPickerRef,
  destPickerRef,
  markFromPicked,
  setOrigin,
  setDestination,
  buildRoute,
}, origin, destination) {
  if (!map) return;

  const icons = getIcons(iconsRef);
  const startPos = toLatLngLiteral(origin);
  const endPos = toLatLngLiteral(destination);
  if (!startPos || !endPos) return;

  // Hybrid currently ignores via-point detours (they're tied to DirectionsRenderer).
  // We still keep draggable endpoints so users can adjust origin/destination.
  markersRef.current.vias.forEach(disposeAnyMarker);
  markersRef.current.vias = [];
  viaPointsRef.current = [];
  if (draftViaPointsRef) draftViaPointsRef.current = [];
  if (committedViaPointsRef) committedViaPointsRef.current = [];

  markersRef.current.start = ensureEndpointMarker({
    map,
    currentMarker: markersRef.current.start,
    position: startPos,
    icon: icons.start,
    title: "Start",
    onDragEnd: async (ll) => {
      markFromPicked?.();
      setOrigin(ll);
      populatePlacePickerFromLatLng(originPickerRef.current, ll);
      await buildRoute({
        originOverride: ll,
        alternatives: true,
        fitToRoutes: true,
        triggerType: SEARCH_TRIGGER.EXPLICIT_MARKER_SET_FROM,
      });
    },
  });

  markersRef.current.end = ensureEndpointMarker({
    map,
    currentMarker: markersRef.current.end,
    position: endPos,
    icon: icons.end,
    title: "Destination",
    onDragEnd: async (ll) => {
      setDestination(ll);
      populatePlacePickerFromLatLng(destPickerRef.current, ll);
      await buildRoute({
        destinationOverride: ll,
        alternatives: true,
        fitToRoutes: true,
        triggerType: SEARCH_TRIGGER.EXPLICIT_MARKER_SET_TO,
      });
    },
  });
}
