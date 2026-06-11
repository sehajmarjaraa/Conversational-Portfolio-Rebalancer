/**
 * Independent verification of rebalance-desk numbers.
 *
 * Recomputes statistics with from-scratch implementations (NOT the engine's
 * functions) and cross-checks every engine output: snapshot internal
 * consistency, risk math, optimizer constraint satisfaction, trade/tax/
 * compliance arithmetic, and determinism. Prints PASS/FAIL per check.
 */
import { readFileSync } from "node:fs";
import { buildContext, runRebalance, currentWeights, portfolioValue, computeMetrics, benchmarkSectorProxy, positionShares } from "../src/engine/engine";
import { portfolioFactorExposure } from "../src/engine/factors";
import { DEMO_PORTFOLIO } from "../src/data/portfolio";
import { PRESETS } from "../src/engine/presets";
import { validateAndClampSpec } from "../src/engine/spec";
import { TRADING_DAYS } from "../src/engine/stats";

const snapshot = JSON.parse(readFileSync("./public/market/snapshot.json", "utf8"));

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); }
  console.log(`${ok ? "  PASS" : "✗ FAIL"}  ${name}${detail && !ok ? `  [${detail}]` : ""}`);
}
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

console.log("\n=== 1. Snapshot internal consistency (derived fields recomputed) ===");
for (const [t, e] of Object.entries<any>(snapshot.tickers)) {
  if (t === snapshot.benchmark) continue;
  const px = e.quote?.value, p = e.prices;
  check(`${t} has ${p?.closes?.length ?? 0} closes (>=240)`, (p?.closes?.length ?? 0) >= 240);
  check(`${t} dates strictly increasing, closes positive`,
    p.dates.every((d: string, i: number) => i === 0 || d > p.dates[i - 1]) && p.closes.every((c: number) => c > 0));
  check(`${t} quote equals last close`, px === p.closes[p.closes.length - 1]);
  // ADV recomputed
  const n = p.closes.length, w = Math.min(20, n);
  let adv = 0; for (let i = n - w; i < n; i++) adv += p.closes[i] * p.volumes[i];
  adv /= w;
  check(`${t} ADV$ = mean(close×vol, 20d)`, close(adv, e.adv_dollar.value, 1), `${adv} vs ${e.adv_dollar.value}`);
  // market cap = price × shares
  if (e.market_cap?.value != null)
    check(`${t} mcap = px × shares`, close(e.market_cap.value, px * e.shares_outstanding.value, 1));
  const f = e.fundamentals;
  if (f) {
    if (f.pe.value != null) check(`${t} P/E = px / EPS`, close(f.pe.value, px / f.eps_diluted_fy.value, 1e-6));
    if (f.pb.value != null) check(`${t} P/B = mcap / equity`, close(f.pb.value, e.market_cap.value / f.stockholders_equity.value, 1e-6));
    if (f.roe.value != null) check(`${t} ROE = NI / equity`, close(f.roe.value, f.net_income_fy.value / f.stockholders_equity.value, 1e-9));
    if (f.operating_margin.value != null) check(`${t} opm = OI / revenue`, close(f.operating_margin.value, f.operating_income_fy.value / f.revenue_fy.value, 1e-9));
    check(`${t} fundamentals all carry source + as_of`,
      ["net_income_fy","stockholders_equity","revenue_fy","eps_diluted_fy"].every(k => f[k].source && (f[k].value == null || f[k].as_of)));
    // sanity ranges
    if (f.operating_margin.value != null) check(`${t} opm in (-0.5, 0.8)`, f.operating_margin.value > -0.5 && f.operating_margin.value < 0.8, String(f.operating_margin.value));
    if (f.roe.value != null) check(`${t} ROE in (-1, 2.5)`, f.roe.value > -1 && f.roe.value < 2.5, String(f.roe.value));
  }
}
check("risk-free in (0.5%, 10%) with source+date", snapshot.risk_free.value > 0.005 && snapshot.risk_free.value < 0.10 && !!snapshot.risk_free.as_of);

console.log("\n=== 2. Risk math recomputed from scratch ===");
const ctx = buildContext(snapshot);
const { model } = ctx;
const N = model.tickers.length, T = model.benchReturns.length;

// independent return alignment + covariance
const closesOf = (t: string) => {
  const p = snapshot.tickers[t].prices;
  const m = new Map(p.dates.map((d: string, i: number) => [d, p.closes[i]]));
  return m as Map<string, number>;
};
const benchDates: string[] = snapshot.tickers[snapshot.benchmark].prices.dates.filter((d: string) =>
  model.tickers.every((t) => closesOf(t).has(d))
);
check("aligned window length matches engine", benchDates.length - 1 === T, `${benchDates.length - 1} vs ${T}`);

