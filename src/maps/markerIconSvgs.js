function toDataUrl(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.trim())}`;
}

export function getDetourIconUrl() {
  // NOTE: Render the SVG at a higher resolution and scale it down via `scaledSize`.
  // This keeps the circle + shadow crisp on high-DPI screens and looks closer to
  // Google Maps' draggable route-point handles.
  //
  // IMPORTANT: We paint the *white disc* WITHOUT any filter applied, and generate
  // the shadow from an invisible shape underneath. This prevents the filter chain
  // from tinting the fill (which can read as “grey” after Google rasterizes the SVG).
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <!-- detour-handle v3 -->
  <defs>
    <filter id="ds" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="1" stdDeviation="1.4" flood-color="rgba(0,0,0,0.35)"/>
    </filter>
  </defs>

  <!-- Shadow only (source shape fully transparent) -->
  <circle cx="24" cy="24" r="15.5" fill="#FFFFFF" opacity="0" filter="url(#ds)" />

  <!-- Disc: pure white with solid black outline -->
  <circle cx="24" cy="24" r="15.5" fill="#FFFFFF" stroke="#000000" stroke-width="8" />
</svg>
  `;
  return toDataUrl(svg);
}

export function getStartIconUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
      <defs>
        <filter id="ds" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.1" flood-color="rgba(0,0,0,0.35)"/>
        </filter>
      </defs>
      <circle cx="13" cy="13" r="9.2" fill="#34A853" filter="url(#ds)"/>
      <circle cx="13" cy="13" r="4.2" fill="#ffffff"/>
    </svg>
  `;
  return toDataUrl(svg);
}

export function getEndIconUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44">
      <defs>
        <filter id="ds" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.4" flood-color="rgba(0,0,0,0.35)"/>
        </filter>
      </defs>
      <path
        d="M16 1
           C8.4 1 2.2 7.2 2.2 14.8
           C2.2 25.0 16 43 16 43
           C16 43 29.8 25.0 29.8 14.8
           C29.8 7.2 23.6 1 16 1 Z"
        fill="#EA4335"
        stroke="#ffffff"
        stroke-width="2"
        filter="url(#ds)"
      />
      <circle cx="16" cy="15" r="6.2" fill="#ffffff" opacity="0.95"/>
      <circle cx="16" cy="15" r="3.4" fill="#EA4335" opacity="0.95"/>
    </svg>
  `;
  return toDataUrl(svg);
}
