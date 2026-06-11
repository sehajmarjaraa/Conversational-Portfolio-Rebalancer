import type { RebalanceResult, Snapshot } from "../types";
import type { EngineContext } from "../engine/engine";
import { CountUp, deltaColor, pct, signedPct, usd } from "../ui/format";

export function Results({
  ctx,
  snapshot,
  result,
  activeLabel,
}: {
  ctx: EngineContext;
  snapshot: Snapshot;
  result: RebalanceResult | null;
  activeLabel: string;
}) {
  if (!result)
    return (
      <section className="panel p-5 text-muted text-sm">
        Pick a preset, set manual controls, or describe an objective to see a proposal.
      </section>
    );

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-lg">Proposal</h2>
        <span className="text-xs text-faint">objective: <span className="text-muted">{activeLabel}</span></span>
      </div>

      {!result.feasible && result.relaxation_proposal && (
        <section className="panel p-4 sm:p-5 border-warn/40 fade-in" key={activeLabel + "-infeasible"}>
          <h3 className="text-warn font-semibold text-sm mb-2">
            Constraint set infeasible — relaxation proposal
          </h3>
          <div className="grid sm:grid-cols-3 gap-3 text-sm mb-3">
            <div>
              <div className="label mb-1">binding constraint</div>
              <div className="num">{result.relaxation_proposal.binding_constraint}</div>
            </div>
            <div>
              <div className="label mb-1">requested limit</div>
              <div className="num">{result.relaxation_proposal.current_limit}</div>
            </div>
            <div>
              <div className="label mb-1">best achievable</div>
              <div className="num">{result.relaxation_proposal.achievable_value}</div>
            </div>
          </div>
          <p className="text-sm text-muted leading-relaxed">{result.relaxation_proposal.suggestion}</p>
          <p className="text-xs text-faint mt-2">No trades proposed — the desk never forces a bad trade.</p>
        </section>
      )}

      {result.feasible && (
        <>
          <Trades result={result} key={activeLabel + "-trades"} />
          <Metrics result={result} />
          <Sectors result={result} benchmark={snapshot.benchmark} />
          <Factors result={result} />
          <Tax result={result} />
          <Compliance result={result} />
          <Execution result={result} snapshot={snapshot} />
        </>
      )}

      <section className="panel p-4 sm:p-5 fade-in">
        <h3 className="label mb-2">client note</h3>
        <p className="text-sm leading-relaxed text-ink/90">{result.one_paragraph_rationale}</p>
      </section>
    </div>
  );
}

