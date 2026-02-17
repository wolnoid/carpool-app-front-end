// Itinerary fitting + hide-minute logic extracted from DirectionsSidebar.jsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

function isWaitSegment(seg) {
  const mode = String(seg?.mode || "").toUpperCase();
  return seg?.kind === "WAIT" || mode === "WAIT";
}

function isTransitSegment(seg) {
  const mode = String(seg?.mode || "").toUpperCase();
  return seg?.kind === "TRANSIT" || mode === "TRANSIT";
}

function isHideableMoveSegment(seg) {
  const kind = String(seg?.kind || "").toUpperCase();
  const isMoveish = kind === "MOVE" || kind === "" || kind === "SEG";
  return isMoveish && !isTransitSegment(seg) && !isWaitSegment(seg);
}

function carryHiddenMinuteMoves(segments) {
  const src = Array.isArray(segments) ? segments : [];
  const segs = src.map((s) => ({ ...s }));

  const hidden = new Set();
  const spareMins = new Map();

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const mins = Math.max(0, Math.round(Number(s?.durationSec || 0) / 60));
    if (mins <= 0) {
      hidden.add(i);
      continue;
    }
    if (isHideableMoveSegment(s) && mins <= 1) {
      hidden.add(i);
      spareMins.set(i, mins);
    }
  }

  const findPrev = (i, pred) => {
    for (let j = i - 1; j >= 0; j--) if (!hidden.has(j) && pred(segs[j])) return j;
    return null;
  };
  const findNext = (i, pred) => {
    for (let j = i + 1; j < segs.length; j++) if (!hidden.has(j) && pred(segs[j])) return j;
    return null;
  };

  for (const [i, mins] of spareMins.entries()) {
    if (!mins) continue;

    // 1) Adjacent WAIT leg if applicable.
    let target = null;
    if (i - 1 >= 0 && !hidden.has(i - 1) && isWaitSegment(segs[i - 1])) target = i - 1;
    else if (i + 1 < segs.length && !hidden.has(i + 1) && isWaitSegment(segs[i + 1]))
      target = i + 1;

    // 2) Previous TRANSIT leg.
    if (target == null) target = findPrev(i, isTransitSegment);

    // 3) Following TRANSIT leg.
    if (target == null) target = findNext(i, isTransitSegment);

    // Fallback: nearest non-hidden leg.
    if (target == null) target = findPrev(i, () => true) ?? findNext(i, () => true);

    if (target != null) {
      segs[target].durationSec = Number(segs[target].durationSec || 0) + mins * 60;
    }
  }

  return segs.filter((_, i) => !hidden.has(i) && Math.round(Number(segs[i]?.durationSec || 0) / 60) > 0);
}

function carryHiddenMinuteMovesExceptEnds(segments) {
  const src = Array.isArray(segments) ? segments : [];
  const segs = src.map((s) => ({ ...s }));

  const hidden = new Set();
  const spareMins = new Map();
  const last = Math.max(0, segs.length - 1);

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const mins = Math.max(0, Math.round(Number(s?.durationSec || 0) / 60));

    // Always drop truly zero-length segments.
    if (mins <= 0) {
      hidden.add(i);
      continue;
    }

    // Hide 1-minute-or-less move segments, EXCEPT first/last segment.
    if (i !== 0 && i !== last && isHideableMoveSegment(s) && mins <= 1) {
      hidden.add(i);
      spareMins.set(i, mins);
    }
  }

  const findPrev = (i, pred) => {
    for (let j = i - 1; j >= 0; j--) if (!hidden.has(j) && pred(segs[j])) return j;
    return null;
  };
  const findNext = (i, pred) => {
    for (let j = i + 1; j < segs.length; j++) if (!hidden.has(j) && pred(segs[j])) return j;
    return null;
  };

  for (const [i, mins] of spareMins.entries()) {
    if (!mins) continue;

    // 1) Adjacent WAIT leg if applicable.
    let target = null;
    if (i - 1 >= 0 && !hidden.has(i - 1) && isWaitSegment(segs[i - 1])) target = i - 1;
    else if (i + 1 < segs.length && !hidden.has(i + 1) && isWaitSegment(segs[i + 1])) target = i + 1;

    // 2) Previous TRANSIT leg.
    if (target == null) target = findPrev(i, isTransitSegment);

    // 3) Following TRANSIT leg.
    if (target == null) target = findNext(i, isTransitSegment);

    // Fallback: nearest non-hidden leg.
    if (target == null) target = findPrev(i, () => true) ?? findNext(i, () => true);

    if (target != null) {
      segs[target].durationSec = Number(segs[target].durationSec || 0) + mins * 60;
    }
  }

  return segs.filter((_, i) => !hidden.has(i) && Math.round(Number(segs[i]?.durationSec || 0) / 60) > 0);
}

