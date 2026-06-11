import type {
  ConstraintCheck,
  ExecutionNote,
  FactorRow,
  LotTaxImpact,
  MetricSet,
  OptimizationSpec,
  Portfolio,
  ProposedTrade,
  RebalanceResult,
  SectorRow,
  Snapshot,
} from "../types";
import { FACTOR_NAMES } from "../types";
import { buildFactorModel, portfolioFactorExposure, type FactorModel } from "./factors";
import { optimize } from "./optimizer";
import {
  buildMarketModel,
  concentrationTop5,
  downsideDeviation,
  maxDrawdown,
  portfolioBeta,
  portfolioExpReturn,
  portfolioReturnSeries,
  portfolioVolatility,
  trackingError,
  type MarketModel,
} from "./stats";

/**
 * Deterministic rebalancing engine. Everything in the RebalanceResult is
 * computed here from the committed real-data snapshot and the user's
 * portfolio — the LLM (when used at all) only produces the OptimizationSpec
 * and may rewrite the client paragraph from these numbers.
 */

export interface EngineContext {
  snapshot: Snapshot;
  model: MarketModel;
  factors: FactorModel;
}

export function buildContext(snapshot: Snapshot): EngineContext {
  const model = buildMarketModel(snapshot);
  const factors = buildFactorModel(snapshot, model);
  return { snapshot, model, factors };
}

// ---------- portfolio helpers ----------

export function positionShares(p: Portfolio, ticker: string): number {
  const pos = p.positions.find((x) => x.ticker === ticker);
  return pos ? pos.lots.reduce((a, l) => a + l.shares, 0) : 0;
}

export function portfolioValue(p: Portfolio, model: MarketModel): number {
  let v = p.cash_usd;
  for (const pos of p.positions) v += positionShares(p, pos.ticker) * (model.prices[pos.ticker] ?? 0);
  return v;
}

export function currentWeights(p: Portfolio, model: MarketModel): number[] {
  const V = portfolioValue(p, model);
  return model.tickers.map((t) => (positionShares(p, t) * (model.prices[t] ?? 0)) / V);
}

const DAY = 86400000;

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY);
}

/** Embedded gain as fraction of market value, floored at 0 (for the tax-budget constraint). */
function gainFractions(p: Portfolio, model: MarketModel): { gainFrac: number[]; hasLoss: boolean[]; washRisky: boolean[] } {
  const asOf = model.window.end;
  const gainFrac: number[] = [];
  const hasLoss: boolean[] = [];
  const washRisky: boolean[] = [];
  for (const t of model.tickers) {
    const pos = p.positions.find((x) => x.ticker === t);
    const px = model.prices[t];
    if (!pos || !px) {
      gainFrac.push(0);
      hasLoss.push(false);
      washRisky.push(false);
      continue;
    }
    let mv = 0,
      cost = 0,
      anyLoss = false,
      anyRisky = false;
    for (const lot of pos.lots) {
      mv += lot.shares * px;
      cost += lot.shares * lot.cost_basis_per_share;
      const lotLoss = px < lot.cost_basis_per_share;
      if (lotLoss) anyLoss = true;
      // wash-sale risk: a loss-sale of shares bought within the last 30 days
      if (lotLoss && daysBetween(lot.acquired, asOf) <= 30) anyRisky = true;
    }
    gainFrac.push(mv > 0 ? Math.max(0, (mv - cost) / mv) : 0);
    hasLoss.push(anyLoss);
    washRisky.push(anyRisky);
  }
  return { gainFrac, hasLoss, washRisky };
}

// ---------- metrics ----------

export function computeMetrics(w: number[], ctx: EngineContext): MetricSet {
  const { model } = ctx;
  const series = portfolioReturnSeries(w, model);
  const er = portfolioExpReturn(w, model);
  const vol = portfolioVolatility(w, model.cov);
  const dd = downsideDeviation(series);
  return {
    expected_return: er,
    volatility: vol,
    sharpe: vol > 0 ? (er - model.riskFree) / vol : 0,
    sortino: dd > 0 ? (er - model.riskFree) / dd : 0,
    max_drawdown_estimate: maxDrawdown(series),
    tracking_error: trackingError(w, model),
    beta: portfolioBeta(w, model),
    concentration_top5: concentrationTop5(w),
  };
}

