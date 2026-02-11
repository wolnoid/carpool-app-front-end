export const ROUTE_COMBO = {
  TRANSIT: "TRANSIT",
  TRANSIT_BIKE: "TRANSIT_BIKE",
  BIKE: "BIKE",
  TRANSIT_SKATE: "TRANSIT_SKATE",
  SKATE: "SKATE",
};

export const SKATE_SPEED_MPH = 6;
export const MPH_TO_MPS = 1609.344 / 3600;
export const SKATE_SPEED_MPS = SKATE_SPEED_MPH * MPH_TO_MPS;

export function isTransitOn(combo) {
  return combo === ROUTE_COMBO.TRANSIT || combo === ROUTE_COMBO.TRANSIT_BIKE || combo === ROUTE_COMBO.TRANSIT_SKATE;
}
export function isBikeOn(combo) {
  return combo === ROUTE_COMBO.BIKE || combo === ROUTE_COMBO.TRANSIT_BIKE;
}
export function isSkateOn(combo) {
  return combo === ROUTE_COMBO.SKATE || combo === ROUTE_COMBO.TRANSIT_SKATE;
}

/**
 * Click behavior:
 * - Default TRANSIT
 * - Clicking Bike from TRANSIT => TRANSIT_BIKE
 * - Clicking Skate from TRANSIT => TRANSIT_SKATE
 * - If TRANSIT_BIKE active and click Transit => BIKE (drop transit)
 * - If BIKE active and click Transit => TRANSIT_BIKE (add transit)
 * - same for SKATE
 */
export function nextCombo(current, clicked) {
  if (clicked === "TRANSIT") {
    if (current === ROUTE_COMBO.TRANSIT_BIKE) return ROUTE_COMBO.BIKE;
    if (current === ROUTE_COMBO.TRANSIT_SKATE) return ROUTE_COMBO.SKATE;
    if (current === ROUTE_COMBO.BIKE) return ROUTE_COMBO.TRANSIT_BIKE;
    if (current === ROUTE_COMBO.SKATE) return ROUTE_COMBO.TRANSIT_SKATE;
    return ROUTE_COMBO.TRANSIT;
  }

  if (clicked === "BIKE") {
    if (current === ROUTE_COMBO.BIKE) return ROUTE_COMBO.TRANSIT_BIKE;
    if (current === ROUTE_COMBO.TRANSIT_BIKE) return ROUTE_COMBO.BIKE;
    return ROUTE_COMBO.TRANSIT_BIKE; // from TRANSIT or SKATE states
  }

  if (clicked === "SKATE") {
    if (current === ROUTE_COMBO.SKATE) return ROUTE_COMBO.TRANSIT_SKATE;
    if (current === ROUTE_COMBO.TRANSIT_SKATE) return ROUTE_COMBO.SKATE;
    return ROUTE_COMBO.TRANSIT_SKATE;
  }

  return current;
}