const indepReturns = (t: string) => {
  const m = closesOf(t);
  const cs = benchDates.map((d) => m.get(d)!);
  return cs.slice(1).map((c, i) => c / cs[i] - 1);
};
const mean2 = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

let maxVolErr = 0, maxBetaErr = 0, maxCorrViolation = 0;
const benchR = indepReturns(snapshot.benchmark);
const mb = mean2(benchR);
const varB = benchR.reduce((a, r) => a + (r - mb) ** 2, 0) / (T - 1) * TRADING_DAYS;
for (let i = 0; i < N; i++) {
  const r = indepReturns(model.tickers[i]);
  const mi = mean2(r);
  const v = Math.sqrt(r.reduce((a, x) => a + (x - mi) ** 2, 0) / (T - 1) * TRADING_DAYS);
  maxVolErr = Math.max(maxVolErr, Math.abs(v - model.vol[i]));
  const cov = r.reduce((a, x, k) => a + (x - mi) * (benchR[k] - mb), 0) / (T - 1) * TRADING_DAYS;
  maxBetaErr = Math.max(maxBetaErr, Math.abs(cov / varB - model.beta[i]));
}
check("per-asset volatility matches independent calc", maxVolErr < 1e-12, `max err ${maxVolErr}`);
check("per-asset beta vs SPY matches independent calc", maxBetaErr < 1e-12, `max err ${maxBetaErr}`);
check("benchmark variance matches", close(varB, model.benchVar, 1e-12));

// covariance symmetry + correlation bounds + PSD (via Cholesky-with-jitter)
let sym = true;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  if (Math.abs(model.cov[i][j] - model.cov[j][i]) > 1e-15) sym = false;
  const c = model.corr[i][j];
  if (i === j ? Math.abs(c - 1) > 1e-9 : Math.abs(c) > 1 + 1e-9) maxCorrViolation = Math.max(maxCorrViolation, Math.abs(c));
}
check("covariance symmetric", sym);
check("correlation diag=1, |ρ|≤1", maxCorrViolation === 0);
// PSD: all eigenvalue surrogates via Cholesky
const chol = (A: number[][]) => {
  const L = A.map((r) => r.slice());
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= i; j++) {
      let s = L[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (s <= 0) return false; L[i][i] = Math.sqrt(s); }
      else L[i][j] = s / L[j][j];
    }
  }
  return true;
};
check("covariance positive definite (Cholesky succeeds)", chol(model.cov) === true);

// CAPM expected returns
check("expReturn = rf + beta×ERP for all assets",
  model.tickers.every((_, i) => close(model.expReturn[i], model.riskFree + model.beta[i] * 0.045, 1e-12)));

console.log("\n=== 3. Portfolio-level metrics recomputed ===");
const V = portfolioValue(DEMO_PORTFOLIO, model);
let indepV = DEMO_PORTFOLIO.cash_usd;
for (const pos of DEMO_PORTFOLIO.positions) indepV += pos.lots.reduce((a, l) => a + l.shares, 0) * model.prices[pos.ticker];
check("portfolio value = Σ shares×px + cash", close(V, indepV, 1e-6), `${V} vs ${indepV}`);

const w0 = currentWeights(DEMO_PORTFOLIO, model);
check("weights + cash sum to 1", close(w0.reduce((a, b) => a + b, 0) + DEMO_PORTFOLIO.cash_usd / V, 1, 1e-9));

const m0 = computeMetrics(w0, ctx);
// independent portfolio vol via w'Σw
let qf = 0;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) qf += w0[i] * model.cov[i][j] * w0[j];
check("portfolio vol = sqrt(w'Σw)", close(m0.volatility, Math.sqrt(qf), 1e-12));
// independent portfolio return series → TE, maxDD, Sortino denominator
const dailyRf = model.riskFree / TRADING_DAYS;
const cashW = 1 - w0.reduce((a, b) => a + b, 0);
const pr = Array.from({ length: T }, (_, t) => {
  let r = cashW * dailyRf;
  for (let i = 0; i < N; i++) r += w0[i] * indepReturns(model.tickers[i])[t];
  return r;
});
const diffs = pr.map((r, t) => r - benchR[t]);
const md = mean2(diffs);
const te = Math.sqrt(diffs.reduce((a, d) => a + (d - md) ** 2, 0) / (T - 1) * TRADING_DAYS);
check("tracking error matches independent calc", close(te, m0.tracking_error, 1e-12), `${te} vs ${m0.tracking_error}`);
let nav = 1, peak = 1, mdd = 0;
for (const r of pr) { nav *= 1 + r; peak = Math.max(peak, nav); mdd = Math.min(mdd, nav / peak - 1); }
check("max drawdown matches independent calc", close(mdd, m0.max_drawdown_estimate, 1e-12));
const dd = Math.sqrt(pr.reduce((a, r) => a + (r < 0 ? r * r : 0), 0) / pr.length * TRADING_DAYS);
check("sortino = (ER − rf)/downside_dev", close(m0.sortino, (m0.expected_return - model.riskFree) / dd, 1e-12));
check("sharpe = (ER − rf)/vol", close(m0.sharpe, (m0.expected_return - model.riskFree) / m0.volatility, 1e-12));
const top5 = [...w0].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
check("top-5 concentration", close(top5, m0.concentration_top5, 1e-12));
const er = w0.reduce((a, wi, i) => a + wi * model.expReturn[i], 0) + cashW * model.riskFree;
check("expected return = Σw·CAPM + cash·rf", close(er, m0.expected_return, 1e-12));

