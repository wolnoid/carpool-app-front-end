// --- Route line shadow / edge outline (Google-ish) ---
// Implemented as a slightly thicker, low-opacity black polyline drawn beneath the main line.

const SHADOW_COLOR = "#000000";
const SHADOW_OPACITY_PRIMARY = 0.4;
const SHADOW_OPACITY_ALT = 0.14;
const SHADOW_EXTRA_PX = 4;

// Overlap masking (alternate routes): slightly stricter clipping to reduce bleed-through.
const OVERLAP_MASK_MIN_PX = 8;
const OVERLAP_MASK_FACTOR = 0.68;
export const OVERLAP_MASK_PARALLEL_DOT_MIN = 0.7; // ~46 degrees

export function overlapMaskThresholdPx(strokeWeight) {
  return Math.max(
    OVERLAP_MASK_MIN_PX,
    (strokeWeight + SHADOW_EXTRA_PX) * OVERLAP_MASK_FACTOR
  );
}

export function createShadowDrawer({ map, registerPolylineBase }) {
  function addShadowPolyline({
    path,
    strokeWeight = 8,
    zIndex = 0,
    isAlt = false,
    skip = false,
  }) {
    if (skip) return null;

    if (!map || !path?.length) return null;

    try {
      const poly = new window.google.maps.Polyline({
        map,
        path,
        clickable: false,
        strokeColor: SHADOW_COLOR,
        strokeOpacity: isAlt ? SHADOW_OPACITY_ALT : SHADOW_OPACITY_PRIMARY,
        strokeWeight: Math.max(1, (strokeWeight ?? 8) + SHADOW_EXTRA_PX),
        // Ensure shadow stays under the main line even when zIndex is 0.
        zIndex: (zIndex ?? 0) - 1,
      });
      registerPolylineBase(poly);
      return poly;
    } catch {
      return null;
    }
  }

  return { addShadowPolyline };
}
