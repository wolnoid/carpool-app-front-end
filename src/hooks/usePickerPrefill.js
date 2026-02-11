// src/hooks/usePickerPrefill.js
import { useEffect, useRef } from "react";
import { getPickerText, populatePlacePickerFromLatLng } from "../maps/placePicker";
import { usePlacePickerChange } from "./usePlacePickerChange";

export function usePickerPrefill(pickerRef, enabled) {
  const userPickedRef = useRef(false);
  const pendingRef = useRef(false);
  const rafRef = useRef(0);

  const markPicked = () => {
    userPickedRef.current = true;
  };

  const resetPicked = () => {
    userPickedRef.current = false;
  };

  const prefillIfEmpty = (ll) => {
    if (!enabled) return;
    if (!ll) return;
    if (userPickedRef.current) return;
    if (pendingRef.current) return;

    pendingRef.current = true;

    let tries = 0;
    const tick = () => {
      if (userPickedRef.current) {
        pendingRef.current = false;
        return;
      }

      const picker = pickerRef.current;
      if (!picker) {
        if (++tries < 180) rafRef.current = requestAnimationFrame(tick);
        else pendingRef.current = false;
        return;
      }

      const existing = getPickerText(picker).trim();
      if (existing) {
        pendingRef.current = false;
        return;
      }

      populatePlacePickerFromLatLng(picker, ll);
      pendingRef.current = false;
    };

    tick();
  };

  usePlacePickerChange(pickerRef, enabled, () => {
    userPickedRef.current = true;
  });

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return { userPickedRef, prefillIfEmpty, markPicked, resetPicked };
}
