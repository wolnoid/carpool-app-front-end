// src/maps/placePicker.js

export function fmtLatLng({ lat, lng }) {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  return `${a.toFixed(5)}, ${b.toFixed(5)}`;
}

// Best-effort: read visible text inside <gmpx-place-picker>
function findPickerInput(pickerEl) {
  if (!pickerEl) return null;

  // Some builds expose a direct pointer to the internal input.
  const direct =
    pickerEl.inputElement ||
    pickerEl._inputElement ||
    pickerEl.input ||
    pickerEl._input ||
    null;

  if (direct && direct.tagName === "INPUT") return direct;

  // Light DOM (unlikely, but cheap).
  const light = pickerEl.querySelector?.("input");
  if (light) return light;

  // Open shadow DOM (most common).
  const sr = pickerEl.shadowRoot || pickerEl.renderRoot || null;
  if (sr) {
    const srInput = sr.querySelector?.("input");
    if (srInput) return srInput;

    // Some versions nest an autocomplete component.
    const nested = sr.querySelector?.("gmp-place-autocomplete, gmpx-place-autocomplete");
    const nsr = nested?.shadowRoot || nested?.renderRoot || null;
    const nestedInput = nsr?.querySelector?.("input");
    if (nestedInput) return nestedInput;
  }

  return null;
}

export function getPickerText(pickerEl) {
  const input = findPickerInput(pickerEl);
  return input?.value ?? "";
}

// Set visible text (best-effort). We *do* dispatch input/change so the component's
// internal state stays in sync, otherwise it can re-render back to blank.
export function forcePickerText(pickerEl, text) {
  if (!pickerEl) return;
  if (text === undefined || text === null) return;

  const input = findPickerInput(pickerEl);
  if (!input) return;

  const next = String(text);
  input.value = next;

  // Keep internal state in sync.
  try {
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  } catch {
    // ignore
  }

  // Best-effort: close suggestions if the input is currently focused.
  try {
    if (typeof document !== "undefined" && document.activeElement === input) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true })
      );
    }
  } catch {
    // ignore
  }
}

export async function reverseGeocodeLL(ll) {
  try {
    const geocoder = new window.google.maps.Geocoder();
    const resp = await geocoder.geocode({ location: ll });
    const best = resp?.results?.[0];
    return {
      address: best?.formatted_address ?? null,
      placeId: best?.place_id ?? null,
    };
  } catch (e) {
    console.warn("Reverse geocode failed:", e);
    return { address: null, placeId: null };
  }
}

export async function populatePlacePickerFromLatLng(pickerEl, ll) {
  if (!pickerEl) return;

  // show something immediately
  forcePickerText(pickerEl, fmtLatLng(ll));

  const { address, placeId } = await reverseGeocodeLL(ll);
  if (address) forcePickerText(pickerEl, address);

  // Best-case: set pickerEl.value to a real Place object (if supported)
  if (placeId) {
    try {
      const { Place } = await window.google.maps.importLibrary("places");
      const place = new Place({ id: placeId });
      await place.fetchFields({ fields: ["location", "formattedAddress"] });

      try {
        pickerEl.value = place;
      } catch {
        // ignore; UI already set
      }
    } catch (e) {
      console.warn("Place fetch/set failed:", e);
    }
  }
}
