// Utilities extracted from DirectionsSidebar.jsx
import { shortTransitAgencyName } from "../../../routing/routeFormat";

function normalizeHexColor(c) {
  if (!c || typeof c !== "string") return null;
  let s = c.trim();
  if (!s) return null;
  if (!s.startsWith("#")) return null;
  s = s.slice(1);
  if (s.length === 3) {
    s = s
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (s.length !== 6) return null;
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toUpperCase()}`;
}

function readableTextColor(bg) {
  // If it's not a hex color, default to dark text.
  const hex = normalizeHexColor(bg);
  if (!hex) return "rgba(0,0,0,0.86)";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived luminance (YIQ-ish)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq < 150 ? "rgba(255,255,255,0.96)" : "rgba(0,0,0,0.86)";
}

function vehicleGlyphFromType(type) {
  const t = String(type || "").toUpperCase();
  if (t.includes("BUS")) return "🚌";
  if (t.includes("TRAM") || t.includes("LIGHT_RAIL")) return "🚊";
  if (t.includes("SUBWAY") || t.includes("METRO") || t.includes("HEAVY_RAIL")) return "🚇";
  if (t.includes("RAIL") || t.includes("TRAIN")) return "🚆";
  if (t.includes("FERRY")) return "⛴️";
  return "🚉";
}

function getExplicitLineColor(transitDetails) {
  const line = transitDetails?.line;
  return normalizeHexColor(line?.color) || normalizeHexColor(line?.color_hex) || null;
}

function transitLabel(transitDetails) {
  const line = transitDetails?.line;
  // Per requirement: short_name only. If absent, keep it generic.
  return line?.short_name || line?.shortName || "Transit";
}


function transitModeWordFromType(typeOrName) {
  const t = String(typeOrName || "").toUpperCase();
  if (!t) return "";
  if (t.includes("BUS")) return "bus";
  if (t.includes("TRAM") || t.includes("LIGHT_RAIL")) return "tram";
  if (t.includes("SUBWAY") || t.includes("METRO") || t.includes("HEAVY_RAIL")) return "subway";
  if (t.includes("FERRY")) return "ferry";
  if (t.includes("CABLE_CAR")) return "cable car";
  if (t.includes("GONDOLA")) return "gondola";
  if (t.includes("FUNICULAR")) return "funicular";
  if (t.includes("MONORAIL")) return "monorail";
  if (t.includes("RAIL") || t.includes("TRAIN")) return "train";
  return "";
}

function transitLineWithMode(transitDetails) {
  const line = transitLabel(transitDetails);
  const mode = transitModeWordFromType(transitVehicleType(transitDetails));

  if (line && line !== "Transit" && mode) return `${line} ${mode}`;
  return line || mode || "Transit";
}


function transitVehicleType(transitDetails) {
  const line = transitDetails?.line;
  return line?.vehicle?.type || line?.vehicle?.name || transitDetails?.line?.vehicle?.type || "";
}

function stepTransitDetails(step) {
  return step?.transit || step?.transit_details || step?.transitDetails || null;
}

function stepInstructionText(step) {
  return stripHtml(step?.html || step?.instructions || step?.html_instructions || "");
}

function isFerryStep(step) {
  if (!step) return false;

  const td = stepTransitDetails(step);
  const transitType = transitVehicleType(td);
  if (String(transitType || "").toUpperCase().includes("FERRY")) return true;

  const maneuver = String(step?.maneuver || "").toUpperCase();
  if (maneuver.includes("FERRY")) return true;

  const text = stepInstructionText(step);
  return /\bferry\b/i.test(text);
}

function ferryLabelFromStep(step, fallback = "Ferry") {
  const td = stepTransitDetails(step);
  const transitName = transitLabel(td);
  if (transitName && transitName !== "Transit") return transitName;

  const text = stepInstructionText(step);
  const match = text.match(/\b(?:take|board)\s+(?:the\s+)?(.+?)\s+ferry\b/i);
  if (match?.[1]) {
    const raw = match[1].replace(/\s+/g, " ").trim();
    if (raw) return `${raw} ferry`;
  }

  return /\bferry\b/i.test(text) ? "Ferry" : fallback;
}

function transitLegLabel(step, transitDetails, fallback = "Transit") {
  const td = transitDetails ?? stepTransitDetails(step);
  const base = transitLabel(td);
  const ferryByType = String(transitVehicleType(td) || "").toUpperCase().includes("FERRY");
  const ferryByStep = isFerryStep(step);

  if (ferryByType || ferryByStep) {
    if (base && base !== "Transit") return base;
    return ferryLabelFromStep(step, "Ferry");
  }

  return base || fallback;
}

function transitServiceName(transitDetails) {
  const line = transitDetails?.line;
  const agencies = line?.agencies || line?.agency || transitDetails?.agencies || [];
  const a0 = Array.isArray(agencies) ? agencies[0] : agencies;
  return a0?.name || a0?.short_name || a0?.shortName || "";
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(s, max = 28) {
  const t = String(s || "").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function extractPrimaryPathNameFromSteps(steps) {
  const arr = Array.isArray(steps) ? steps : [];
  for (const st of arr) {
    const instr = stripHtml(st?.html || st?.instructions || st?.html_instructions || "");
    if (!instr) continue;

    // Common Google phrasing: "Head north on X", "Turn left onto X".
    const m = instr.match(/(?:on|onto)\s+([^,]+?)(?:\s+(?:toward|to|for|and|then|at)|$)/i);
    if (m && m[1]) {
      const name = m[1].trim();
      if (name && !/your destination/i.test(name)) return name;
    }
  }
  return "";
}

function flattenGoogleStepList(steps) {
  const arr = Array.isArray(steps) ? steps : [];
  const out = [];

  for (const st of arr) {
    const subs = Array.isArray(st?.steps) && st.steps.length ? st.steps : [st];
    for (const sub of subs) {
      out.push({
        html: sub?.instructions || sub?.html_instructions || "",
        distanceText: sub?.distance?.text || "",
        durationText: sub?.duration?.text || "",
      });
    }
  }

  return out;
}


function segMinutes(sec) {
  const m = Math.max(0, Math.round((Number(sec) || 0) / 60));
  return `${m}m`;
}

function minutesText(sec) {
  const m = Math.max(0, Math.round((Number(sec) || 0) / 60));
  return m === 1 ? "1 minute" : `${m} minutes`;
}

function formatDistanceMi(meters) {
  const mi = (Number(meters) || 0) / 1609.344;
  if (!mi) return "";
  return mi >= 10 ? `${mi.toFixed(0)} mi` : `${mi.toFixed(1)} mi`;
}

function timeRangeTextForOption(option) {
  const dep = option?.departTimeText || "";
  const arr = option?.arriveTimeText || "";
  if (dep && arr) return `${dep} - ${arr}`;
  const t = option?.timeText || option?.timeRangeText || "";
  return String(t).replace(/–|—/g, "-").replace(/\s*-\s*/g, " - ");
}


function coerceDate(d) {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d;
  // Some Google objects have { value: Date }
  if (d?.value instanceof Date) return Number.isNaN(d.value.getTime()) ? null : d.value;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t;
}


export {
  normalizeHexColor,
  shortTransitAgencyName,
  readableTextColor,
  vehicleGlyphFromType,
  getExplicitLineColor,
  transitLabel,
  transitModeWordFromType,
  transitLineWithMode,
  transitVehicleType,
  stepTransitDetails,
  stepInstructionText,
  isFerryStep,
  ferryLabelFromStep,
  transitLegLabel,
  transitServiceName,
  stripHtml,
  truncateText,
  extractPrimaryPathNameFromSteps,
  flattenGoogleStepList,
  segMinutes,
  minutesText,
  formatDistanceMi,
  timeRangeTextForOption,
  coerceDate,
};
