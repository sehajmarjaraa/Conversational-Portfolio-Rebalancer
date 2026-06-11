import type { ConstraintRelaxationProposal, OptimizationSpec } from "../types";
import { FACTOR_NAMES } from "../types";
import type { FactorModel } from "./factors";
import type { MarketModel } from "./stats";
import { portfolioVolatility } from "./stats";

/**
 * Constrained mean-variance optimizer.
 *
 * METHOD (stated in the methodology panel): projected gradient descent with
 * an exact projection onto the box-and-simplex set
 *     { lb ≤ w ≤ ub,  Σw ∈ [investMin, investMax] }
 * (bisection on the simplex Lagrange multiplier), and quadratic exterior
 * penalties for sector caps, factor bounds, turnover, and the tax budget,
 * with the penalty weight escalated over 8 outer rounds (×10 each round,
 * 400 inner steps). Fully deterministic: fixed iteration counts, fixed
 * initialization at current weights, no randomness.
 */

export interface OptimizerInputs {
  model: MarketModel;
  factors: FactorModel;
  /** current weights over model.tickers (invested only; cash = 1 − Σw0) */
  w0: number[];
  /** total portfolio value in USD (for the tax-budget constraint) */
  portfolioValue: number;
  /** embedded gain as a fraction of market value per name, floor 0 (from real lots & prices) */
  gainFraction: number[];
  /** names where any sale would realize a loss on a lot bought <30d ago (wash-sale risk) */
  washSaleRisky: boolean[];
  /** names with an embedded loss at current prices (for harvest_losses) */
  hasEmbeddedLoss: boolean[];
  sectorOf: string[]; // sector name per asset
}

export interface OptimizerOutput {
  feasible: boolean;
  weights: number[]; // target weights over model.tickers
  relaxation: ConstraintRelaxationProposal | null;
}

