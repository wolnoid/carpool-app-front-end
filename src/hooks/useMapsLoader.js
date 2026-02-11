import { useLayoutEffect } from "react";

const loaderModule = "@googlemaps/extended-component-library/" + "api_loader.js";
const placePickerModule =
  "@googlemaps/extended-component-library/" + "place_picker.js";

export function useMapsLoader() {
  useLayoutEffect(() => {
    let cancelled = false;

    async function registerExtendedComponents() {
      try {
        await import(/* @vite-ignore */ loaderModule);
        await import(/* @vite-ignore */ placePickerModule);
      } catch (err) {
        console.error("Unable to load Google Maps extended component library", err);
      }

      if (cancelled) return;

      const key = import.meta.env.VITE_GOOGLE_MAPS_KEY;
      if (!key) {
        console.error("Missing VITE_GOOGLE_MAPS_KEY");
        return;
      }

      let el = document.querySelector('gmpx-api-loader[data-app-loader="true"]');

      if (!el) {
        el = document.createElement("gmpx-api-loader");
        el.setAttribute("data-app-loader", "true");
        document.body.appendChild(el);
      }

      // Keep it correct even if env changes
      el.setAttribute("key", key);
      el.setAttribute("version", "quarterly");
    }

    registerExtendedComponents();

    return () => {
      cancelled = true;
    };
  }, []);
}