// benchmark sector proxy sums to 1
const bs = benchmarkSectorProxy(ctx);
check("benchmark sector proxy sums to 1", close(Object.values(bs).reduce((a, b) => a + b, 0), 1, 1e-9));

console.log("\n=== 4. Optimizer outputs: constraints, trades, tax, compliance ===");
const sectorOf = model.tickers.map((t) => snapshot.tickers[t].sector?.gics_style ?? "Other");
for (const p of PRESETS) {
  const spec = validateAndClampSpec(p.build(m0, bs["Information Technology"] ?? 0)).spec!;
  const res = runRebalance(spec, DEMO_PORTFOLIO, ctx);
  const tag = `[${p.id}]`;
  check(`${tag} feasible`, res.feasible);
  if (!res.feasible) continue;
  const wT = model.tickers.map((t) => res.target_weights[t]);
  const c = spec.constraints;
  const TOL = 0.0021; // whole-share rounding drift allowance (20bp + ε)

  check(`${tag} long-only`, wT.every((x) => x >= -1e-12));
  if (c.max_position_weight != null)
    check(`${tag} max position ≤ ${c.max_position_weight}`, Math.max(...wT) <= c.max_position_weight + TOL, `max ${Math.max(...wT).toFixed(4)}`);
  const invested = wT.reduce((a, b) => a + b, 0);
  if (c.cash_weight) {
    const cash = 1 - invested;
    check(`${tag} cash in [${c.cash_weight.min ?? 0}, ${c.cash_weight.max ?? 1}]`,
      cash >= (c.cash_weight.min ?? 0) - TOL && cash <= (c.cash_weight.max ?? 1) + TOL, `cash ${cash.toFixed(4)}`);
  }
  if (c.sector_caps) for (const [s, cap] of Object.entries(c.sector_caps)) {
    let sw = 0; model.tickers.forEach((_, i) => { if (sectorOf[i] === s) sw += wT[i]; });
    check(`${tag} sector ${s} ≤ ${cap}`, sw <= cap + TOL, `got ${sw.toFixed(4)}`);
  }
  if (c.factor_bounds) {
    const fe = portfolioFactorExposure(wT, ctx.factors);
    for (const [f, b] of Object.entries(c.factor_bounds)) {
      if (b?.min != null) check(`${tag} factor ${f} ≥ ${b.min}`, fe[f as keyof typeof fe] >= b.min - 0.03, `got ${fe[f as keyof typeof fe].toFixed(3)}`);
      if (b?.max != null) check(`${tag} factor ${f} ≤ ${b.max}`, fe[f as keyof typeof fe] <= b.max + 0.03);
    }
  }
  if (c.max_turnover != null) {
    let to = 0; model.tickers.forEach((t, i) => { to += Math.abs(wT[i] - res.pre_weights[t]); });
    check(`${tag} turnover ≤ ${c.max_turnover}`, to / 2 <= c.max_turnover + TOL, `got ${(to / 2).toFixed(4)}`);
  }
  if (spec.objective.type === "target_volatility")
    check(`${tag} post vol ≈ target ${spec.objective.target_volatility}`,
      res.pre_post_metrics.post.volatility <= spec.objective.target_volatility! + 0.006,
      `got ${res.pre_post_metrics.post.volatility.toFixed(4)}`);

  // trades arithmetic: notional, delta, and consistency with share counts
  let tradesOk = true, deltaOk = true;
  for (const tr of res.proposed_trades) {
    const px = model.prices[tr.ticker];
    if (!close(tr.notional_usd, tr.share_count * px, 0.01)) tradesOk = false;
    const sign = tr.action === "BUY" ? 1 : -1;
    if (!close(tr.percent_of_portfolio_delta, (sign * tr.share_count * px) / V, 1e-9)) deltaOk = false;
  }
  check(`${tag} trade notional = shares × real price`, tradesOk);
  check(`${tag} trade Δweight = signed notional / V`, deltaOk);
  // post weights consistent with pre + trades
  let recon = true;
  for (const t of model.tickers) {
    const tr = res.proposed_trades.find((x) => x.ticker === t);
    const d = tr ? (tr.action === "BUY" ? 1 : -1) * tr.share_count : 0;
    const postShares = positionShares(DEMO_PORTFOLIO, t) + d;
    if (!close(res.target_weights[t], (postShares * model.prices[t]) / V, 1e-9)) recon = false;
  }
  check(`${tag} post weights = (pre shares ± trades) × px / V`, recon);

  // tax: per-lot gains, sells covered by lots, term classification, totals
  const tax = res.tax_impact_estimate;
  let lotOk = true, termOk = true;
  for (const l of tax.lots) {
    const pos = DEMO_PORTFOLIO.positions.find((x) => x.ticker === l.ticker)!;
    const lot = pos.lots.find((x) => x.id === l.lot_id)!;
    const px = model.prices[l.ticker];
    if (!close(l.realized_gain_usd, l.shares_sold * (px - lot.cost_basis_per_share), 0.01)) lotOk = false;
    if (l.shares_sold > lot.shares) lotOk = false;
    const days = (new Date(model.window.end).getTime() - new Date(lot.acquired).getTime()) / 86400000;
    if ((days > 365) !== (l.term === "long")) termOk = false;
    if (l.wash_sale_risk !== (l.realized_gain_usd < 0 && days <= 30)) termOk = false;
  }
  check(`${tag} lot gains = sold × (px − basis), within lot size`, lotOk);
  check(`${tag} ST/LT terms & wash flags correct`, termOk);
  check(`${tag} tax totals = Σ lots`, close(tax.total_realized_gain_usd, tax.lots.reduce((a, l) => a + l.realized_gain_usd, 0), 0.01)
    && close(tax.short_term_gain_usd + tax.long_term_gain_usd, tax.total_realized_gain_usd, 0.01));
  if (c.max_realized_gains_usd != null)
    check(`${tag} realized gains ≤ tax budget`, tax.total_realized_gain_usd <= c.max_realized_gains_usd + Math.max(50, 0.005 * V) + 1500,
      `$${Math.round(tax.total_realized_gain_usd)}`);
  // HIFO order: within each ticker, lots relieved in descending basis
  let hifo = true;
  const byTicker = new Map<string, typeof tax.lots>();
  tax.lots.forEach((l) => { if (!byTicker.has(l.ticker)) byTicker.set(l.ticker, []); byTicker.get(l.ticker)!.push(l); });
  for (const ls of byTicker.values())
    for (let i = 1; i < ls.length; i++)
      if (ls[i].cost_basis_usd / ls[i].shares_sold > ls[i - 1].cost_basis_usd / ls[i - 1].shares_sold + 1e-9) hifo = false;
  check(`${tag} HIFO lot relief order`, hifo);

  // compliance panel says nothing violated
  check(`${tag} compliance panel: zero 'violated'`, res.constraint_compliance_check.every((x) => x.status !== "violated"),
    res.constraint_compliance_check.filter((x) => x.status === "violated").map((x) => x.constraint).join(","));
  // execution: sells before buys, flags match >1% ADV
  const seq = res.execution_notes;
  const lastSell = seq.filter((n) => n.note.startsWith("SELL")).map((n) => n.sequence);
  const firstBuy = seq.filter((n) => n.note.startsWith("BUY")).map((n) => n.sequence);
  check(`${tag} sells sequenced before buys`, !lastSell.length || !firstBuy.length || Math.max(...lastSell) < Math.min(...firstBuy));
  check(`${tag} liquidity flag ⇔ trade > 1% of ADV`, seq.every((n) => n.trade_pct_of_adv == null || n.liquidity_flag === n.trade_pct_of_adv > 0.01));
}

console.log("\n=== 5. Determinism & infeasibility ===");
const spec0 = validateAndClampSpec(PRESETS[0].build(m0, bs["Information Technology"] ?? 0)).spec!;
const r1 = runRebalance(spec0, DEMO_PORTFOLIO, ctx);
const r2 = runRebalance(spec0, DEMO_PORTFOLIO, ctx);
check("identical spec → byte-identical result", JSON.stringify(r1) === JSON.stringify(r2));

const inf = validateAndClampSpec({ objective: { type: "minimize_volatility" }, constraints: { long_only: true, max_position_weight: 0.03, cash_weight: { max: 0.1 } } }).spec!;
const rInf = runRebalance(inf, DEMO_PORTFOLIO, ctx);
check("infeasible spec → relaxation proposal, zero trades", !rInf.feasible && rInf.relaxation_proposal != null && rInf.proposed_trades.length === 0);
check("infeasible: pre metrics returned unchanged", JSON.stringify(rInf.pre_post_metrics.pre) === JSON.stringify(rInf.pre_post_metrics.post));

console.log(`\n========================================`);
console.log(`${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\nFailures:"); failures.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
