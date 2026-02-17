import { ROUTE_COMBO } from "../../routing/routeCombos";
import { HYBRID_STYLES, polylineStyleForMode } from "../../routing/hybridPlanner/styles";
import {
  decodeStepPath,
  routeHasTransitSteps,
  getTransitDetailsFromStep,
  getTransitLineColor,
  getRouteOverviewPath,
  dottedStyle,
  styleIsDotted,
  DEFAULT_TRANSIT_BLUE,
} from "./polylineStyles";

export function clearPrimaryPolylines(primaryPolylinesRef) {
  (primaryPolylinesRef.current ?? []).forEach((p) => {
    try {
      p.setMap(null);
    } catch {
      // ignore
    }
  });
  primaryPolylinesRef.current = [];
}

export function drawPrimaryPolylinesFromRoute({
  map,
  routeComboRef,
  travelModeRef,
  primaryPolylinesRef,
  addShadowPolyline,
  registerPolylineBase,
}, route) {
  if (!map || !route) return;
  clearPrimaryPolylines(primaryPolylinesRef);

  const combo = routeComboRef?.current ?? null;
  const travelMode = travelModeRef.current ?? "TRANSIT";
  const isTransit = travelMode === "TRANSIT" || routeHasTransitSteps(route);

  const zIndex = 30;

  if (isTransit) {
    const WALK_COLOR = "#5F6368"; // Google-ish gray for walking legs

    const legs = route?.legs ?? [];
    legs.forEach((leg) => {
      const steps = leg?.steps ?? [];
      steps.forEach((step) => {
        const mode = step?.travel_mode;
        const path = decodeStepPath(step);
        if (!path?.length) return;

        let polylineOptions = null;

        if (mode === "TRANSIT") {
          const td = getTransitDetailsFromStep(step);
          const lineColor = getTransitLineColor(td, DEFAULT_TRANSIT_BLUE);
          polylineOptions = {
            strokeColor: lineColor,
            strokeOpacity: 1,
            strokeWeight: 8,
          };
        } else if (mode === "WALKING") {
          polylineOptions = dottedStyle({
            color: WALK_COLOR,
            scale: 2,
            repeat: "10px",
            strokeWeight: 8,
          });
        } else if (mode === "BICYCLING") {
          polylineOptions = {
            strokeColor: HYBRID_STYLES.GOOGLE_BLUE,
            strokeOpacity: 1,
            strokeWeight: 8,
          };
        } else {
          polylineOptions = {
            strokeColor: HYBRID_STYLES.GOOGLE_BLUE,
            strokeOpacity: 1,
            strokeWeight: 8,
          };
        }

        const shadow = addShadowPolyline({
          path,
          strokeWeight: polylineOptions?.strokeWeight ?? 8,
          zIndex,
          isAlt: false,
          skip: styleIsDotted(polylineOptions),
        });
        if (shadow) primaryPolylinesRef.current.push(shadow);

        const poly = new window.google.maps.Polyline({
          map,
          path,
          clickable: false,
          ...polylineOptions,
          zIndex,
        });
        registerPolylineBase(poly);
        primaryPolylinesRef.current.push(poly);
      });
    });

    return;
  }

  // Non-transit: draw a single overview polyline.
  const path = getRouteOverviewPath(route);
  if (!path?.length) return;

  let style = {
    strokeColor: HYBRID_STYLES.GOOGLE_BLUE,
    strokeOpacity: 1,
    strokeWeight: 8,
  };

  if (combo === ROUTE_COMBO.SKATE) style = polylineStyleForMode("SKATE", { isAlt: false });
  else if (travelMode === "WALKING") style = polylineStyleForMode("WALK", { isAlt: false });
  else if (travelMode === "BICYCLING")
    style = polylineStyleForMode("BIKE", { isAlt: false });

  const shadow = addShadowPolyline({
    path,
    strokeWeight: style?.strokeWeight ?? 8,
    zIndex,
    isAlt: false,
    skip: styleIsDotted(style),
  });
  if (shadow) primaryPolylinesRef.current.push(shadow);

  const poly = new window.google.maps.Polyline({
    map,
    path,
    clickable: false,
    ...style,
    zIndex,
  });
  registerPolylineBase(poly);
  primaryPolylinesRef.current.push(poly);
}