const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function optimize(spec: OptimizationSpec, inp: OptimizerInputs): OptimizerOutput {
  const { model, factors, w0 } = inp;
  const n = model.tickers.length;
  const c = spec.constraints;

  // ----- bounds -----
  const ubVal = c.max_position_weight ?? 1;
  const ub = new Array(n).fill(Math.min(1, ubVal));
  const lb = new Array(n).fill(0);
  if (c.avoid_wash_sale) {
    // deterministically forbid sells that would trigger a wash-sale flag
    for (let i = 0; i < n; i++) if (inp.washSaleRisky[i]) lb[i] = Math.min(w0[i], ub[i]);
  }
  const cashMin = c.cash_weight?.min ?? 0;
  const cashMax = c.cash_weight?.max ?? 1;
  const investMin = Math.max(0, 1 - cashMax);
  const investMax = Math.min(1, 1 - cashMin);

  // ----- analytic feasibility pre-checks -----
  const sumUb = ub.reduce((a, b) => a + b, 0);
  if (sumUb < investMin - 1e-9) {
    return {
      feasible: false,
      weights: w0,
      relaxation: {
        binding_constraint: "max_position_weight",
        current_limit: fmtPct(ubVal),
        achievable_value: fmtPct(investMin / n),
        suggestion: `With ${n} names, a ${fmtPct(ubVal)} per-name cap supports at most ${fmtPct(sumUb)} invested, but the cash constraint requires at least ${fmtPct(investMin)} invested. Raise max_position_weight to ≥ ${fmtPct(investMin / n)} or allow more cash.`,
      },
    };
  }
  if (c.sector_caps) {
    // capacity check with sector caps applied
    const bySector = new Map<string, number>(); // sum of ub per sector
    for (let i = 0; i < n; i++) bySector.set(inp.sectorOf[i], (bySector.get(inp.sectorOf[i]) ?? 0) + ub[i]);
    let capacity = 0;
    for (const [s, sumU] of bySector) {
      const cap = c.sector_caps[s];
      capacity += cap != null ? Math.min(cap, sumU) : sumU;
    }
    if (capacity < investMin - 1e-9) {
      const binding = Object.entries(c.sector_caps).sort((a, b) => a[1] - b[1])[0];
      return {
        feasible: false,
        weights: w0,
        relaxation: {
          binding_constraint: `sector_cap:${binding[0]}`,
          current_limit: fmtPct(binding[1]),
          achievable_value: fmtPct(capacity),
          suggestion: `Sector caps plus the position cap leave only ${fmtPct(capacity)} of investable capacity, below the ${fmtPct(investMin)} required by the cash constraint. Relax the ${binding[0]} cap (currently ${fmtPct(binding[1])}) or allow a larger cash sleeve.`,
        },
      };
    }
  }
  const sumLb = lb.reduce((a, b) => a + b, 0);
  if (sumLb > investMax + 1e-9) {
    return {
      feasible: false,
      weights: w0,
      relaxation: {
        binding_constraint: "avoid_wash_sale + cash_weight",
        current_limit: fmtPct(cashMin),
        achievable_value: fmtPct(1 - sumLb),
        suggestion: `Wash-sale protection freezes ${fmtPct(sumLb)} of holdings, which conflicts with the minimum cash requirement. Lower cash_weight.min or allow wash-sale-risky sales.`,
      },
    };
  }

  // ----- projection onto { lb ≤ w ≤ ub, Σw ∈ [investMin, investMax] } -----
  const project = (w: number[]): number[] => {
    const clip = (x: number, i: number) => Math.min(ub[i], Math.max(lb[i], x));
    const sumAt = (lambda: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += clip(w[i] - lambda, i);
      return s;
    };
    const s0 = sumAt(0);
    let target: number;
    if (s0 >= investMin && s0 <= investMax) return w.map((x, i) => clip(x, i));
    target = s0 < investMin ? investMin : investMax;
    // bisection on lambda (sumAt is monotone decreasing)
    let lo = -2,
      hi = 2;
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2;
      if (sumAt(mid) > target) lo = mid;
      else hi = mid;
    }
    const lambda = (lo + hi) / 2;
    return w.map((x, i) => clip(x - lambda, i));
  };

  // ----- objective gradient -----
  const cov = model.cov;
  const sigmaW = (w: number[]) => {
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) out[i] += cov[i][j] * w[j];
    }
    return out;
  };
  const excessMu = model.expReturn.map((m) => m - model.riskFree);

  const objGrad = (w: number[]): number[] => {
    const Sw = sigmaW(w);
    const sigma = Math.max(1e-6, Math.sqrt(w.reduce((a, wi, i) => a + wi * Sw[i], 0)));
    switch (spec.objective.type) {
      case "minimize_volatility":
        return Sw.map((x) => 2 * x);
      case "maximize_sharpe": {
        const e = w.reduce((a, wi, i) => a + wi * excessMu[i], 0);
        return w.map((_, i) => -excessMu[i] / sigma + (e * Sw[i]) / Math.pow(sigma, 3));
      }
      case "target_volatility": {
        const t = spec.objective.target_volatility ?? sigma;
        const kappa = 0.05; // mild preference for expected return once the vol target is met
        return w.map((_, i) => (2 * (sigma - t) * Sw[i]) / sigma - kappa * excessMu[i]);
      }
      case "minimize_tracking_error":
        return Sw.map((x, i) => 2 * x - 2 * model.benchCov[i]);
      case "harvest_losses": {
        // stay near the benchmark while pushing weight out of embedded-loss names
        const lambdaH = 0.02;
        return Sw.map((x, i) => 2 * x - 2 * model.benchCov[i] + (inp.hasEmbeddedLoss[i] ? lambdaH : 0));
      }
    }
  };

  // ----- penalty terms -----
  const sectorIdx = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const s = inp.sectorOf[i];
    if (!sectorIdx.has(s)) sectorIdx.set(s, []);
    sectorIdx.get(s)!.push(i);
  }

  type Violation = { name: string; limit: string; excess: number; achieved: string; suggestion: string };

  const realizedGains = (w: number[]) => {
    let g = 0;
    for (let i = 0; i < n; i++) {
      const sold = Math.max(0, w0[i] - w[i]);
      g += sold * inp.portfolioValue * inp.gainFraction[i];
    }
    return g;
  };
  const turnover = (w: number[]) => {
    let t = 0;
    for (let i = 0; i < n; i++) t += Math.abs(w[i] - w0[i]);
    return t / 2;
  };

  const penaltyGrad = (w: number[], rho: number): number[] => {
    const g = new Array(n).fill(0);
    if (c.sector_caps) {
      for (const [s, cap] of Object.entries(c.sector_caps)) {
        const idx = sectorIdx.get(s);
        if (!idx) continue;
        const sw = idx.reduce((a, i) => a + w[i], 0);
        const over = sw - cap;
        if (over > 0) for (const i of idx) g[i] += rho * 2 * over;
      }
    }
    if (c.factor_bounds) {
      for (const f of FACTOR_NAMES) {
        const b = c.factor_bounds[f];
        if (!b) continue;
        let e = 0;
        for (let i = 0; i < n; i++) e += w[i] * factors.z[f][i];
        if (b.max != null && e > b.max) {
          const over = e - b.max;
          for (let i = 0; i < n; i++) g[i] += rho * 2 * over * factors.z[f][i];
        }
        if (b.min != null && e < b.min) {
          const under = b.min - e;
          for (let i = 0; i < n; i++) g[i] -= rho * 2 * under * factors.z[f][i];
        }
      }
    }
    if (c.max_turnover != null) {
      const over = turnover(w) - c.max_turnover;
      if (over > 0) {
        for (let i = 0; i < n; i++) g[i] += rho * 2 * over * 0.5 * Math.sign(w[i] - w0[i]);
      }
    }
    if (c.max_realized_gains_usd != null) {
      const scale = Math.max(1, inp.portfolioValue);
      const over = (realizedGains(w) - c.max_realized_gains_usd) / scale;
      if (over > 0) {
        for (let i = 0; i < n; i++) {
          if (w[i] < w0[i]) g[i] -= rho * 2 * over * inp.gainFraction[i]; // selling less reduces gains
        }
      }
    }
    return g;
  };

  // ----- projected gradient descent, deterministic -----
  // Lipschitz-ish step from the covariance scale (annualized variances ~0.04–0.25)
  const maxDiag = Math.max(...cov.map((r, i) => r[i]));
  let w = project([...w0]);
  let rho = 10;
  for (let outer = 0; outer < 8; outer++) {
    const step = 0.5 / (2 * maxDiag * n + rho * 4);
    for (let it = 0; it < 400; it++) {
      const g = objGrad(w);
      const p = penaltyGrad(w, rho);
      const next = w.map((wi, i) => wi - step * (g[i] + p[i]));
      w = project(next);
    }
    rho *= 10;
  }

  // round tiny residual weights to zero, re-project
  w = project(w.map((x) => (x < 5e-4 ? 0 : x)));

  // ----- post-solve feasibility audit (tolerance 0.5% of limit or 50bp absolute) -----
  const violations: Violation[] = [];
  const TOL = 5e-3;
  if (c.sector_caps) {
    for (const [s, cap] of Object.entries(c.sector_caps)) {
      const idx = sectorIdx.get(s);
      if (!idx) continue;
      const sw = idx.reduce((a, i) => a + w[i], 0);
      if (sw > cap + TOL)
        violations.push({
          name: `sector_cap:${s}`,
          limit: fmtPct(cap),
          achieved: fmtPct(sw),
          excess: sw - cap,
          suggestion: `Raise the ${s} cap to ≥ ${fmtPct(sw)} or relax the constraints that force weight into ${s}.`,
        });
    }
  }
  if (c.factor_bounds) {
    for (const f of FACTOR_NAMES) {
      const b = c.factor_bounds[f];
      if (!b) continue;
      let e = 0;
      for (let i = 0; i < n; i++) e += w[i] * factors.z[f][i];
      if (b.max != null && e > b.max + 0.02)
        violations.push({
          name: `factor_bound:${f} ≤ ${b.max.toFixed(2)}`,
          limit: b.max.toFixed(2),
          achieved: e.toFixed(2),
          excess: e - b.max,
          suggestion: `The ${f} exposure cannot be brought below ${e.toFixed(2)} given the other constraints; raise the bound to ≥ ${e.toFixed(2)}.`,
        });
      if (b.min != null && e < b.min - 0.02)
        violations.push({
          name: `factor_bound:${f} ≥ ${b.min.toFixed(2)}`,
          limit: b.min.toFixed(2),
          achieved: e.toFixed(2),
          excess: b.min - e,
          suggestion: `The ${f} exposure cannot be raised above ${e.toFixed(2)} given the other constraints (position caps, long-only); lower the bound to ≤ ${e.toFixed(2)}.`,
        });
    }
  }
  if (c.max_turnover != null && turnover(w) > c.max_turnover + TOL) {
    violations.push({
      name: "max_turnover",
      limit: fmtPct(c.max_turnover),
      achieved: fmtPct(turnover(w)),
      excess: turnover(w) - c.max_turnover,
      suggestion: `The objective cannot be met within ${fmtPct(c.max_turnover)} turnover; allow ≥ ${fmtPct(turnover(w))} or accept a smaller improvement.`,
    });
  }
  if (c.max_realized_gains_usd != null) {
    const g = realizedGains(w);
    const tolUsd = Math.max(50, 0.005 * inp.portfolioValue);
    if (g > c.max_realized_gains_usd + tolUsd) {
      violations.push({
        name: "max_realized_gains_usd",
        limit: `$${Math.round(c.max_realized_gains_usd).toLocaleString()}`,
        achieved: `$${Math.round(g).toLocaleString()}`,
        excess: (g - c.max_realized_gains_usd) / inp.portfolioValue,
        suggestion: `Meeting the objective realizes ≈ $${Math.round(g).toLocaleString()} of gains; raise the tax budget or cap turnover instead.`,
      });
    }
  }
  if (spec.objective.type === "target_volatility" && spec.objective.target_volatility != null) {
    const vol = portfolioVolatility(w, cov);
    if (vol > spec.objective.target_volatility + 0.005) {
      violations.push({
        name: "target_volatility",
        limit: fmtPct(spec.objective.target_volatility),
        achieved: fmtPct(vol),
        excess: vol - spec.objective.target_volatility,
        suggestion: `The lowest volatility reachable under these constraints is ≈ ${fmtPct(vol)}. Raise the target, allow more cash, or relax position/sector caps.`,
      });
    }
  }

  if (violations.length) {
    violations.sort((a, b) => b.excess - a.excess);
    const v = violations[0];
    return {
      feasible: false,
      weights: w,
      relaxation: {
        binding_constraint: v.name,
        current_limit: v.limit,
        achievable_value: v.achieved,
        suggestion: v.suggestion,
      },
    };
  }

  return { feasible: true, weights: w, relaxation: null };
}
