import { BIKE_MPH_ASSUMED, WALK_MPH_ASSUMED, SKATE_MPH_FLAT } from "./constants";

function cloneWithDescriptors(obj) {
  if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return obj;
  try {
    return Object.create(
      Object.getPrototypeOf(obj),
      Object.getOwnPropertyDescriptors(obj)
    );
  } catch {
    try {
      return Object.assign(Object.create(Object.getPrototypeOf(obj)), obj);
    } catch {
      return obj;
    }
  }
}

export function asSingleResult(res, route) {
  if (!res || !route) return null;

  const routes = Array.isArray(res?.routes) ? res.routes : null;
  if (routes?.length === 1 && routes[0] === route) return res;

  try {
    const clone = cloneWithDescriptors(res);
    clone.routes = [route];
    return clone;
  } catch {
    try {
      const wrapper = Object.create(res);
      wrapper.routes = [route];
      return wrapper;
    } catch {
      return res;
    }
  }
}

export function skateSecondsFromBase(seg, baseSec) {
  if (!Number.isFinite(baseSec)) return baseSec;
  const geom = seg?.skateGeometryMode;
  if (geom === "WALKING") return baseSec * (WALK_MPH_ASSUMED / SKATE_MPH_FLAT);
  return baseSec * (BIKE_MPH_ASSUMED / SKATE_MPH_FLAT);
}

export function microLegTravelMode(seg) {
  if (!seg) return "WALKING";
  if (seg.mode === "WALK") return "WALKING";
  if (seg.mode === "BIKE") return "BICYCLING";
  if (seg.mode === "SKATE") {
    return seg.skateGeometryMode === "WALKING" ? "WALKING" : "BICYCLING";
  }
  return "WALKING";
}