function Trades({ result }: { result: RebalanceResult }) {
  if (!result.proposed_trades.length)
    return (
      <section className="panel p-4 text-sm text-muted fade-in">
        Portfolio already satisfies the objective — no trades proposed.
      </section>
    );
  return (
    <section className="panel p-4 sm:p-5 fade-in">
      <h3 className="label mb-3">proposed trades · {result.proposed_trades.length}</h3>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="label text-left">
              <th className="pb-2 pr-3 font-semibold">action</th>
              <th className="pb-2 pr-3 font-semibold text-right">shares</th>
              <th className="pb-2 pr-3 font-semibold text-right">notional</th>
              <th className="pb-2 pr-3 font-semibold text-right">Δ weight</th>
              <th className="pb-2 font-semibold">rationale</th>
            </tr>
          </thead>
          <tbody>
            {result.proposed_trades.map((t) => (
              <tr key={t.ticker} className="border-t border-edge align-top">
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className={`num font-semibold ${t.action === "BUY" ? "text-up" : "text-down"}`}>
                    {t.action}
                  </span>{" "}
                  <span className="num">{t.ticker}</span>
                </td>
                <td className="num py-2 pr-3 text-right">{t.share_count.toLocaleString()}</td>
                <td className="num py-2 pr-3 text-right">{usd(t.notional_usd)}</td>
                <td className={`num py-2 pr-3 text-right ${t.percent_of_portfolio_delta >= 0 ? "text-up" : "text-down"}`}>
                  {signedPct(t.percent_of_portfolio_delta)}
                </td>
                <td className="py-2 text-xs text-muted leading-relaxed min-w-[180px]">{t.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metrics({ result }: { result: RebalanceResult }) {
  const { pre, post } = result.pre_post_metrics;
  const rows: { label: string; pre: number; post: number; fmt: (x: number) => string; lower: boolean; note?: string }[] = [
    { label: "expected return*", pre: pre.expected_return, post: post.expected_return, fmt: (x) => pct(x), lower: false },
    { label: "volatility (ann.)", pre: pre.volatility, post: post.volatility, fmt: (x) => pct(x), lower: true },
    { label: "sharpe*", pre: pre.sharpe, post: post.sharpe, fmt: (x) => x.toFixed(2), lower: false },
    { label: "sortino*", pre: pre.sortino, post: post.sortino, fmt: (x) => x.toFixed(2), lower: false },
    { label: "max drawdown (hist.)", pre: pre.max_drawdown_estimate, post: post.max_drawdown_estimate, fmt: (x) => pct(x), lower: false },
    { label: "tracking error", pre: pre.tracking_error, post: post.tracking_error, fmt: (x) => pct(x), lower: true },
    { label: "beta vs SPY", pre: pre.beta, post: post.beta, fmt: (x) => x.toFixed(2), lower: true },
    { label: "top-5 concentration", pre: pre.concentration_top5, post: post.concentration_top5, fmt: (x) => pct(x), lower: true },
  ];
  return (
    <section className="panel p-4 sm:p-5 fade-in">
      <h3 className="label mb-3">pre / post metrics</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-4">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <div className="label mb-1 normal-case tracking-normal">{r.label}</div>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="num text-muted text-sm">{r.fmt(r.pre)}</span>
              <span className="text-faint text-xs">→</span>
              <CountUp value={r.post} format={r.fmt} className={`text-sm font-medium ${deltaColor(r.post - r.pre, r.lower)}`} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-faint mt-4">
        *CAPM-derived (labeled assumption: 4.5% ERP). Max drawdown is the historical drawdown of the
        weighted portfolio over the real 250-day window — an estimate, not a forecast.
      </p>
    </section>
  );
}

function Sectors({ result, benchmark }: { result: RebalanceResult; benchmark: string }) {
  const rows = result.sector_exposures_pre_post.filter((s) => s.pre > 0.001 || s.post > 0.001 || s.benchmark > 0.001);
  const max = Math.max(...rows.map((r) => Math.max(r.pre, r.post, r.benchmark)), 0.01);
  return (
    <section className="panel p-4 sm:p-5 fade-in">
      <h3 className="label mb-1">sector exposure · pre / post vs benchmark</h3>
      <p className="text-[11px] text-faint mb-4">
        Benchmark sector weights are a cap-weighted proxy over the 12-name universe (labeled
        assumption — {benchmark} holdings are not in the snapshot).
      </p>
      <div className="space-y-3">
        {rows.map((s) => (
          <div key={s.sector}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted">{s.sector}</span>
              <span className="num text-faint">
                {pct(s.pre)} → <span className={deltaColor(Math.abs(s.post - s.benchmark) - Math.abs(s.pre - s.benchmark), true)}>{pct(s.post)}</span>
                <span className="ml-2 text-faint">bm {pct(s.benchmark)}</span>
              </span>
            </div>
            <div className="relative h-4">
              <div className="absolute inset-0 bg-panel2 rounded-sm" />
              <div className="bar absolute top-0 h-1.5 bg-edge2 rounded-sm" style={{ width: `${(s.pre / max) * 100}%` }} />
              <div className="bar absolute bottom-0 h-1.5 bg-accent rounded-sm" style={{ width: `${(s.post / max) * 100}%` }} />
              <div className="absolute top-0 bottom-0 w-px bg-warn/70" style={{ left: `${(s.benchmark / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-3 text-[11px] text-faint">
        <span><span className="inline-block w-3 h-1.5 bg-edge2 rounded-sm mr-1 align-middle" />pre</span>
        <span><span className="inline-block w-3 h-1.5 bg-accent rounded-sm mr-1 align-middle" />post</span>
        <span><span className="inline-block w-px h-3 bg-warn/70 mr-1 align-middle" />benchmark proxy</span>
      </div>
    </section>
  );
}

const FACTOR_LABELS: Record<string, string> = {
  growth: "growth",
  value: "value",
  momentum: "momentum",
  quality: "quality",
  low_vol: "low-vol",
  size: "size (large-cap)",
};

function Factors({ result }: { result: RebalanceResult }) {
  const range = 1.2;
  const toPos = (z: number) => `${Math.min(100, Math.max(0, ((z + range) / (2 * range)) * 100))}%`;
  return (
    <section className="panel p-4 sm:p-5 fade-in">
      <h3 className="label mb-1">factor tilts · portfolio z-score exposure</h3>
      <p className="text-[11px] text-faint mb-4">
        Characteristic proxies from real SEC XBRL inputs and price history — definitions in the
        methodology section below.
      </p>
      <div className="space-y-3">
        {result.factor_exposures.map((f) => (
          <div key={f.factor} className="flex items-center gap-3">
            <span className="text-xs text-muted w-28 shrink-0">{FACTOR_LABELS[f.factor]}</span>
            <div className="relative h-4 flex-1">
              <div className="absolute inset-0 bg-panel2 rounded-sm" />
              <div className="absolute top-0 bottom-0 w-px bg-edge2" style={{ left: "50%" }} />
              <div className="bar absolute top-[3px] w-2 h-2 rounded-full bg-edge2 -translate-x-1/2 transition-all duration-500" style={{ left: toPos(f.pre) }} />
              <div className="bar absolute bottom-[3px] w-2 h-2 rounded-full bg-accent -translate-x-1/2 transition-all duration-500" style={{ left: toPos(f.post) }} />
            </div>
            <span className="num text-xs text-faint w-24 text-right shrink-0">
              {f.pre.toFixed(2)} → <span className="text-ink">{f.post.toFixed(2)}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Tax({ result }: { result: RebalanceResult }) {
  const t = result.tax_impact_estimate;
  return (
    <section className="panel p-4 sm:p-5 fade-in">
      <h3 className="label mb-3">tax impact estimate · from illustrative lots</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-3">
        <div>
          <div className="label mb-1 normal-case tracking-normal">net realized</div>
          <span className={`num font-medium ${t.total_realized_gain_usd <= 0 ? "text-up" : "text-warn"}`}>
            {usd(t.total_realized_gain_usd)}
          </span>
        </div>
        <div>
          <div className="label mb-1 normal-case tracking-normal">short-term</div>
          <span className="num">{usd(t.short_term_gain_usd)}</span>
        </div>
        <div>
          <div className="label mb-1 normal-case tracking-normal">long-term</div>
          <span className="num">{usd(t.long_term_gain_usd)}</span>
        </div>
        <div>
          <div className="label mb-1 normal-case tracking-normal">wash-sale flags</div>
          <span className={`num ${t.wash_sale_flags ? "text-warn" : "text-up"}`}>{t.wash_sale_flags}</span>
        </div>
      </div>
      {t.lots.length > 0 && (
        <details className="text-xs">
          <summary className="text-faint cursor-pointer">lot-level detail ({t.lots.length} lots, HIFO relief)</summary>
          <table className="w-full mt-2 min-w-[420px]">
            <thead>
              <tr className="label text-left">
                <th className="pb-1 pr-2 font-semibold">lot</th>
                <th className="pb-1 pr-2 font-semibold text-right">sold</th>
                <th className="pb-1 pr-2 font-semibold text-right">proceeds</th>
                <th className="pb-1 pr-2 font-semibold text-right">gain/loss</th>
                <th className="pb-1 pr-2 font-semibold">term</th>
                <th className="pb-1 font-semibold">wash-sale</th>
              </tr>
            </thead>
            <tbody>
              {t.lots.map((l) => (
                <tr key={`${l.lot_id}-${l.shares_sold}`} className="border-t border-edge">
                  <td className="num py-1 pr-2">{l.lot_id}</td>
                  <td className="num py-1 pr-2 text-right">{l.shares_sold}</td>
                  <td className="num py-1 pr-2 text-right">{usd(l.proceeds_usd)}</td>
                  <td className={`num py-1 pr-2 text-right ${l.realized_gain_usd >= 0 ? "text-up" : "text-down"}`}>
                    {usd(l.realized_gain_usd)}
                  </td>
                  <td className="py-1 pr-2">{l.term}</td>
                  <td className={`py-1 ${l.wash_sale_risk ? "text-warn" : "text-faint"}`}>
                    {l.wash_sale_risk ? `⚠ ${l.wash_sale_reason}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <p className="text-[11px] text-faint mt-3">
        Deterministic from the editable lots and proposed sells. Cost-basis lots are illustrative;
        wash-sale flag = loss sale of shares acquired within the last 30 days.
      </p>
    </section>
  );
}

function Compliance({ result }: { result: RebalanceResult }) {
  if (!result.constraint_compliance_check.length) return null;
  const dot = (s: string) =>
    s === "ok" ? "bg-up" : s === "near-bound" ? "bg-warn" : "bg-down";
  return (
    <section className="panel p-4 sm:p-5 fade-in">
      <h3 className="label mb-3">constraint compliance · with buffers</h3>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs min-w-[440px]">
          <thead>
            <tr className="label text-left">
              <th className="pb-2 pr-3 font-semibold">constraint</th>
              <th className="pb-2 pr-3 font-semibold text-right">limit</th>
              <th className="pb-2 pr-3 font-semibold text-right">achieved</th>
              <th className="pb-2 pr-3 font-semibold text-right">buffer</th>
              <th className="pb-2 font-semibold">status</th>
            </tr>
          </thead>
          <tbody>
            {result.constraint_compliance_check.map((c) => (
              <tr key={c.constraint} className="border-t border-edge">
                <td className="py-1.5 pr-3 text-muted">{c.constraint}</td>
                <td className="num py-1.5 pr-3 text-right">{c.limit}</td>
                <td className="num py-1.5 pr-3 text-right">{c.achieved}</td>
                <td className="num py-1.5 pr-3 text-right">{c.buffer}</td>
                <td className="py-1.5">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${dot(c.status)}`} />
                  <span className={c.status === "ok" ? "text-muted" : c.status === "near-bound" ? "text-warn" : "text-down"}>
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Execution({ result, snapshot }: { result: RebalanceResult; snapshot: Snapshot }) {
  if (!result.execution_notes.length) return null;
  return (
    <section className="panel p-4 sm:p-5 fade-in">
      <h3 className="label mb-3">execution notes · sells first, liquidity-aware</h3>
      <div className="space-y-2">
        {result.execution_notes.map((n) => (
          <div key={`${n.sequence}-${n.ticker}`} className="flex items-start gap-3 text-xs">
            <span className="num text-faint w-5 shrink-0 pt-0.5">{n.sequence}.</span>
            <div className="min-w-0">
              <span className="num font-medium">{n.ticker}</span>
              <span className={`ml-2 ${n.liquidity_flag ? "text-warn" : "text-muted"}`}>{n.note}</span>
              <span className="block text-faint mt-0.5">
                order type: {n.order_type}
                {snapshot.tickers[n.ticker].adv_dollar?.value != null && (
                  <>
                    {" "}· 20d ADV ${(snapshot.tickers[n.ticker].adv_dollar!.value! / 1e6).toFixed(0)}M (
                    {snapshot.tickers[n.ticker].adv_dollar!.as_of})
                  </>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