// If there are too many itinerary bubbles to fit in the visible bar,
// hide WAIT bubbles first (starting with the shortest wait) until it fits.
function useItinerarySegmentsFit(baseSegments) {
  const [el, setEl] = useState(null);
  const barRef = useCallback((node) => {
    setEl(node || null);
  }, []);
  const [barW, setBarW] = useState(0);

  // IMPORTANT: callers rebuild arrays frequently (new references) even when the
  // itinerary is effectively the same. If we key effects off the array identity,
  // we’ll thrash and you’ll see WAIT bubbles flicker. So we derive a stable
  // signature from keys + durations and only react to meaningful changes.
  const baseSig = useMemo(() => {
    const segs = Array.isArray(baseSegments) ? baseSegments : [];
    return segs
      .map((s) => `${String(s?.key || "")}:${Math.round(Number(s?.durationSec || 0))}`)
      .join("|");
  }, [baseSegments]);

  const latestBaseRef = useRef([]);
  latestBaseRef.current = Array.isArray(baseSegments) ? baseSegments : [];

  // Freeze a stable base array while baseSig is unchanged.
  const stableBase = useMemo(() => {
    void baseSig;
    return latestBaseRef.current;
  }, [baseSig]);

  const [hiddenWaitKeys, setHiddenWaitKeys] = useState([]);

  // Reset hidden waits when the actual itinerary changes.
  useEffect(() => {
    setHiddenWaitKeys([]);
  }, [baseSig]);

  // Track bar width changes.
  useEffect(() => {
    if (!el || typeof ResizeObserver !== "function") return;

    const update = () => setBarW(el.clientWidth || 0);
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  // Decide which WAIT bubbles to hide (shortest first) when the row gets too crowded.
  // We use a "minimum comfortable pill width" heuristic (count-based) because flex-shrink
  // can make scrollWidth stay <= clientWidth even when pills look crushed.
  useLayoutEffect(() => {
    if (!el) return;

    const clientW = el.clientWidth || 0;
    if (clientW <= 0) return;

    const cs = window.getComputedStyle(el);
    const gap = parseFloat(cs.columnGap || cs.gap || "6") || 6;

    const MIN_PILL_PX = 36;
    const SAFETY_PX = 8;

    const maxCount = Math.max(
      1,
      Math.floor((clientW - SAFETY_PX + gap) / (MIN_PILL_PX + gap))
    );

    // IMPORTANT: do NOT use scrollWidth/overflow as a trigger to hide/unhide.
    // With flex shrink + dynamic text, overflow can flip-flop frame-to-frame and
    // cause an endless hide/unhide loop that hard-freezes the tab.
    const needToRemove = Math.max(0, stableBase.length - maxCount);

    const waits = stableBase
      .filter((s) => isWaitSegment(s))
      .map((s) => ({ key: s.key, dur: Number(s?.durationSec || 0) }))
      .sort((a, b) => a.dur - b.dur);

    const desired =
      needToRemove > 0
        ? waits.slice(0, Math.min(needToRemove, waits.length)).map((w) => w.key)
        : [];

    const sameKeys = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

    setHiddenWaitKeys((prev) => (sameKeys(prev, desired) ? prev : desired));
  }, [el, barW, baseSig, stableBase]);

  const hiddenSet = useMemo(() => new Set(hiddenWaitKeys), [hiddenWaitKeys]);
  const segs = useMemo(() => stableBase.filter((s) => !hiddenSet.has(s.key)), [stableBase, hiddenSet]);

  return { barRef, segs };
}



export {
  isWaitSegment,
  isTransitSegment,
  isHideableMoveSegment,
  carryHiddenMinuteMoves,
  carryHiddenMinuteMovesExceptEnds,
  useItinerarySegmentsFit,
};
