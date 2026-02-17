export function createRestScaleManager({
  map,
  polyBaseRef,
  lastRestScaleRef,
  primaryPolylinesRef,
  altPolylinesRef,
  hybridPolylinesRef,
  hybridAltPolylinesRef,
  microShadowPolylinesRef,
  microMainPolylinesRef,
  microFirstRendererRef,
  microLastRendererRef,
}) {
  const ROUTE_WIDTH_SCALE = 0.85;

  function parseScaleFromTransform(transform) {
    if (!transform || transform === "none") return 1;

    const m3 = transform.match(/^matrix3d\((.+)\)$/);
    if (m3) {
      const v = m3[1].split(",").map((x) => Number(x.trim()));
      if (v.length === 16) {
        const sx = Math.hypot(v[0], v[1], v[2]);
        const sy = Math.hypot(v[4], v[5], v[6]);
        const s = (sx + sy) / 2;
        return Number.isFinite(s) ? s : 1;
      }
    }

    const m2 = transform.match(/^matrix\((.+)\)$/);
    if (m2) {
      const v = m2[1].split(",").map((x) => Number(x.trim()));
      if (v.length >= 6) {
        const [a, b, c, d] = v;
        const sx = Math.hypot(a, b);
        const sy = Math.hypot(c, d);
        const s = (sx + sy) / 2;
        return Number.isFinite(s) ? s : 1;
      }
    }

    return 1;
  }

  function scalePxString(px, invScale) {
    if (typeof px !== "string") return px;
    const mm = px.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
    if (!mm) return px;
    const n = parseFloat(mm[1]);
    if (!Number.isFinite(n)) return px;
    const out = n * invScale;
    return `${Number(out.toFixed(3)).toString()}px`;
  }

  function scaleIconsForRest(icons, invScale) {
    if (!Array.isArray(icons) || !icons.length) return icons;

    return icons.map((item) => {
      const icon = item?.icon ?? {};
      const s = icon?.scale;
      const scaledIcon =
        Number.isFinite(s) ? { ...icon, scale: Math.max(0.5, s * invScale) } : icon;

      return {
        ...item,
        icon: scaledIcon,
        repeat: scalePxString(item?.repeat, invScale),
        offset: item?.offset,
      };
    });
  }

  function registerPolylineBase(poly) {
    if (!poly) return;

    const wm = polyBaseRef.current;
    if (!wm) return;

    try {
      if (!wm.has(poly)) {
        wm.set(poly, {
          strokeWeight: poly.get("strokeWeight"),
          icons: poly.get("icons"),
        });
      }

      // If the map is resting at a fractional-zoom pane scale, newly created polylines can look
      // too thin until the next idle. Immediately sync them to the last known rest scale.
      const scale = lastRestScaleRef.current ?? 1;
      if (Math.abs(scale - 1) < 0.01) return;

      const inv = 1 / (scale || 1);
      const base = wm.get(poly);
      const sw = Number(base?.strokeWeight);
      const baseIcons = base?.icons;

      const out = {};
      if (Number.isFinite(sw) && sw > 0) {
        out.strokeWeight = Math.max(1, sw * inv * ROUTE_WIDTH_SCALE);
      }
      if (Array.isArray(baseIcons) && baseIcons.length)
        out.icons = scaleIconsForRest(baseIcons, inv);

      try {
        poly.setOptions(out);
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }

  function restScaleFromZoomFraction() {
    try {
      const z = map?.getZoom?.();
      if (!Number.isFinite(z)) return 1;
      const frac = z - Math.floor(z);
      if (Math.abs(frac) < 0.0005) return 1;
      const s = Math.pow(2, frac);
      return Number.isFinite(s) && s > 0.25 && s < 4 ? s : 1;
    } catch {
      return 1;
    }
  }

  function restScaleFromDom() {
    const root = map?.getDiv?.();
    if (!root) return 1;

    let bestScale = 1;
    let bestDev = 0;

    const nodes = root.querySelectorAll("div");
    const limit = Math.min(nodes.length, 450);

    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      const tf = window.getComputedStyle(el).transform;
      const s = parseScaleFromTransform(tf);
      const dev = Math.abs(s - 1);
      if (dev > bestDev + 0.01 && s > 0.25 && s < 4) {
        bestDev = dev;
        bestScale = s;
      }
    }

    return bestScale;
  }

  function getRestOverlayScale() {
    const dom = restScaleFromDom();
    if (Math.abs(dom - 1) > 0.02) return dom;

    const z = restScaleFromZoomFraction();
    if (Math.abs(z - 1) > 0.02) return z;

    return 1;
  }

  function applyRestScaleToMicroRenderers() {
    // Micro-leg DirectionsRenderers are used for dragging only.
    // Keep their polylines effectively invisible so our own microMain polylines are the only visible lines.
    const applyTo = (which) => {
      const renderer =
        which === "first" ? microFirstRendererRef?.current : microLastRendererRef?.current;
      if (!renderer) return;

      try {
        renderer.setOptions?.({
          polylineOptions: {
            strokeOpacity: 0.01, // still hit-testable
            strokeWeight: 18,
            zIndex: 40,
          },
        });
      } catch {
        // ignore
      }
    };

    applyTo("first");
    applyTo("last");
  }

  function applyRestScaleToAllPolylines(scale) {
    const s = Number.isFinite(scale) ? scale : getRestOverlayScale();
    const inv = 1 / (s || 1);
    lastRestScaleRef.current = s;

    const all = [
      ...(primaryPolylinesRef?.current ?? []),
      ...(altPolylinesRef?.current ?? []),
      ...(hybridPolylinesRef?.current ?? []),
      ...(hybridAltPolylinesRef?.current ?? []),
    ];

    const ms = microShadowPolylinesRef?.current ?? {};
    if (ms.first) all.push(ms.first);
    if (ms.last) all.push(ms.last);

    const mm = microMainPolylinesRef?.current ?? {};
    if (mm.first) all.push(mm.first);
    if (mm.last) all.push(mm.last);

    for (const poly of all) {
      if (!poly?.setOptions) continue;

      try {
        registerPolylineBase(poly);
      } catch {
        // ignore
      }

      const base = polyBaseRef.current?.get?.(poly);
      const sw = Number(base?.strokeWeight);
      const baseIcons = base?.icons;

      const out = {};

      if (Number.isFinite(sw) && sw > 0) {
        out.strokeWeight = Math.max(1, sw * inv * ROUTE_WIDTH_SCALE);
      }

      if (Array.isArray(baseIcons) && baseIcons.length) {
        out.icons = scaleIconsForRest(baseIcons, inv);
      }

      try {
        poly.setOptions(out);
      } catch {
        // ignore
      }
    }

    applyRestScaleToMicroRenderers();
  }

  return {
    registerPolylineBase,
    getRestOverlayScale,
    applyRestScaleToAllPolylines,
  };
}
