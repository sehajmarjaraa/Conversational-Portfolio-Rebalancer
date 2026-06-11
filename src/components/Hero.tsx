import type { RebalanceResult, Snapshot } from "../types";
import type { EngineContext } from "../engine/engine";
import { CountUp, pct, usd, deltaColor } from "../ui/format";

interface Current {
  value: number;
  metrics: ReturnType<typeof import("../engine/engine").computeMetrics>;
}

export function Hero({
  snapshot,
  ctx,
  current,
  result,
}: {
  snapshot: Snapshot;
  ctx: EngineContext;
  current: Current;
  result: RebalanceResult | null;
}) {
  const m = current.metrics;
  const post = result?.feasible ? result.pre_post_metrics.post : null;
  const asOf = ctx.model.window.end;

  const stat = (
    label: string,
    value: number,
    format: (x: number) => string,
    postVal?: number | null,
    lowerIsBetter = false
  ) => (
    <div className="min-w-0">
      <div className="label mb-1">{label}</div>
      <div className="text-lg sm:text-xl font-medium">
        <CountUp value={value} format={format} />
      </div>
      {postVal != null && Math.abs(postVal - value) > 1e-6 && (
        <div className={`num text-xs mt-0.5 ${deltaColor(postVal - value, lowerIsBetter)}`}>
          → {format(postVal)} post
        </div>
      )}
    </div>
  );

  return (
    <header className="border-b border-edge">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-8">
          <div className="flex items-baseline gap-3">
            <span className="num text-accent font-semibold tracking-tight">rebalance-desk</span>
            <span className="text-faint text-xs hidden sm:inline">
              constraint-aware portfolio rebalancing · real market data
            </span>
          </div>
          <span className="num text-xs text-faint">
            data as of {asOf} · benchmark {snapshot.benchmark}
          </span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.05] max-w-3xl">
          A fiduciary rebalancing desk,
          <br />
          <span className="text-muted">running deterministically in your browser.</span>
        </h1>
        <p className="text-muted mt-4 max-w-2xl text-sm sm:text-base leading-relaxed">
          Twelve real securities, 250 days of real return history, fundamentals from SEC filings.
          Risk analytics and a constrained mean-variance optimizer run as pure TypeScript — no
          backend, no API key. A language model is used for exactly one thing: translating plain
          English into an optimization spec.
        </p>

        <div className="mt-8 panel p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <div>
              <span className="label">demo portfolio</span>
              <span className="num text-2xl sm:text-3xl font-semibold ml-3">
                <CountUp value={current.value} format={usd} />
              </span>
            </div>
            {result && (
              <span className="text-xs text-faint">
                objective applied: <span className="text-ink">{resultLabel(result)}</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4">
            {stat("volatility (ann.)", m.volatility, (x) => pct(x), post?.volatility, true)}
            {stat("expected return*", m.expected_return, (x) => pct(x), post?.expected_return)}
            {stat("sharpe*", m.sharpe, (x) => x.toFixed(2), post?.sharpe)}
            {stat("beta vs SPY", m.beta, (x) => x.toFixed(2), post?.beta, true)}
            {stat("tracking error", m.tracking_error, (x) => pct(x), post?.tracking_error, true)}
            {stat("top-5 weight", m.concentration_top5, (x) => pct(x), post?.concentration_top5, true)}
          </div>
          <p className="text-[11px] text-faint mt-4">
            *Expected return is CAPM (rf {pct(ctx.model.riskFree, 2)} from FRED DGS10, as of{" "}
            {snapshot.risk_free.as_of} + β × 4.5% assumed equity risk premium) — a labeled forward
            assumption, not a market figure. All other metrics computed from real daily closes.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <a
            href="#tool"
            className="bg-accent text-bg font-semibold text-sm px-5 py-2.5 rounded-md hover:opacity-90 transition-opacity"
          >
            Open the desk ↓
          </a>
          <span className="text-xs text-faint">
            Built by <span className="text-muted">Sehaj Marjara</span> ·{" "}
            <a className="underline hover:text-ink" href="https://www.linkedin.com/in/sehajmarjara/">
              LinkedIn
            </a>{" "}
            ·{" "}
            <a className="underline hover:text-ink" href="https://github.com/sehajmarjaraa">
              GitHub
            </a>{" "}
            ·{" "}
            <a className="underline hover:text-ink" href="#">
              Resume
            </a>
          </span>
        </div>
      </div>
    </header>
  );
}

function resultLabel(result: RebalanceResult): string {
  const o = result.spec.objective;
  const names: Record<string, string> = {
    minimize_volatility: "minimize volatility",
    maximize_sharpe: "maximize Sharpe",
    target_volatility: `target ${o.target_volatility ? pct(o.target_volatility) : ""} vol`,
    minimize_tracking_error: "minimize tracking error",
    harvest_losses: "harvest losses",
  };
  return names[o.type] ?? o.type;
}