/** Benchmark sector weights — cap-weighted proxy over the 12-name universe (LABELED ASSUMPTION). */
export function benchmarkSectorProxy(ctx: EngineContext): Record<string, number> {
  const { snapshot, model } = ctx;
  let total = 0;
  const by: Record<string, number> = {};
  for (const t of model.tickers) {
    const mc = snapshot.tickers[t].market_cap?.value ?? 0;
    total += mc;
  }
  for (const t of model.tickers) {
    const e = snapshot.tickers[t];
    const mc = e.market_cap?.value ?? 0;
    const s = e.sector?.gics_style ?? "Other";
    by[s] = (by[s] ?? 0) + (total > 0 ? mc / total : 0);
  }
  return by;
}

// ---------- main entry ----------

export function runRebalance(spec: OptimizationSpec, portfolio: Portfolio, ctx: EngineContext): RebalanceResult {
  const { snapshot, model, factors } = ctx;
  const n = model.tickers.length;
  const w0 = currentWeights(portfolio, model);
  const V = portfolioValue(portfolio, model);
  const { gainFrac, hasLoss, washRisky } = gainFractions(portfolio, model);
  const sectorOf = model.tickers.map((t) => snapshot.tickers[t].sector?.gics_style ?? "Other");

  const out = optimize(spec, {
    model,
    factors,
    w0,
    portfolioValue: V,
    gainFraction: gainFrac,
    washSaleRisky: washRisky,
    hasEmbeddedLoss: hasLoss,
    sectorOf,
  });

  const wT = out.feasible ? out.weights : w0; // infeasible → no trade, show proposal

  // ----- trades (whole shares, real prices; cash absorbs rounding residue) -----
  const trades: ProposedTrade[] = [];
  const postShares: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const t = model.tickers[i];
    const px = model.prices[t];
    const cur = positionShares(portfolio, t);
    const targetSh = Math.round((wT[i] * V) / px);
    postShares[t] = targetSh;
    const dSh = targetSh - cur;
    if (dSh === 0) continue;
    trades.push({
      ticker: t,
      action: dSh > 0 ? "BUY" : "SELL",
      share_count: Math.abs(dSh),
      notional_usd: Math.abs(dSh) * px,
      percent_of_portfolio_delta: (dSh * px) / V,
      rationale: tradeRationale(t, i, dSh > 0 ? "BUY" : "SELL", spec, ctx, w0, wT, hasLoss, sectorOf),
    });
  }
  trades.sort((a, b) => b.notional_usd - a.notional_usd);

  // realized post weights after share rounding
  const wPost = model.tickers.map((t) => (postShares[t] * model.prices[t]) / V);

  // ----- metrics -----
  const pre = computeMetrics(w0, ctx);
  const post = computeMetrics(wPost, ctx);

  // ----- sectors -----
  const benchSect = benchmarkSectorProxy(ctx);
  const sectors = new Set<string>([...sectorOf, ...Object.keys(benchSect)]);
  const sectorRows: SectorRow[] = [...sectors].sort().map((s) => {
    let p = 0,
      q = 0;
    for (let i = 0; i < n; i++) {
      if (sectorOf[i] === s) {
        p += w0[i];
        q += wPost[i];
      }
    }
    return { sector: s, pre: p, post: q, benchmark: benchSect[s] ?? 0 };
  });

  // ----- factors -----
  const fPre = portfolioFactorExposure(w0, factors);
  const fPost = portfolioFactorExposure(wPost, factors);
  const factorRows: FactorRow[] = FACTOR_NAMES.map((f) => ({ factor: f, pre: fPre[f], post: fPost[f] }));

  // ----- tax impact: HIFO lot relief on sells, deterministic -----
  const lotsImpact: LotTaxImpact[] = [];
  const asOf = model.window.end;
  for (const tr of trades) {
    if (tr.action !== "SELL") continue;
    const pos = portfolio.positions.find((p) => p.ticker === tr.ticker)!;
    const px = model.prices[tr.ticker];
    let remaining = tr.share_count;
    // HIFO: relieve highest-cost lots first (tax-aware, deterministic)
    const lots = [...pos.lots].sort((a, b) => b.cost_basis_per_share - a.cost_basis_per_share);
    for (const lot of lots) {
      if (remaining <= 0) break;
      const sold = Math.min(lot.shares, remaining);
      remaining -= sold;
      const gain = sold * (px - lot.cost_basis_per_share);
      const holdDays = daysBetween(lot.acquired, asOf);
      const wash = gain < 0 && holdDays <= 30;
      lotsImpact.push({
        ticker: tr.ticker,
        lot_id: lot.id,
        shares_sold: sold,
        proceeds_usd: sold * px,
        cost_basis_usd: sold * lot.cost_basis_per_share,
        realized_gain_usd: gain,
        term: holdDays > 365 ? "long" : "short",
        wash_sale_risk: wash,
        wash_sale_reason: wash
          ? `Loss sale of shares acquired ${lot.acquired} (${holdDays}d ago) — replacement-purchase window still open`
          : undefined,
      });
    }
  }
  const totalGain = lotsImpact.reduce((a, l) => a + l.realized_gain_usd, 0);
  const stGain = lotsImpact.filter((l) => l.term === "short").reduce((a, l) => a + l.realized_gain_usd, 0);

  // ----- constraint compliance -----
  const checks = buildComplianceChecks(spec, wPost, ctx, w0, sectorOf, totalGain, V, factors);

  // ----- execution notes: sells first (fund the buys), then buys; large-%ADV last in each leg -----
  const notes: ExecutionNote[] = [];
  const ordered = [
    ...trades.filter((t) => t.action === "SELL").sort((a, b) => a.notional_usd - b.notional_usd),
    ...trades.filter((t) => t.action === "BUY").sort((a, b) => a.notional_usd - b.notional_usd),
  ];
  ordered.forEach((tr, k) => {
    const adv = snapshot.tickers[tr.ticker].adv_dollar?.value ?? null;
    const pctAdv = adv ? tr.notional_usd / adv : null;
    const flag = pctAdv != null && pctAdv > 0.01; // > 1% of avg daily dollar volume
    notes.push({
      ticker: tr.ticker,
      sequence: k + 1,
      liquidity_flag: flag,
      trade_pct_of_adv: pctAdv,
      order_type: flag ? "VWAP / staged limit over the session" : "marketable limit",
      note: flag
        ? `${tr.action} ${tr.share_count} sh ≈ ${(pctAdv! * 100).toFixed(2)}% of 20-day avg dollar volume — work the order, avoid market orders`
        : `${tr.action} ${tr.share_count} sh is small vs average volume (${pctAdv != null ? (pctAdv * 100).toFixed(3) : "n/a"}% of ADV)`,
    });
  });

  const preW: Record<string, number> = {};
  const tgtW: Record<string, number> = {};
  model.tickers.forEach((t, i) => {
    preW[t] = w0[i];
    tgtW[t] = wPost[i];
  });

  return {
    feasible: out.feasible,
    relaxation_proposal: out.relaxation,
    proposed_trades: out.feasible ? trades : [],
    pre_post_metrics: { pre, post: out.feasible ? post : pre },
    sector_exposures_pre_post: sectorRows,
    factor_exposures: factorRows,
    tax_impact_estimate: {
      lots: out.feasible ? lotsImpact : [],
      total_realized_gain_usd: out.feasible ? totalGain : 0,
      short_term_gain_usd: out.feasible ? stGain : 0,
      long_term_gain_usd: out.feasible ? totalGain - stGain : 0,
      wash_sale_flags: out.feasible ? lotsImpact.filter((l) => l.wash_sale_risk).length : 0,
    },
    constraint_compliance_check: checks,
    execution_notes: out.feasible ? notes : [],
    one_paragraph_rationale: out.feasible
      ? defaultRationale(spec, pre, post, totalGain, trades.length)
      : `The requested constraint set is infeasible: ${out.relaxation!.binding_constraint} (limit ${out.relaxation!.current_limit}, best achievable ${out.relaxation!.achievable_value}). ${out.relaxation!.suggestion} No trades are proposed.`,
    target_weights: tgtW,
    pre_weights: preW,
    spec,
  };
}

