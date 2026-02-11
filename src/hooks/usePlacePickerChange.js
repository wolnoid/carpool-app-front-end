import { useEffect } from "react";

export function usePlacePickerChange(pickerRef, enabled, onChange, maxFrames = 180) {
  useEffect(() => {
    if (!enabled || typeof onChange !== "function") return;

    let raf = 0;
    let tries = 0;
    let cleanup = null;

    const bind = () => {
      const picker = pickerRef.current;
      if (!picker) {
        if (++tries < maxFrames) raf = requestAnimationFrame(bind);
        return;
      }

      const handler = (e) => onChange(e, picker);
      picker.addEventListener("gmpx-placechange", handler);
      cleanup = () => picker.removeEventListener("gmpx-placechange", handler);
    };

    bind();

    return () => {
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [enabled, pickerRef, onChange, maxFrames]);
}
