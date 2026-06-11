import { useEffect, useMemo, useState } from "react";
import type { OptimizationSpec, Portfolio, RebalanceResult, Snapshot } from "./types";
import { DEMO_PORTFOLIO } from "./data/portfolio";
import {
  benchmarkSectorProxy,
  buildContext,
  computeMetrics,
  currentWeights,
  portfolioValue,
  runRebalance,
  type EngineContext,
} from "./engine/engine";
import { PRESETS } from "./engine/presets";
import { Hero } from "./components/Hero";
import { PortfolioPanel } from "./components/PortfolioPanel";
import { Controls } from "./components/Controls";
import { Results } from "./components/Results";
import { Methodology } from "./components/Methodology";
import { HowItWorks } from "./components/HowItWorks";
import { Footer } from "./components/Footer";

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio>(() =>
    JSON.parse(JSON.stringify(DEMO_PORTFOLIO))
  );
  const [result, setResult] = useState<RebalanceResult | null>(null);
  const [activeLabel, setActiveLabel] = useState<string>("");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}market/snapshot.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setSnapshot)
      .catch((e) => setLoadError(String(e)));
  }, []);

  const ctx: EngineContext | null = useMemo(
    () => (snapshot ? buildContext(snapshot) : null),
    [snapshot]
  );

  const current = useMemo(() => {
    if (!ctx) return null;
    const w = currentWeights(portfolio, ctx.model);
    return {
      weights: w,
      value: portfolioValue(portfolio, ctx.model),
      metrics: computeMetrics(w, ctx),
      benchSectors: benchmarkSectorProxy(ctx),
    };
  }, [ctx, portfolio]);

  const run = (
    spec: OptimizationSpec,
    label: string,
    nlRationale?: (r: RebalanceResult) => Promise<string>
  ) => {
    if (!ctx) return;
    const r = runRebalance(spec, portfolio, ctx);
    setResult(r);
    setActiveLabel(label);
    // NL mode may rewrite the client paragraph from the engine's numbers;
    // failures fall back silently to the deterministic paragraph.
    if (nlRationale && r.feasible) {
      nlRationale(r)
        .then((p) => setResult((prev) => (prev === r ? { ...r, one_paragraph_rationale: p } : prev)))
        .catch(() => {});
    }
  };

  // first load: apply the first preset so a pre→post improvement is visible immediately
  useEffect(() => {
    if (ctx && current && !result) {
      const p = PRESETS[0];
      run(
        p.build(current.metrics, current.benchSectors["Information Technology"] ?? 0),
        p.title
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (loadError)
    return (
      <div className="min-h-screen flex items-center justify-center p-8 text-center">
        <div>
          <p className="text-down font-semibold mb-2">Failed to load market snapshot</p>
          <p className="text-muted text-sm">
            {loadError}. Run <code className="num">npm run ingest</code> to generate{" "}
            <code className="num">public/market/snapshot.json</code>.
          </p>
        </div>
      </div>
    );

  if (!snapshot || !ctx || !current)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted text-sm animate-pulse">loading market snapshot…</p>
      </div>
    );

  return (
    <div className="min-h-screen">
      <Hero snapshot={snapshot} ctx={ctx} current={current} result={result} />

      <main id="tool" className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
          <div className="space-y-5">
            <PortfolioPanel
              ctx={ctx}
              snapshot={snapshot}
              portfolio={portfolio}
              setPortfolio={setPortfolio}
              totalValue={current.value}
            />
            <Controls ctx={ctx} current={current} portfolio={portfolio} onRun={run} activeLabel={activeLabel} />
          </div>
          <Results ctx={ctx} snapshot={snapshot} result={result} activeLabel={activeLabel} />
        </div>

        <Methodology snapshot={snapshot} ctx={ctx} />
        <HowItWorks />
      </main>

      <Footer snapshot={snapshot} />
    </div>
  );
}