// ---------- deterministic prose ----------

function tradeRationale(
  ticker: string,
  i: number,
  action: "BUY" | "SELL",
  spec: OptimizationSpec,
  ctx: EngineContext,
  w0: number[],
  wT: number[],
  hasLoss: boolean[],
  sectorOf: string[]
): string {
  const { model } = ctx;
  const c = spec.constraints;
  if (action === "SELL") {
    if (c.max_position_weight != null && w0[i] > c.max_position_weight + 1e-4)
      return `Trims ${ticker} from ${(w0[i] * 100).toFixed(1)}% to comply with the ${(c.max_position_weight * 100).toFixed(0)}% per-name cap.`;
    if (c.sector_caps?.[sectorOf[i]] != null)
      return `Reduces ${sectorOf[i]} exposure toward the ${(c.sector_caps[sectorOf[i]]! * 100).toFixed(0)}% sector cap.`;
    if (spec.objective.type === "harvest_losses" && hasLoss[i])
      return `Realizes an embedded loss in ${ticker} to harvest against gains elsewhere.`;
    if (model.vol[i] > 0.3) return `Cuts one of the highest-volatility names (σ ${(model.vol[i] * 100).toFixed(0)}% ann.) to lower portfolio risk.`;
    return `Reduces ${ticker} where its marginal risk contribution exceeds its CAPM-expected reward under the chosen objective.`;
  }
  if (model.vol[i] < 0.22) return `Adds to ${ticker}, a lower-volatility diversifier (σ ${(model.vol[i] * 100).toFixed(0)}% ann.) under the chosen objective.`;
  if (model.beta[i] < 0.9) return `Adds low-beta ${ticker} (β ${model.beta[i].toFixed(2)}) to damp benchmark sensitivity.`;
  return `Increases ${ticker} where the optimizer finds favorable risk-adjusted contribution within constraints.`;
}

