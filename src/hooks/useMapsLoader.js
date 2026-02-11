import { useLayoutEffect } from "react";
import "@googlemaps/extended-component-library/api_loader.js";
import "@googlemaps/extended-component-library/place_picker.js";
import { configureMapsLoader } from "../maps/mapsLoaderConfig";

export function useMapsLoader() {
  useLayoutEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_KEY;
    if (!key) {
      console.error("Missing VITE_GOOGLE_MAPS_KEY");
      return;
    }

    configureMapsLoader({ key });
  }, []);
}
