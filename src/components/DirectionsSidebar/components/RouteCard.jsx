import { useMemo } from "react";

import styles from "../styles/styles.js";

import { ItinBubble } from "./ItineraryBar";
import { MODE_META } from "./icons";

import { buildRouteDetailsModel } from "../model/routeDetailsModel";
import { buildSidebarSegments } from "../utils/sidebarSegments";
import {
  extractPrimaryPathNameFromSteps,
  formatDistanceMi,
  minutesText,
  shortTransitAgencyName,
  transitModeWordFromType,
  truncateText,
  vehicleGlyphFromType,
  timeRangeTextForOption,
} from "../utils/sidebarFormat";
import { carryHiddenMinuteMoves, useItinerarySegmentsFit } from "../utils/itineraryFit";

function lineAlreadyIncludesMode(line, modeWord) {
  const l = String(line || "").trim().toLowerCase();
  const m = String(modeWord || "").trim().toLowerCase();
  return Boolean(l && m && l.includes(m));
}

function RouteCard({ option, selected, expanded, onSelect, onDetails, routeCombo }) {
  const allSegs = useMemo(() => buildSidebarSegments(option, routeCombo), [option, routeCombo]);
  const baseSegs = useMemo(() => carryHiddenMinuteMoves(allSegs), [allSegs]);
  const { barRef: itinBarRef, segs } = useItinerarySegmentsFit(baseSegs);

  const timeText = timeRangeTextForOption(option);
  const durationText = option?.durationText || "—";

  const previewLines = useMemo(() => {
    if (!expanded) return [];

    const model = buildRouteDetailsModel(option);
    const segs2 = carryHiddenMinuteMoves(model?.segments ?? []);
    if (!segs2.length) return [];

    const out = [];

    for (let i = 0; i < segs2.length; i++) {
      const s = segs2[i];
      const mins = Math.max(0, Math.round(Number(s.durationSec || 0) / 60));
      if (mins <= 0) continue;

      const dur = minutesText(s.durationSec);
      const mode = String(s.mode || "").toUpperCase();

      if (mode === "WAIT") {
        const at = s.at ? ` at ${s.at}` : "";
        out.push(`⏳ ${dur} • Wait${at}`);
        continue;
      }

      if (mode === "TRANSIT") {
        const t = s.transit || {};
        const glyph = vehicleGlyphFromType(t.vehicle || "");
        const line = String(t.shortName || "").trim();
        const modeWord = String(transitModeWordFromType(t.vehicle || "") || "").trim();
        const lineWithMode = line
          ? lineAlreadyIncludesMode(line, modeWord)
            ? line
            : `${line}${modeWord ? ` ${modeWord}` : ""}`
          : (modeWord || "Transit");
        const agency = shortTransitAgencyName(t.agency || "");

        // Requirement: "21 bus • SacRT" (mode after route name)
        const parts = [lineWithMode, agency].filter(Boolean);
        out.push(`${glyph} ${dur} • ${parts.join(" • ")}`);
        continue;
      }

      // Non-transit move (walk/bike/skate)
      const meta = MODE_META[mode] || MODE_META.WALK;
      const emoji = meta?.dot || "🚶";
      const dist = formatDistanceMi(s.distanceMeters);
      const path = truncateText(extractPrimaryPathNameFromSteps(s.steps), 28);

      const parts = [dur, dist, path].filter(Boolean);
      out.push(`${emoji} ${parts.join(" • ")}`);
    }

    return out;
  }, [expanded, option]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={`${styles.routeCard} ${selected ? styles.routeCardSelected : ""}`}
    >
      <span className={`${styles.routeAccent} ${selected ? styles.routeAccentSelected : ""}`} />

      <div className={styles.routeCardInner}>
        <div className={styles.routeTopRow}>
          <div className={styles.routeTopLeft}>
            <div className={styles.routeDepArr}>{timeText}</div>
          </div>

          <div className={styles.routeTopRight}>
            <div className={styles.routeDurationBig}>{durationText}</div>
          </div>
        </div>

        <div ref={itinBarRef} className={styles.itinBar}>
          {segs.map((s) => (
            <ItinBubble key={s.key} seg={s} />
          ))}
        </div>

        {expanded ? (
          <div className={styles.routeExpanded}>
            <div className={styles.previewListText}>
              {previewLines.map((line, i) => (
                <div key={i} className={styles.previewLine}>
                  {line}
                </div>
              ))}
            </div>

            <div className={styles.detailsRow}>
              <button
                type="button"
                className={styles.detailsBtn}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDetails?.();
                }}
              >
                Details
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { RouteCard };
