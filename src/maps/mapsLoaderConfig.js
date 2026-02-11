export const MAPS_LOADER_SELECTOR = 'gmpx-api-loader[data-app-loader="true"]';

export function ensureMapsLoaderElement() {
  let el = document.querySelector(MAPS_LOADER_SELECTOR);

  if (!el) {
    el = document.createElement("gmpx-api-loader");
    el.setAttribute("data-app-loader", "true");
    document.body.appendChild(el);
  }

  return el;
}

export function configureMapsLoader({
  key,
  version = "quarterly",
  libraries = "places,geometry",
} = {}) {
  const el = ensureMapsLoaderElement();
  if (key) el.setAttribute("key", key);
  el.setAttribute("version", version);
  // Needed soon for hills work (geometry decode) + place picker + places importLibrary
  el.setAttribute("libraries", libraries);
  return el;
}