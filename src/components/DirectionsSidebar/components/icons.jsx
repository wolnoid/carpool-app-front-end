function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M14.5 5.5L8 12l6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --- Sidebar route-card helpers (UI only) ---
const MODE_META = {
  WALK: { label: "Walk", dot: "🚶", bg: "rgba(0,0,0,0.06)" },
  WALKING: { label: "Walk", dot: "🚶", bg: "rgba(0,0,0,0.06)" },
  BIKE: { label: "Bike", dot: "🚲", bg: "rgba(26,115,232,0.12)" },
  BICYCLING: { label: "Bike", dot: "🚲", bg: "rgba(26,115,232,0.12)" },
  SKATE: { label: "Skate", dot: "🛹", bg: "rgba(34,197,94,0.14)" },
  WAIT: { label: "Wait", dot: "⏳", bg: "rgba(0,0,0,0.06)" },
};

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M14.5 5.5L8 12l6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M9.5 5.5L16 12l-6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SwapIcon() {
  const stroke = 3; // thicker
  const stagger = 2.5; // more vertical stagger
  const xLeft = 6.25; // further left (more horizontal separation)
  const xRight = 17.75; // further right

  const yTop = 4.2; // keep a little margin so caps don't touch the circle
  const yBottom = 19.8;

  const head = 4; // arrowhead size
  const headInset = 4; // how "wide" the head spreads

  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {/* Up arrow (left) — nudged UP */}
      <g transform={`translate(0,${-stagger})`}>
        <path
          d={`M${xLeft} ${yBottom} V${yTop}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M${xLeft} ${yTop} L${xLeft - headInset} ${yTop + head} M${xLeft} ${yTop} L${xLeft + headInset} ${yTop + head}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Down arrow (right) — nudged DOWN */}
      <g transform={`translate(0,${stagger})`}>
        <path
          d={`M${xRight} ${yTop} V${yBottom}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M${xRight} ${yBottom} L${xRight - headInset} ${yBottom - head} M${xRight} ${yBottom} L${xRight + headInset} ${yBottom - head}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

export { BackIcon, ChevronLeftIcon, ChevronRightIcon, SwapIcon, MODE_META };
