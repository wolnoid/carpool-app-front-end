import { useLayoutEffect, useMemo, useRef, useState } from "react";

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
  const expandedRef = useRef(null);
  const previewListRef = useRef(null);
  const detailsBtnRef = useRef(null);
  const [inlineLayout, setInlineLayout] = useState({ enabled: false, tailCount: 1 });
  const canInlineDetails = inlineLayout.enabled;
  const inlineTailCount = Math.max(1, inlineLayout.tailCount || 1);

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

  useLayoutEffect(() => {
    if (!expanded) {
      setInlineLayout((prev) => (prev.enabled ? { enabled: false, tailCount: 1 } : prev));
      return undefined;
    }

    const expandedEl = expandedRef.current;
    const previewEl = previewListRef.current;
    const detailsBtnEl = detailsBtnRef.current;
    if (!expandedEl || !previewEl || !detailsBtnEl) return undefined;

    const GAP_PX = 10;
    const INLINE_TOP_MARGIN_PX = 4;

    const measure = () => {
      const fullWidth = Math.max(0, expandedEl.clientWidth);
      const detailsWidth = Math.ceil(detailsBtnEl.getBoundingClientRect().width);
      const detailsHeight = Math.ceil(detailsBtnEl.getBoundingClientRect().height);
      const availableTextWidth = fullWidth - detailsWidth - GAP_PX;
      if (availableTextWidth <= 0) {
        setInlineLayout((prev) => (prev.enabled ? { enabled: false, tailCount: prev.tailCount || 1 } : prev));
        return;
      }

      if (!previewLines.length) {
        setInlineLayout((prev) => (prev.enabled ? { enabled: false, tailCount: 1 } : prev));
        return;
      }

      const sampleLineEl = previewEl.querySelector(`.${styles.previewLine}`);
      const lineStyle =
        sampleLineEl && typeof window !== "undefined"
          ? window.getComputedStyle(sampleLineEl)
          : typeof window !== "undefined"
            ? window.getComputedStyle(previewEl)
            : null;

      const lineGapRaw =
        lineStyle?.rowGap ||
        lineStyle?.gap ||
        (typeof window !== "undefined" ? window.getComputedStyle(previewEl).rowGap : "") ||
        (typeof window !== "undefined" ? window.getComputedStyle(previewEl).gap : "");
      const lineGap = Number.parseFloat(lineGapRaw) || 6;

      const lineHeightRaw = Number.parseFloat(lineStyle?.lineHeight || "");
      const lineHeight =
        Number.isFinite(lineHeightRaw) && lineHeightRaw > 0
          ? lineHeightRaw
          : sampleLineEl?.getBoundingClientRect().height || 16;

      const perLineBlock = Math.max(1, lineHeight + lineGap);
      const tailCount = Math.min(previewLines.length, Math.max(1, Math.ceil((detailsHeight + INLINE_TOP_MARGIN_PX) / perLineBlock)));
      const startIdx = Math.max(0, previewLines.length - tailCount);
      const indicesToCheck = Array.from({ length: previewLines.length - startIdx }, (_, i) => startIdx + i);

      let ctx = null;
      try {
        if (typeof document !== "undefined" && lineStyle) {
          const canvas = document.createElement("canvas");
          const nextCtx = canvas.getContext("2d");
          if (nextCtx) {
            nextCtx.font = `${lineStyle.fontStyle || "normal"} ${lineStyle.fontWeight || "400"} ${
              lineStyle.fontSize || "13px"
            } ${
              lineStyle.fontFamily || "system-ui"
            }`;
            ctx = nextCtx;
          }
        }
      } catch {
        ctx = null;
      }

      const measureLineWidth = (idx) => {
        const txt = String(previewLines[idx] || "");
        if (ctx) return Math.ceil(ctx.measureText(txt).width) + 6;
        return Math.ceil(txt.length * 7.2);
      };

      const nextInline = indicesToCheck.every((idx) => measureLineWidth(idx) <= availableTextWidth);
      setInlineLayout((prev) =>
        prev.enabled === nextInline && prev.tailCount === tailCount
          ? prev
          : { enabled: nextInline, tailCount }
      );
    };

    measure();

    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(measure);
      ro.observe(expandedEl);
      ro.observe(previewEl);
      ro.observe(detailsBtnEl);
      return () => ro.disconnect();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    return undefined;
  }, [expanded, previewLines]);

  const upperPreviewLines = canInlineDetails
    ? previewLines.slice(0, Math.max(0, previewLines.length - inlineTailCount))
    : previewLines;
  const lowerPreviewLines = canInlineDetails
    ? previewLines.slice(Math.max(0, previewLines.length - inlineTailCount))
    : [];

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
          <div ref={expandedRef} className={styles.routeExpanded}>
            <div ref={previewListRef} className={styles.previewListText}>
              {upperPreviewLines.map((line, i) => (
                <div key={i} className={styles.previewLine}>
                  {line}
                </div>
              ))}
              {canInlineDetails && lowerPreviewLines.length > 0 && (
                <div className={styles.previewInlineRow}>
                  <div className={styles.previewInlineLines}>
                    {lowerPreviewLines.map((line, i) => (
                      <div key={`inline-${i}`} className={styles.previewLine}>
                        {line}
                      </div>
                    ))}
                  </div>
                  <div className={styles.detailsRow}>
                    <button
                      ref={detailsBtnRef}
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
              )}
            </div>
            {!canInlineDetails && (
              <div className={styles.detailsRow}>
                <button
                  ref={detailsBtnRef}
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
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { RouteCard };
