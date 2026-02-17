import { useEffect, useRef, useState } from "react";

import styles from "../styles/styles.js";

function ItinBubble({ seg }) {
  const segRef = useRef(null);
  const glyphRef = useRef(null);
  const labelMeasureRef = useRef(null);
  const minsMeasureRef = useRef(null);

  const isTransit = seg?.kind === "TRANSIT" || String(seg?.mode || "").toUpperCase() === "TRANSIT";
  const label = isTransit ? String(seg?.label || "").trim() : "";
  const mins = Math.max(0, Math.round(Number(seg?.durationSec || 0) / 60));
  const minsText = `${mins}m`;

  const [showLabel, setShowLabel] = useState(false);
  const [showMins, setShowMins] = useState(true);

  useEffect(() => {
    const el = segRef.current;
    const glyphEl = glyphRef.current;
    const labelMeasEl = labelMeasureRef.current;
    const minsMeasEl = minsMeasureRef.current;
    if (!el || !glyphEl || !minsMeasEl) return;

    const recompute = () => {
      const segW = el.clientWidth || 0;
      const glyphW = glyphEl.offsetWidth || 0;
      const minsW = minsMeasEl.offsetWidth || 0;
      const labelW = labelMeasEl ? (labelMeasEl.offsetWidth || 0) : 0;

      const cs = window.getComputedStyle(el);
      const padL = parseFloat(cs.paddingLeft || "0") || 0;
      const padR = parseFloat(cs.paddingRight || "0") || 0;
      const gap = parseFloat(cs.columnGap || cs.gap || "6") || 6;

      const available = Math.max(0, segW - padL - padR - 2);

      // Only show minutes if (emoji + minutes) can fit.
      const canShowMins = minsW > 0 && (glyphW + minsW + gap) <= available;
      setShowMins(canShowMins);

      // Transit label is optional and must fit with whatever else is showing.
      if (isTransit && label && labelMeasEl) {
        const req = glyphW + labelW + (canShowMins ? minsW : 0) + gap * (canShowMins ? 2 : 1);
        setShowLabel(labelW > 0 && req <= available);
      } else {
        setShowLabel(false);
      }
    };

    let raf = 0;
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    };

    schedule();

    // Watch the segment and the measure spans.
    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);
    ro.observe(glyphEl);
    ro.observe(minsMeasEl);
    if (labelMeasEl) ro.observe(labelMeasEl);

    // Extra safety: run once after fonts settle.
    let cancelled = false;
    if (document?.fonts?.ready?.then) {
      document.fonts.ready.then(() => {
        if (!cancelled) schedule();
      });
    }

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [isTransit, label, minsText]);

  if (mins <= 0) return null;

  return (
    <div
      ref={segRef}
      className={styles.itinSeg}
      style={{
        flexGrow: Math.max(1, Number(seg?.durationSec || 0)),
        backgroundColor: seg?.bg,
        color: seg?.text,
      }}
      title={label ? `${label} · ${minsText}` : minsText}
    >
      {/* Requirement: route name (transit line) to the left of the emoji */}
      {isTransit && label && showLabel ? <span className={styles.itinLabel}>{label}</span> : null}

      <span ref={glyphRef} className={styles.itinGlyph} aria-hidden="true">
        {seg?.glyph}
      </span>

      {isTransit && label ? (
        <span
          ref={labelMeasureRef}
          className={`${styles.itinLabel} ${styles.itinLabelMeasure}`}
          aria-hidden="true"
        >
          {label}
        </span>
      ) : null}

      <span
        ref={minsMeasureRef}
        className={`${styles.itinText} ${styles.itinTextMeasure}`}
        aria-hidden="true"
      >
        {minsText}
      </span>

      {showMins ? <span className={styles.itinText}>{minsText}</span> : null}
    </div>
  );
}

export { ItinBubble };
