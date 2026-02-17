// Split from src/routing/hybridPlanner.js
import { GOOGLE_BLUE, ALT_GRAY } from "./utils";

export function polylineStyleForMode(mode, { isAlt = false } = {}) {
  const strokeColor = isAlt ? ALT_GRAY : GOOGLE_BLUE;
  const strokeWeight = isAlt ? 6 : 8;
  // Alternates should stay in the background, but still be readable.
  const strokeOpacity = isAlt ? 0.6 : 1;

  // NOTE: dotted is done via icons so we can match Google-like walking patterns.
  if (mode === "WALK") {
    return {
      strokeOpacity: 0,
      strokeColor,
      strokeWeight,
      icons: [
        {
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 2,
            fillColor: strokeColor,
            fillOpacity: 1,
            strokeColor,
            strokeOpacity: 0,
            strokeWeight: 0,
          },
          offset: "0",
          repeat: "10px",
        },
      ],
    };
  }

  // BIKE + SKATE are solid (same visual treatment).
  return { strokeColor, strokeOpacity, strokeWeight };
}

export const HYBRID_STYLES = {
  GOOGLE_BLUE,
  ALT_GRAY,
};
