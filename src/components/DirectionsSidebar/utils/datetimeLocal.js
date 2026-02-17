export function toDatetimeLocalValue(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");

  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());

  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function fromDatetimeLocalValue(s) {
  if (!s) return null;
  const [datePart, timePart] = s.split("T");
  if (!datePart || !timePart) return null;

  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);

  if (![y, m, d, hh, mm].every(Number.isFinite)) return null;

  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
