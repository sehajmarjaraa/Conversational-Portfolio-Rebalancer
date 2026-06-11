import { useState } from "react";
import type { Snapshot } from "../types";
import type { EngineContext } from "../engine/engine";
import { compact, pct } from "../ui/format";

export function Methodology({ snapshot, ctx }: { snapshot: Snapshot; ctx: EngineContext }) {
  return (
    <section id="data" className="mt-16">
      <h2 className="text-2xl font-semibold tracking-tight mb-1">Real data & methodology</h2>
      <p className="text-muted text-sm mb-6 max-w-2xl">
        Every market figure on this page traces to a public source with an as-of date. The snapshot
        was generated once by <code className="num text-xs">npm run ingest</code> on{" "}
        <span className="num">{snapshot.generated_at.slice(0, 10)}</span> and committed, so the site
        needs no keys and no network.
      </p>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Provenance snapshot={snapshot} ctx={ctx} />
        <div className="space-y-5">
          <Assumptions snapshot={snapshot} ctx={ctx} />
          <Method ctx={ctx} />
        </div>
      </div>
    </section>
  );
}

function Provenance({ snapshot, ctx }: { snapshot: Snapshot; ctx: EngineContext }) {
  const [open, setOpen] = useState<string | null>(ctx.model.tickers[0]);
  const rf = snapshot.risk_free;

  const row = (label: string, value: string, source: string, asOf: string | null) => (
    <div className="border-t border-edge py-2" key={label + source}>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-muted shrink-0">{label}</span>
        <span className="num text-right">{value}</span>
      </div>
      <div className="flex justify-between gap-3 text-[11px] text-faint mt-0.5">
        <span className="leading-relaxed">{source}</span>
        {asOf && <span className="num shrink-0">as of {asOf}</span>}
      </div>
    </div>
  );

  return (
    <div className="panel p-4 sm:p-5">
      <h3 className="label mb-3">provenance · every figure, sourced & dated</h3>

      {row(
        "risk-free rate",
        rf.value != null ? pct(rf.value, 2) : "unavailable",
        rf.source,
        rf.as_of
      )}
      {row(
        "return window",
        `${ctx.model.window.days} sessions`,
        `${ctx.model.window.start} → ${ctx.model.window.end}, aligned daily closes; covariance, beta, drawdown computed in-browser from this window`,
        ctx.model.window.end
      )}

      <div className="mt-3">
        <div className="label mb-2">per-security</div>
        <div className="flex flex-wrap gap-1 mb-3">
          {ctx.model.tickers.map((t) => (
            <button
              key={t}
              onClick={() => setOpen(open === t ? null : t)}
              className={`num text-xs px-2 py-1 rounded border transition-colors ${
                open === t ? "border-accent text-ink" : "border-edge text-muted hover:border-edge2"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {open && <TickerProvenance ticker={open} snapshot={snapshot} />}
      </div>
    </div>
  );
}

function TickerProvenance({ ticker, snapshot }: { ticker: string; snapshot: Snapshot }) {
  const e = snapshot.tickers[ticker];
  const f = e.fundamentals;
  const fmt = (v: number | null | undefined, kind: "pct" | "x" | "usd" | "raw") =>
    v == null
      ? "null (source unreachable at ingest — never fabricated)"
      : kind === "pct"
      ? pct(v)
      : kind === "x"
      ? `${v.toFixed(1)}×`
      : kind === "usd"
      ? compact(v)
      : String(v);

  const rows: { label: string; value: string; src: string; asOf: string | null }[] = [
    {
      label: "last close",
      value: e.quote.value != null ? `$${e.quote.value.toFixed(2)}` : "null",
      src: e.quote.source,
      asOf: e.quote.as_of,
    },
    {
      label: "market cap",
      value: fmt(e.market_cap?.value, "usd"),
      src: e.market_cap?.source ?? "—",
      asOf: e.market_cap?.as_of ?? null,
    },
    {
      label: "sector",
      value: e.sector?.gics_style ?? "—",
      src: e.sector?.source ?? "—",
      asOf: e.sector?.as_of ?? null,
    },
    ...(f
      ? [
          { label: "P/E (trailing FY)", value: fmt(f.pe.value, "x"), src: f.pe.source, asOf: f.pe.as_of },
          { label: "P/B", value: fmt(f.pb.value, "x"), src: f.pb.source, asOf: f.pb.as_of },
          { label: "ROE (FY)", value: fmt(f.roe.value, "pct"), src: f.roe.source, asOf: f.roe.as_of },
          {
            label: "operating margin (FY)",
            value: fmt(f.operating_margin.value, "pct"),
            src: f.operating_margin.source,
            asOf: f.operating_margin.as_of,
          },
          {
            label: "revenue growth YoY",
            value: fmt(f.revenue_growth_yoy.value, "pct"),
            src: f.revenue_growth_yoy.source,
            asOf: f.revenue_growth_yoy.as_of,
          },
        ]
      : []),
    {
      label: "avg daily $ volume",
      value: e.adv_dollar.value != null ? compact(e.adv_dollar.value) : "null",
      src: e.adv_dollar.source,
      asOf: e.adv_dollar.as_of,
    },
  ];

  return (
    <div className="bg-panel2 border border-edge rounded-md p-3 fade-in">
      <div className="text-xs font-medium mb-1">
        {e.name} <span className="num text-faint">({ticker}{e.cik ? ` · CIK ${e.cik}` : ""})</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="border-t border-edge py-1.5 first:border-0">
          <div className="flex justify-between gap-3 text-xs">
            <span className="text-muted shrink-0">{r.label}</span>
            <span className="num text-right">{r.value}</span>
          </div>
          <div className="flex justify-between gap-3 text-[11px] text-faint mt-0.5">
            <span className="leading-relaxed break-words min-w-0">{r.src}</span>
            {r.asOf && <span className="num shrink-0">as of {r.asOf}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Assumptions({ snapshot, ctx }: { snapshot: Snapshot; ctx: EngineContext }) {
  return (
    <div className="panel p-4 sm:p-5 border-warn/30">
      <h3 className="label mb-3 text-warn">labeled assumptions · the only non-market inputs</h3>
      <ul className="text-xs text-muted space-y-2.5 leading-relaxed">
        <li>
          <span className="text-ink font-medium">Expected return</span> — CAPM: rf + β × ERP, with
          rf {snapshot.risk_free.value != null ? pct(snapshot.risk_free.value, 2) : "—"} (FRED
          DGS10, {snapshot.risk_free.as_of}) and an{" "}
          <span className="text-warn">assumed 4.5% equity risk premium</span>. Forward-looking by
          construction; Sharpe and Sortino numerators derive from it and are labeled accordingly.
        </li>
        <li>
          <span className="text-ink font-medium">Factor proxies</span> — growth = FY revenue growth;
          value = mean z(1/P-E, 1/P-B); momentum = 12-1 month return; quality = mean z(ROE,
          operating margin); low-vol = −z(realized σ); size = z(log market cap). Cross-sectional
          z-scores over the 12-name universe; missing inputs (e.g. banks without
          OperatingIncomeLoss) score neutral 0, never invented.
        </li>
        <li>
          <span className="text-ink font-medium">Benchmark sector weights</span> — cap-weighted
          proxy over the 12-name universe, since {snapshot.benchmark} holdings are not ingested.
        </li>
        <li>
          <span className="text-ink font-medium">Portfolio history</span> — pre/post drawdown and
          tracking error apply today's weights to the historical window (fixed-weight
          approximation).
        </li>
        <li>
          <span className="text-ink font-medium">Lots</span> — cost basis and acquisition dates are
          illustrative and editable; cost basis is private information.
        </li>
      </ul>
    </div>
  );
}

function Method({ ctx }: { ctx: EngineContext }) {
  return (
    <div className="panel p-4 sm:p-5">
      <h3 className="label mb-3">optimization method · stated, deterministic</h3>
      <p className="text-xs text-muted leading-relaxed">
        Constrained mean-variance via <span className="text-ink">projected gradient descent</span>:
        exact projection onto the box-and-simplex set (per-name bounds + invested-sum interval,
        bisection on the simplex multiplier), with quadratic exterior penalties for sector caps,
        factor bounds, turnover, and the tax budget, escalated over 8 outer rounds (×10 each, 400
        inner steps). Initialization at current weights, fixed iteration counts, no randomness —
        the same inputs always produce the same trades. Covariance is the sample covariance of{" "}
        {ctx.model.window.days - 1} aligned daily returns, annualized ×252. Infeasible constraint
        sets are detected analytically (capacity checks) and post-solve (violation audit) and
        returned as a relaxation proposal naming the binding constraint — never forced into a bad
        trade.
      </p>
    </div>
  );
}
