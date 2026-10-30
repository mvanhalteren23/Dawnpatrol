// The Head Above Digital logo: the official mark (Brand Kit, mark-on-dark / mark-on-light) with
// the wordmark set as the guidelines specify (HEAD ABOVE in Barlow Condensed 800, DIGITAL in 700
// tracked 0.55em at about a third of the size).
const BARS: [number, number, number][] = [[9, 42, 4], [16, 39, 10], [23, 36, 16], [30, 33, 22], [37, 36, 16], [44, 39, 10], [51, 42, 4]];

export function BrandMark({ variant = "primary", size = 40 }: { variant?: "primary" | "light"; size?: number }) {
  const sun = variant === "primary" ? "#D8B47A" : "#A87A33";
  const bars = variant === "primary" ? "#EFE6D4" : "#1F3B2D";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="17" r="9" fill={sun} />
      {BARS.map(([x, y, h]) => <rect key={x} x={x} y={y} width="4" height={h} rx="2" fill={bars} />)}
    </svg>
  );
}

export function BrandLogo({ variant = "primary" }: { variant?: "primary" | "light" }) {
  const word = variant === "primary" ? "#EFE6D4" : "#1F3B2D";
  const sub = variant === "primary" ? "#D8B47A" : "#6B5A43";
  return (
    <span className="inline-flex select-none items-center gap-2.5" aria-label="Head Above Digital">
      <BrandMark variant={variant} size={44} />
      <span className="flex flex-col leading-none">
        <span className="font-condensed-800 text-2xl uppercase" style={{ color: word, letterSpacing: "0.03em" }}>Head Above</span>
        <span className="font-condensed-700 mt-0.5 text-[9px] uppercase" style={{ color: sub, letterSpacing: "0.55em" }}>Digital</span>
      </span>
    </span>
  );
}