function defaultRationale(spec: OptimizationSpec, pre: MetricSet, post: MetricSet, gain: number, nTrades: number): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const objText: Record<string, string> = {
    minimize_volatility: "minimize portfolio volatility",
    maximize_sharpe: "maximize the (CAPM-based) Sharpe ratio",
    target_volatility: `bring volatility to the ${pct(spec.objective.target_volatility ?? post.volatility)} target`,
    minimize_tracking_error: "minimize tracking error to the benchmark",
    harvest_losses: "harvest embedded losses while staying close to the benchmark",
  };
  return (
    `This proposal uses ${nTrades} trades to ${objText[spec.objective.type]} within your stated constraints. ` +
    `Annualized volatility moves from ${pct(pre.volatility)} to ${pct(post.volatility)}, expected return (CAPM, assumed 4.5% equity risk premium) from ${pct(pre.expected_return)} to ${pct(post.expected_return)}, ` +
    `and the Sharpe ratio from ${pre.sharpe.toFixed(2)} to ${post.sharpe.toFixed(2)}. Tracking error vs SPY ${post.tracking_error > pre.tracking_error ? "rises" : "falls"} to ${pct(post.tracking_error)}, ` +
    `top-5 concentration ${post.concentration_top5 > pre.concentration_top5 ? "increases" : "decreases"} to ${pct(post.concentration_top5)}, and the estimated net realized capital ${gain >= 0 ? "gain" : "loss"} is $${Math.abs(Math.round(gain)).toLocaleString()}. ` +
    `All figures are computed deterministically from real market history and SEC filings as dated in the provenance panel; this is an educational demonstration, not investment advice.`
  );
}

