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
