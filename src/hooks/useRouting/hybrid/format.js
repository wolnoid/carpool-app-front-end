export function fmtDurationSec(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "0 min";
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function fmtTime(date) {
  try {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function fmtDistanceMeters(meters) {
  if (!Number.isFinite(meters)) return "";
  const miles = meters / 1609.344;
  if (miles < 0.1) return Math.round(meters) + " m";
  if (miles < 10) return miles.toFixed(1) + " mi";
  return Math.round(miles) + " mi";
}

export function fmtPct(p) {
  if (!Number.isFinite(p)) return "";
  return `${Math.round(p * 100)}%`;
}