function buildComplianceChecks(
  spec: OptimizationSpec,
  w: number[],
  ctx: EngineContext,
  w0: number[],
  sectorOf: string[],
  realizedGain: number,
  V: number,
  factors: FactorModel
): ConstraintCheck[] {
  const { model } = ctx;
  const n = model.tickers.length;
  const c = spec.constraints;
  const checks: ConstraintCheck[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  // 20bp tolerance: whole-share rounding can drift a weight a few bp past a cap
  const status = (buffer: number, limit: number): ConstraintCheck["status"] =>
    buffer < -0.002 ? "violated" : buffer < Math.max(0.01, 0.1 * Math.abs(limit)) ? "near-bound" : "ok";

  checks.push({
    constraint: "long_only",
    limit: "w ≥ 0",
    achieved: pct(Math.min(...w)),
    buffer: pct(Math.min(...w)),
    status: Math.min(...w) < -1e-9 ? "violated" : "ok",
  });

  if (c.max_position_weight != null) {
    const mx = Math.max(...w);
    const i = w.indexOf(mx);
    checks.push({
      constraint: `max position (${model.tickers[i]})`,
      limit: pct(c.max_position_weight),
      achieved: pct(mx),
      buffer: pct(c.max_position_weight - mx),
      status: status(c.max_position_weight - mx, c.max_position_weight),
    });
  }
  if (c.sector_caps) {
    for (const [s, cap] of Object.entries(c.sector_caps)) {
      let sw = 0;
      for (let i = 0; i < n; i++) if (sectorOf[i] === s) sw += w[i];
      checks.push({
        constraint: `sector cap ${s}`,
        limit: pct(cap),
        achieved: pct(sw),
        buffer: pct(cap - sw),
        status: status(cap - sw, cap),
      });
    }
  }
  if (c.factor_bounds) {
    for (const f of FACTOR_NAMES) {
      const b = c.factor_bounds[f];
      if (!b) continue;
      let e = 0;
      for (let i = 0; i < n; i++) e += w[i] * factors.z[f][i];
      if (b.min != null)
        checks.push({
          constraint: `factor ${f} ≥ ${b.min.toFixed(2)}`,
          limit: b.min.toFixed(2),
          achieved: e.toFixed(2),
          buffer: (e - b.min).toFixed(2),
          status: status(e - b.min, 1),
        });
      if (b.max != null)
        checks.push({
          constraint: `factor ${f} ≤ ${b.max.toFixed(2)}`,
          limit: b.max.toFixed(2),
          achieved: e.toFixed(2),
          buffer: (b.max - e).toFixed(2),
          status: status(b.max - e, 1),
        });
    }
  }
  const cash = 1 - w.reduce((a, b) => a + b, 0);
  if (c.cash_weight?.min != null || c.cash_weight?.max != null) {
    const lo = c.cash_weight.min ?? 0;
    const hi = c.cash_weight.max ?? 1;
    const buffer = Math.min(cash - lo, hi - cash);
    checks.push({
      constraint: "cash sleeve",
      limit: `${pct(lo)} – ${pct(hi)}`,
      achieved: pct(cash),
      buffer: pct(buffer),
      status: status(buffer, hi - lo || 1),
    });
  }
  if (c.max_turnover != null) {
    let t = 0;
    for (let i = 0; i < n; i++) t += Math.abs(w[i] - w0[i]);
    t /= 2;
    checks.push({
      constraint: "turnover (one-way)",
      limit: pct(c.max_turnover),
      achieved: pct(t),
      buffer: pct(c.max_turnover - t),
      status: status(c.max_turnover - t, c.max_turnover),
    });
  }
  if (c.max_realized_gains_usd != null) {
    const buffer = c.max_realized_gains_usd - realizedGain;
    checks.push({
      constraint: "tax budget (net realized gains)",
      limit: `$${Math.round(c.max_realized_gains_usd).toLocaleString()}`,
      achieved: `$${Math.round(realizedGain).toLocaleString()}`,
      buffer: `$${Math.round(buffer).toLocaleString()}`,
      status: buffer < 0 ? "violated" : buffer < 0.005 * V ? "near-bound" : "ok",
    });
  }
  if (spec.objective.type === "target_volatility" && spec.objective.target_volatility != null) {
    const vol = portfolioVolatility(w, model.cov);
    checks.push({
      constraint: "volatility target",
      limit: pct(spec.objective.target_volatility),
      achieved: pct(vol),
      buffer: pct(spec.objective.target_volatility - vol),
      status: vol > spec.objective.target_volatility + 0.005 ? "violated" : "ok",
    });
  }
  return checks;
}
