import type { OptimizationSpec } from "../types";
import { FACTOR_NAMES } from "../types";

/**
 * Schema validation + clamping for OptimizationSpec.
 * Applied to every spec — presets, manual controls, and (especially) the
 * LLM-translated spec — so nothing outside sane bounds reaches the optimizer.
 */

const OBJECTIVES = new Set([
  "minimize_volatility",
  "maximize_sharpe",
  "target_volatility",
  "minimize_tracking_error",
  "harvest_losses",
]);

const KNOWN_SECTORS = new Set([
  "Information Technology",
  "Consumer Discretionary",
  "Consumer Staples",
  "Financials",
  "Health Care",
  "Energy",
  "Industrials",
  "Communication Services",
  "Utilities",
  "Materials",
  "Real Estate",
  "Other",
]);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function validateAndClampSpec(raw: unknown): { spec: OptimizationSpec | null; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) return { spec: null, errors: ["spec is not an object"] };
  const r = raw as any;

  if (!r.objective || !OBJECTIVES.has(r.objective.type)) {
    return { spec: null, errors: [`objective.type must be one of ${[...OBJECTIVES].join(", ")}`] };
  }

  const spec: OptimizationSpec = {
    objective: { type: r.objective.type },
    constraints: { long_only: true },
    notes: typeof r.notes === "string" ? r.notes.slice(0, 500) : undefined,
  };

  if (r.objective.type === "target_volatility") {
    const t = Number(r.objective.target_volatility);
    if (!isFinite(t)) return { spec: null, errors: ["target_volatility objective requires objective.target_volatility"] };
    spec.objective.target_volatility = clamp(t, 0.02, 0.6);
    if (spec.objective.target_volatility !== t) errors.push(`target_volatility clamped to ${spec.objective.target_volatility}`);
  }

  const c = r.constraints ?? {};
  if (c.max_position_weight != null && isFinite(Number(c.max_position_weight))) {
    spec.constraints.max_position_weight = clamp(Number(c.max_position_weight), 0.02, 1);
  }
  if (c.sector_caps && typeof c.sector_caps === "object") {
    const caps: Record<string, number> = {};
    for (const [s, v] of Object.entries(c.sector_caps)) {
      if (!KNOWN_SECTORS.has(s)) {
        errors.push(`unknown sector "${s}" dropped`);
        continue;
      }
      const num = Number(v);
      if (isFinite(num)) caps[s] = clamp(num, 0, 1);
    }
    if (Object.keys(caps).length) spec.constraints.sector_caps = caps;
  }
  if (c.factor_bounds && typeof c.factor_bounds === "object") {
    const fb: OptimizationSpec["constraints"]["factor_bounds"] = {};
    for (const f of FACTOR_NAMES) {
      const b = c.factor_bounds[f];
      if (!b) continue;
      const entry: { min?: number; max?: number } = {};
      if (b.min != null && isFinite(Number(b.min))) entry.min = clamp(Number(b.min), -2, 2);
      if (b.max != null && isFinite(Number(b.max))) entry.max = clamp(Number(b.max), -2, 2);
      if (entry.min != null || entry.max != null) fb[f] = entry;
    }
    if (Object.keys(fb).length) spec.constraints.factor_bounds = fb;
  }
  if (c.cash_weight && typeof c.cash_weight === "object") {
    const cw: { min?: number; max?: number } = {};
    if (c.cash_weight.min != null && isFinite(Number(c.cash_weight.min))) cw.min = clamp(Number(c.cash_weight.min), 0, 0.5);
    if (c.cash_weight.max != null && isFinite(Number(c.cash_weight.max))) cw.max = clamp(Number(c.cash_weight.max), cw.min ?? 0, 1);
    if (cw.min != null || cw.max != null) spec.constraints.cash_weight = cw;
  }
  if (c.max_turnover != null && isFinite(Number(c.max_turnover))) {
    spec.constraints.max_turnover = clamp(Number(c.max_turnover), 0.01, 1);
  }
  if (c.max_realized_gains_usd != null && isFinite(Number(c.max_realized_gains_usd))) {
    spec.constraints.max_realized_gains_usd = clamp(Number(c.max_realized_gains_usd), 0, 10_000_000);
  }
  if (c.avoid_wash_sale != null) spec.constraints.avoid_wash_sale = Boolean(c.avoid_wash_sale);

  return { spec, errors };
}
