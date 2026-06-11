import { readFileSync } from "node:fs";
import { buildContext, runRebalance, currentWeights, portfolioValue, computeMetrics, benchmarkSectorProxy } from "../src/engine/engine";
import { DEMO_PORTFOLIO } from "../src/data/portfolio";
import { PRESETS } from "../src/engine/presets";
import { validateAndClampSpec } from "../src/engine/spec";

const snapshot = JSON.parse(readFileSync("./public/market/snapshot.json", "utf8"));
const ctx = buildContext(snapshot);
const V = portfolioValue(DEMO_PORTFOLIO, ctx.model);
const w0 = currentWeights(DEMO_PORTFOLIO, ctx.model);
const pre = computeMetrics(w0, ctx);
console.log("Portfolio value: $" + Math.round(V).toLocaleString());
console.log("Pre: vol=" + (pre.volatility*100).toFixed(1) + "% er=" + (pre.expected_return*100).toFixed(1) + "% sharpe=" + pre.sharpe.toFixed(2) + " sortino=" + pre.sortino.toFixed(2) + " beta=" + pre.beta.toFixed(2) + " TE=" + (pre.tracking_error*100).toFixed(1) + "% mdd=" + (pre.max_drawdown_estimate*100).toFixed(1) + "% top5=" + (pre.concentration_top5*100).toFixed(1) + "%");
const bench = benchmarkSectorProxy(ctx);
console.log("Bench IT proxy:", ((bench["Information Technology"]??0)*100).toFixed(1) + "%");
for (const p of PRESETS) {
  const spec = validateAndClampSpec(p.build(pre, bench["Information Technology"] ?? 0)).spec!;
  const t0 = Date.now();
  const res = runRebalance(spec, DEMO_PORTFOLIO, ctx);
  const m = res.pre_post_metrics.post;
  console.log(`\n[${p.id}] feasible=${res.feasible} trades=${res.proposed_trades.length} ${Date.now()-t0}ms`);
  console.log(`  post: vol=${(m.volatility*100).toFixed(1)}% er=${(m.expected_return*100).toFixed(1)}% sharpe=${m.sharpe.toFixed(2)} TE=${(m.tracking_error*100).toFixed(1)}% top5=${(m.concentration_top5*100).toFixed(1)}%`);
  console.log(`  gains=$${Math.round(res.tax_impact_estimate.total_realized_gain_usd).toLocaleString()} washflags=${res.tax_impact_estimate.wash_sale_flags}`);
  if (!res.feasible) console.log("  RELAX:", res.relaxation_proposal);
  const bad = res.constraint_compliance_check.filter(c=>c.status==="violated");
  if (bad.length) console.log("  VIOLATED:", bad);
}
// infeasible case: 2% max position with min 80% invested
const inf = validateAndClampSpec({objective:{type:"minimize_volatility"},constraints:{long_only:true,max_position_weight:0.02,cash_weight:{max:0.1}}}).spec!;
const r2 = runRebalance(inf, DEMO_PORTFOLIO, ctx);
console.log("\n[infeasible test] feasible=" + r2.feasible, r2.relaxation_proposal?.binding_constraint, "|", r2.relaxation_proposal?.suggestion);
