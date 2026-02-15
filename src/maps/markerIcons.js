import { getDetourIconUrl, getStartIconUrl, getEndIconUrl } from "./markerIconSvgs";

function googleSizePoint() {
  const Size = window.google?.maps?.Size;
  const Point = window.google?.maps?.Point;
  return Size && Point ? { Size, Point } : null;
}

// Bump this when you change the detour SVG.
// This helps bust any internal caching (Google Maps + your iconsRef memoization).
const DETOUR_ICON_VERSION = "v3";

export function createDetourIcon() {
  // Adding a fragment makes the URL string change (cache-bust) while keeping the same data payload.
  const url = `${getDetourIconUrl()}#${DETOUR_ICON_VERSION}`;
  const gp = googleSizePoint();
  if (!gp) return { url };
  const { Size, Point } = gp;

  // Closer to Google’s draggable route-point handles: ~16px at rest.
  // (The underlying SVG is 48×48 and is scaled down for crispness on HiDPI.)
  const px = 14;
  return { url, scaledSize: new Size(px, px), anchor: new Point(px / 2, px / 2) };
}

export function createStartIcon() {
  const url = getStartIconUrl();
  const gp = googleSizePoint();
  if (!gp) return { url };
  const { Size, Point } = gp;
  return { url, scaledSize: new Size(26, 26), anchor: new Point(13, 13) };
}

export function createEndIcon() {
  const url = getEndIconUrl();
  const gp = googleSizePoint();
  if (!gp) return { url };
  const { Size, Point } = gp;
  return { url, scaledSize: new Size(32, 44), anchor: new Point(16, 43) };
}
