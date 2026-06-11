import { useEffect, useRef, useState } from "react";

export const pct = (x: number, dp = 1) => `${(x * 100).toFixed(dp)}%`;
export const signedPct = (x: number, dp = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(dp)}%`;
export const usd = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const usd2 = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export const compact = (x: number) =>
  x >= 1e12 ? `$${(x / 1e12).toFixed(2)}T` : x >= 1e9 ? `$${(x / 1e9).toFixed(0)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(0)}M` : usd(x);

/** Count-up animation on value change — purely visual; the underlying number is the engine's. */
export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format: (x: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    const start = performance.now();
    const dur = 550;
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={`num ${className ?? ""}`}>{format(display)}</span>;
}

/** Direction-aware delta coloring: green = improvement, red = deterioration. */
export function deltaColor(delta: number, lowerIsBetter: boolean): string {
  if (Math.abs(delta) < 1e-9) return "text-muted";
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  return improved ? "text-up" : "text-down";
}
