import { useCallback, useEffect, useRef } from "react";
import { placeToLatLng } from "../../../maps/directionsUtils";
import {
  populatePlacePickerFromLatLng,
  forcePickerText,
  getPickerText,
  closePickerSuggestions,
} from "../../../maps/placePicker";

/**
 * Manages gmpx-place-picker refs + swap + snapshot/restore without reloading pickers.
 * Keeps latest LatLngs in refs so swap works even though picker.value is readonly.
 */
export function useSidebarPickers({
  origin,
  userLoc,
  destination,
  setOrigin,
  setDestination,
  originPickerRef,
  destPickerRef,
}) {
  const internalOriginRef = useRef(null);
  const internalDestRef = useRef(null);

  const originRef = originPickerRef ?? internalOriginRef;
  const destRef = destPickerRef ?? internalDestRef;

  const originLLRef = useRef(null);
  const destLLRef = useRef(null);

  useEffect(() => {
    originLLRef.current = origin ?? userLoc ?? null;
  }, [origin, userLoc]);

  useEffect(() => {
    destLLRef.current = destination ?? null;
  }, [destination]);

  const pickerSnapshotRef = useRef({
    originText: "",
    destText: "",
    originLL: null,
    destLL: null,
  });

  const snapshotPickers = useCallback(() => {
    const oEl = originRef.current;
    const dEl = destRef.current;
    if (oEl) {
      const v = oEl.value;
      pickerSnapshotRef.current.originText =
        getPickerText(oEl) || pickerSnapshotRef.current.originText;
      pickerSnapshotRef.current.originLL =
        placeToLatLng(v) || pickerSnapshotRef.current.originLL;
    }
    if (dEl) {
      const v = dEl.value;
      pickerSnapshotRef.current.destText =
        getPickerText(dEl) || pickerSnapshotRef.current.destText;
      pickerSnapshotRef.current.destLL =
        placeToLatLng(v) || pickerSnapshotRef.current.destLL;
    }
  }, [originRef, destRef]);

  const restorePickers = useCallback(async () => {
    const snap = pickerSnapshotRef.current;

    // Destination: we also have a canonical LatLng in props.
    const destLL = destination || snap.destLL;

    // Restore both fields in parallel.
    const tasks = [];

    try {
      if (originRef.current) {
        const curText = (getPickerText(originRef.current) || "").trim();
        if (!curText) {
          if (snap.originText) forcePickerText(originRef.current, snap.originText);
          const ll = snap.originLL || userLoc || null;
          if (ll) tasks.push(populatePlacePickerFromLatLng(originRef.current, ll));
        }
      }

      if (destRef.current) {
        const curText = (getPickerText(destRef.current) || "").trim();
        if (!curText) {
          if (snap.destText) forcePickerText(destRef.current, snap.destText);
          if (destLL) tasks.push(populatePlacePickerFromLatLng(destRef.current, destLL));
        }
      }

      if (tasks.length) await Promise.all(tasks.map((p) => p.catch(() => {})));
    } catch {
      // best-effort only
    }
  }, [originRef, destRef, destination, userLoc]);

  const handleSwap = useCallback(async () => {
    const oEl = originRef.current;
    const dEl = destRef.current;

    // Prevent suggestion popovers from reopening during programmatic updates.
    closePickerSuggestions(oEl);
    closePickerSuggestions(dEl);

    // Prefer our tracked LatLngs so swap works even though <gmpx-place-picker>.value is readonly
    // (and can lag behind the visible text).
    const currentOriginLL =
      origin ?? originLLRef.current ?? placeToLatLng(oEl?.value) ?? userLoc ?? null;

    const currentDestLL =
      destination ?? destLLRef.current ?? placeToLatLng(dEl?.value) ?? null;

    // No destination => no swap.
    if (!currentDestLL) return;

    // Snapshot labels BEFORE touching inputs.
    const snap = pickerSnapshotRef.current;
    const originText = (oEl ? getPickerText(oEl) : "") || snap.originText || "";
    const destText = (dEl ? getPickerText(dEl) : "") || snap.destText || "";

    // Update refs immediately so a fast double-click swaps back correctly.
    originLLRef.current = currentDestLL;
    destLLRef.current = currentOriginLL;

    // Keep snapshot in sync.
    pickerSnapshotRef.current.originLL = currentDestLL;
    pickerSnapshotRef.current.destLL = currentOriginLL;
    pickerSnapshotRef.current.originText = destText || snap.originText;
    pickerSnapshotRef.current.destText = originText || snap.destText;

    // Swap state for app logic.
    setOrigin(currentDestLL);
    if (currentOriginLL) setDestination(currentOriginLL);
    else setDestination(null);

    // Only do an instant swap when we actually have labels; otherwise we rely on populate.
    if (oEl && destText) forcePickerText(oEl, destText);
    if (dEl && originText) forcePickerText(dEl, originText);

    const tasks = [];
    if (oEl) tasks.push(populatePlacePickerFromLatLng(oEl, currentDestLL));
    if (dEl) {
      if (currentOriginLL) tasks.push(populatePlacePickerFromLatLng(dEl, currentOriginLL));
      else forcePickerText(dEl, "");
    }

    if (tasks.length) await Promise.all(tasks.map((p) => p.catch(() => {})));

    // Some picker builds reopen suggestions on async text/value sync; close again.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        closePickerSuggestions(oEl);
        closePickerSuggestions(dEl);
      });
    } else {
      setTimeout(() => {
        closePickerSuggestions(oEl);
        closePickerSuggestions(dEl);
      }, 0);
    }
  }, [originRef, destRef, origin, destination, setOrigin, setDestination, userLoc]);

  return {
    originRef,
    destRef,
    originLLRef,
    destLLRef,
    pickerSnapshotRef,
    snapshotPickers,
    restorePickers,
    handleSwap,
  };
}
