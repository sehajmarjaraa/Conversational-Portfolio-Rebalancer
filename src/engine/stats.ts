import type { Snapshot } from "../types";

/**
 * Deterministic statistics from REAL daily close history.
 * Everything here is computed in the browser from the committed snapshot —
 * no network, no randomness, no LLM.
 */

export const TRADING_DAYS = 252;

export interface MarketModel {
  tickers: string[]; // investable universe, fixed order (excludes benchmark)
  dates: string[]; // aligned trading dates used for all return math
  returns: number[][]; // [ticker][t] daily simple returns, aligned
  benchReturns: number[]; // benchmark daily returns, aligned
  cov: number[][]; // annualized covariance of daily returns
  corr: number[][];
  benchCov: number[]; // annualized cov(asset, benchmark)
  benchVar: number; // annualized var(benchmark)
  beta: number[]; // per-asset beta vs benchmark
  vol: number[]; // per-asset annualized volatility
  prices: Record<string, number>; // last real close per ticker
  riskFree: number; // FRED DGS10, decimal
  erp: number; // equity risk premium — LABELED ASSUMPTION
  expReturn: number[]; // CAPM: rf + beta × ERP — labeled forward assumption
  window: { start: string; end: string; days: number };
}

/** Equity risk premium used in CAPM expected returns. Forward-looking ASSUMPTION, labeled in the UI. */
export const ERP_ASSUMPTION = 0.045;

export function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function covPair(a: number[], b: number[], ma: number, mb: number): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
}

export function buildMarketModel(snapshot: Snapshot): MarketModel {
  const benchmark = snapshot.benchmark;
  const tickers = Object.keys(snapshot.tickers).filter(
    (t) => t !== benchmark && snapshot.tickers[t].prices != null
  );

  // align on the intersection of trading dates
  const dateSets = [benchmark, ...tickers].map((t) => new Set(snapshot.tickers[t].prices!.dates));
  const dates = snapshot.tickers[benchmark].prices!.dates.filter((d) => dateSets.every((s) => s.has(d)));

  const closeMap = (t: string) => {
    const p = snapshot.tickers[t].prices!;
    const m = new Map<string, number>();
    p.dates.forEach((d, i) => m.set(d, p.closes[i]));
    return m;
  };

  const series = (t: string) => {
    const m = closeMap(t);
    const closes = dates.map((d) => m.get(d)!);
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
    return rets;
  };

  const returns = tickers.map(series);
  const benchReturns = series(benchmark);
  const n = tickers.length;

  const means = returns.map(mean);
  const benchMean = mean(benchReturns);

  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const c = covPair(returns[i], returns[j], means[i], means[j]) * TRADING_DAYS;
      cov[i][j] = c;
      cov[j][i] = c;
    }
  }
  const vol = tickers.map((_, i) => Math.sqrt(cov[i][i]));
  const corr = cov.map((row, i) => row.map((c, j) => c / (vol[i] * vol[j])));

  const benchVar = covPair(benchReturns, benchReturns, benchMean, benchMean) * TRADING_DAYS;
  const benchCov = returns.map((r, i) => covPair(r, benchReturns, means[i], benchMean) * TRADING_DAYS);
  const beta = benchCov.map((c) => c / benchVar);

  const riskFree = snapshot.risk_free.value ?? 0;
  const expReturn = beta.map((b) => riskFree + b * ERP_ASSUMPTION);

  const prices: Record<string, number> = {};
  for (const t of [...tickers, benchmark]) prices[t] = snapshot.tickers[t].quote.value!;

  return {
    tickers,
    dates: dates.slice(1),
    returns,
    benchReturns,
    cov,
    corr,
    benchCov,
    benchVar,
    beta,
    vol,
    prices,
    riskFree,
    erp: ERP_ASSUMPTION,
    expReturn,
    window: { start: dates[0], end: dates[dates.length - 1], days: dates.length },
  };
}

// ---------- portfolio-level metrics (w = weights over model.tickers; cash = 1 − Σw) ----------

export function portfolioVariance(w: number[], cov: number[][]): number {
  let v = 0;
  for (let i = 0; i < w.length; i++) {
    if (w[i] === 0) continue;
    for (let j = 0; j < w.length; j++) v += w[i] * cov[i][j] * w[j];
  }
  return v;
}

export function portfolioVolatility(w: number[], cov: number[][]): number {
  return Math.sqrt(Math.max(0, portfolioVariance(w, cov)));
}

export function portfolioBeta(w: number[], model: MarketModel): number {
  let b = 0;
  for (let i = 0; i < w.length; i++) b += w[i] * model.beta[i];
  return b; // cash contributes beta 0
}

export function portfolioExpReturn(w: number[], model: MarketModel): number {
  // CAPM per asset; the cash sleeve earns the risk-free rate (assumption: swept to T-bills/money market)
  let er = 0,
    sw = 0;
  for (let i = 0; i < w.length; i++) {
    er += w[i] * model.expReturn[i];
    sw += w[i];
  }
  return er + (1 - sw) * model.riskFree;
}

/** Daily return series of a fixed-weight portfolio (rebalanced-daily approximation, labeled in methodology). */
export function portfolioReturnSeries(w: number[], model: MarketModel): number[] {
  const T = model.benchReturns.length;
  const out = new Array(T).fill(0);
  const cashW = 1 - w.reduce((a, b) => a + b, 0);
  const dailyRf = model.riskFree / TRADING_DAYS;
  for (let t = 0; t < T; t++) {
    let r = cashW * dailyRf;
    for (let i = 0; i < w.length; i++) r += w[i] * model.returns[i][t];
    out[t] = r;
  }
  return out;
}

export function trackingError(w: number[], model: MarketModel): number {
  const pr = portfolioReturnSeries(w, model);
  const diffs = pr.map((r, t) => r - model.benchReturns[t]);
  const m = mean(diffs);
  let s = 0;
  for (const d of diffs) s += (d - m) * (d - m);
  return Math.sqrt((s / (diffs.length - 1)) * TRADING_DAYS);
}

export function maxDrawdown(series: number[]): number {
  let peak = 1,
    nav = 1,
    mdd = 0;
  for (const r of series) {
    nav *= 1 + r;
    if (nav > peak) peak = nav;
    const dd = nav / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  return mdd; // negative number
}

/** Annualized downside deviation vs 0% daily MAR. */
export function downsideDeviation(series: number[]): number {
  let s = 0;
  for (const r of series) if (r < 0) s += r * r;
  return Math.sqrt((s / series.length) * TRADING_DAYS);
}

export function concentrationTop5(w: number[]): number {
  return [...w].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
}
