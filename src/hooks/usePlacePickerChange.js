import { useEffect } from "react";
import { rafPoll } from "../utils/rafPoll";

export function usePlacePickerChange(pickerRef, enabled, onChange, maxFrames = 180) {
  useEffect(() => {
    if (!enabled || typeof onChange !== "function") return;

    let cleanup = null;

    const cancel = rafPoll(
      () => pickerRef.current ?? null,
      (picker) => {
        const handler = (e) => onChange(e, picker);
        picker.addEventListener("gmpx-placechange", handler);
        cleanup = () => picker.removeEventListener("gmpx-placechange", handler);
      },
      { maxFrames }
    );

    return () => {
      cancel?.();
      cleanup?.();
    };
  }, [enabled, pickerRef, onChange, maxFrames]);
}
