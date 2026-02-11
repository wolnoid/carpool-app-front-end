export function rafPoll(getValue, onReady, { maxFrames = 180 } = {}) {
  let raf = 0;
  let frames = 0;
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    const value = getValue();
    if (value != null) {
      onReady(value);
      return;
    }
    if (++frames < maxFrames) raf = requestAnimationFrame(tick);
  };

  tick();

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
