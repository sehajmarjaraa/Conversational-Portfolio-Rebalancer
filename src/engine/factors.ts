import type { Snapshot } from "../types";
import { FACTOR_NAMES, type FactorName } from "../types";
import type { MarketModel } from "./stats";

/**
 * Characteristic-based factor tilts — six factors, cross-sectional z-scores
 * over the 12-name universe. The PROXIES are labeled assumptions (documented
 * in the methodology panel); the INPUTS are real (SEC EDGAR XBRL + real price
 * history).
 *
 *   growth   z(revenue growth YoY)                       [SEC XBRL]
 *   value    mean of z(earnings yield), z(book yield)    [SEC XBRL + price]
 *   momentum z(12-1 month price return)                  [price history]
 *   quality  mean of z(ROE), z(operating margin)         [SEC XBRL]
 *   low_vol  −z(realized annualized volatility)          [price history]
 *   size     z(log market cap)  (positive = large-cap)   [SEC XBRL shares × price]
 *
 * Missing inputs (e.g. banks without OperatingIncomeLoss) get a neutral 0 for
 * that component rather than a fabricated value; this is noted in the UI.
 */

export interface FactorModel {
  /** z[factor][assetIndex], aligned with model.tickers */
  z: Record<FactorName, number[]>;
  missing: { ticker: string; factor: FactorName; component: string }[];
}

function zscores(xs: (number | null)[]): { z: number[]; missingIdx: number[] } {
  const present = xs.filter((x): x is number => x != null && isFinite(x));
  const m = present.reduce((a, b) => a + b, 0) / present.length;
  const sd = Math.sqrt(present.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, present.length - 1)) || 1;
  const missingIdx: number[] = [];
  const z = xs.map((x, i) => {
    if (x == null || !isFinite(x)) {
      missingIdx.push(i);
      return 0; // neutral, never fabricated
    }
    return (x - m) / sd;
  });
  return { z, missingIdx };
}

export function buildFactorModel(snapshot: Snapshot, model: MarketModel): FactorModel {
  const missing: FactorModel["missing"] = [];
  const get = (t: string) => snapshot.tickers[t];

  const collect = (factor: FactorName, component: string, vals: (number | null)[]) => {
    const { z, missingIdx } = zscores(vals);
    for (const i of missingIdx) missing.push({ ticker: model.tickers[i], factor, component });
    return z;
  };

  const growth = collect(
    "growth",
    "revenue growth YoY",
    model.tickers.map((t) => get(t).fundamentals?.revenue_growth_yoy.value ?? null)
  );

  // value: earnings yield (1/PE) and book yield (1/PB) — higher = cheaper
  const ey = collect(
    "value",
    "earnings yield (1/P-E)",
    model.tickers.map((t) => {
      const pe = get(t).fundamentals?.pe.value;
      return pe != null && pe > 0 ? 1 / pe : null;
    })
  );
  const by = collect(
    "value",
    "book yield (1/P-B)",
    model.tickers.map((t) => {
      const pb = get(t).fundamentals?.pb.value;
      return pb != null && pb > 0 ? 1 / pb : null;
    })
  );
  const value = ey.map((v, i) => (v + by[i]) / 2);

  // momentum: 12-1 month return from real history (skip the most recent ~21 sessions)
  const momRaw = model.tickers.map((t) => {
    const p = get(t).prices!;
    const n = p.closes.length;
    if (n < 60) return null;
    const endIdx = Math.max(0, n - 22);
    return p.closes[endIdx] / p.closes[0] - 1;
  });
  const momentum = collect("momentum", "12-1m price return", momRaw);

  const roe = collect(
    "quality",
    "ROE",
    model.tickers.map((t) => get(t).fundamentals?.roe.value ?? null)
  );
  const opm = collect(
    "quality",
    "operating margin",
    model.tickers.map((t) => get(t).fundamentals?.operating_margin.value ?? null)
  );
  const quality = roe.map((v, i) => (v + opm[i]) / 2);

  const lowVolZ = zscores(model.vol.map((v) => v)).z.map((z) => -z);

  const size = collect(
    "size",
    "log market cap",
    model.tickers.map((t) => {
      const mc = get(t).market_cap?.value;
      return mc != null && mc > 0 ? Math.log(mc) : null;
    })
  );

  return {
    z: { growth, value, momentum, quality, low_vol: lowVolZ, size },
    missing,
  };
}

/** Weighted-average factor exposure of a portfolio (cash contributes 0). */
export function portfolioFactorExposure(w: number[], fm: FactorModel): Record<FactorName, number> {
  const out = {} as Record<FactorName, number>;
  for (const f of FACTOR_NAMES) {
    let e = 0;
    for (let i = 0; i < w.length; i++) e += w[i] * fm.z[f][i];
    out[f] = e;
  }
  return out;
}
