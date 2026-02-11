import { getDetourIconUrl, getStartIconUrl, getEndIconUrl } from "./markerIconSvgs";

function googleSizePoint() {
  const Size = window.google?.maps?.Size;
  const Point = window.google?.maps?.Point;
  return Size && Point ? { Size, Point } : null;
}

export function createDetourIcon() {
  const url = getDetourIconUrl();
  const gp = googleSizePoint();
  if (!gp) return { url };
  const { Size, Point } = gp;
  return { url, scaledSize: new Size(20, 20), anchor: new Point(10, 10) };
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