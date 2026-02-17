import { toWorldPx, minDistSqToPath } from "./geo";

// Hybrid detour dragging glitch guard
// Some Maps JS builds can leave a draggable DirectionsRenderer (micro-leg) in a state where
// it starts a detour-drag no matter where the user begins dragging. We prevent that by
// disabling micro-leg dragging for gestures that begin far away from the micro-leg geometry.
export function setupMicroDragGuard({
  enabled,
  map,
  hybridOptionsRef,
  microFirstRendererRef,
  microLastRendererRef,
  microMainPolylinesRef,
  microDragGuardRef,
}) {
  if (!enabled || !map) return () => {};

  const div = map.getDiv?.();
  if (!div) return () => {};

  const GUARD_PX = 26; // how close (in screen px) the gesture must begin to allow route dragging

  const clearRestoreTimer = () => {
    const t = microDragGuardRef.current?.restoreTimer;
    if (t) {
      try {
        clearTimeout(t);
      } catch {
        // ignore
      }
    }
    if (microDragGuardRef.current) microDragGuardRef.current.restoreTimer = null;
  };

  const setMicroDraggable = (draggable) => {
    const r1 = microFirstRendererRef.current;
    const r2 = microLastRendererRef.current;
    [r1, r2].forEach((r) => {
      if (!r?.setOptions) return;
      try {
        r.setOptions({ draggable });
      } catch {
        // ignore
      }
    });
  };

  const clientToLatLng = (clientX, clientY) => {
    const proj = map.getProjection?.();
    const zoom = map.getZoom?.();
    const center = map.getCenter?.();
    if (!proj || !Number.isFinite(zoom) || !center) return null;

    const rect = div.getBoundingClientRect?.();
    if (!rect) return null;

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const scale = Math.pow(2, zoom);
    let cWorld;
    try {
      cWorld = proj.fromLatLngToPoint(center);
    } catch {
      return null;
    }
    if (!cWorld) return null;

    const cPx = { x: cWorld.x * scale, y: cWorld.y * scale };
    const topLeftPx = { x: cPx.x - rect.width / 2, y: cPx.y - rect.height / 2 };
    const worldPx = { x: topLeftPx.x + x, y: topLeftPx.y + y };
    const worldPt = { x: worldPx.x / scale, y: worldPx.y / scale };

    try {
      return proj.fromPointToLatLng(worldPt);
    } catch {
      return null;
    }
  };

  const isNearMicroLegGeometry = (ll) => {
    if (!ll) return false;
    const proj = map.getProjection?.();
    const zoom = map.getZoom?.();
    if (!proj || !Number.isFinite(zoom)) return false;

    const clickPx = toWorldPx(ll, proj, zoom);
    if (!clickPx) return false;

    const mm = microMainPolylinesRef.current ?? {};
    const polys = [mm.first, mm.last].filter(Boolean);
    if (!polys.length) return false;

    const maxSq = GUARD_PX * GUARD_PX;

    for (const poly of polys) {
      let path;
      try {
        path = poly?.getPath?.()?.getArray?.() ?? [];
      } catch {
        path = [];
      }
      if (!path?.length) continue;
      const pathPx = path
        .map((pt) => toWorldPx(pt, proj, zoom))
        .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

      const dSq = minDistSqToPath(clickPx, pathPx);
      if (dSq <= maxSq) return true;
    }
    return false;
  };

  const restore = () => {
    clearRestoreTimer();
    if (!microDragGuardRef.current?.disabled) return;
    microDragGuardRef.current.disabled = false;

    // Only restore if we're still in a hybrid session with micro renderers present.
    if (!hybridOptionsRef.current?.length) return;
    if (!microFirstRendererRef.current && !microLastRendererRef.current) return;

    setMicroDraggable(true);
  };

  const onPointerDownCapture = (e) => {
    // Left mouse / primary pointer only.
    if (e?.button != null && e.button !== 0) return;
    if (!hybridOptionsRef.current?.length) return;
    if (!microFirstRendererRef.current && !microLastRendererRef.current) return;

    const ll = clientToLatLng(e.clientX, e.clientY);
    const near = isNearMicroLegGeometry(ll);
    if (near) return;

    // Gesture starts far from micro legs: disable detour dragging so the map pans normally.
    microDragGuardRef.current.disabled = true;
    setMicroDraggable(false);

    // Failsafe restore (in case pointerup is missed during a renderer reset).
    clearRestoreTimer();
    microDragGuardRef.current.restoreTimer = setTimeout(restore, 450);
  };

  const onPointerUp = () => restore();
  const onPointerCancel = () => restore();
  const onBlur = () => restore();

  // Capture-phase so we run before Maps' internal handlers.
  div.addEventListener("pointerdown", onPointerDownCapture, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("blur", onBlur);

  return () => {
    try {
      div.removeEventListener("pointerdown", onPointerDownCapture, true);
    } catch {
      // ignore
    }
    try {
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("blur", onBlur);
    } catch {
      // ignore
    }
    restore();
  };
}
