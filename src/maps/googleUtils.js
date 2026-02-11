export function toLatLngLiteral(ll) {
  if (!ll) return null;

  // google.maps.LatLng
  if (typeof ll.lat === "function" && typeof ll.lng === "function") {
    const lat = ll.lat();
    const lng = ll.lng();
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  // literal
  const lat = ll.lat;
  const lng = ll.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function latLngToNums(p) {
  return toLatLngLiteral(p);
}

// Robustly dispose either google.maps.Marker or AdvancedMarkerElement
export function disposeAnyMarker(m) {
  if (!m) return;

  try {
    if (window.google?.maps?.event?.clearInstanceListeners) {
      window.google.maps.event.clearInstanceListeners(m);
    }
  } catch {
    // ignore
  }

  // Marker
  if (typeof m.setMap === "function") {
    try {
      m.setMap(null);
    } catch {
      // ignore
    }
    return;
  }

  // AdvancedMarkerElement
  if ("map" in m) {
    try {
      m.map = null;
    } catch {
      // ignore
    }
  }
}
