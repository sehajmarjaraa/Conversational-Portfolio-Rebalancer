import { useState } from "react";
import type { MetricSet, ObjectiveType, OptimizationSpec, Portfolio } from "../types";
import type { EngineContext } from "../engine/engine";
import { PRESETS } from "../engine/presets";
import { validateAndClampSpec } from "../engine/spec";
import { translateObjective, writeRationale } from "../llm/anthropic";
import { pct } from "../ui/format";

interface Current {
  metrics: MetricSet;
  benchSectors: Record<string, number>;
  value: number;
  weights: number[];
}

type Mode = "presets" | "manual" | "language";

export function Controls({
  ctx,
  current,
  portfolio,
  onRun,
  activeLabel,
}: {
  ctx: EngineContext;
  current: Current;
  portfolio: Portfolio;
  onRun: (spec: OptimizationSpec, label: string, nlRationale?: (r: any) => Promise<string>) => void;
  activeLabel: string;
}) {
  const [mode, setMode] = useState<Mode>("presets");

  return (
    <section className="panel p-4 sm:p-5">
      <h2 className="font-semibold mb-3">Objective</h2>
      <div className="flex gap-1 mb-4 bg-panel2 rounded-md p-1 w-fit">
        {(
          [
            ["presets", "Presets"],
            ["manual", "Manual"],
            ["language", "Natural language"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              mode === m ? "bg-edge2 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "presets" && <Presets ctx={ctx} current={current} onRun={onRun} activeLabel={activeLabel} />}
      {mode === "manual" && <Manual current={current} onRun={onRun} />}
      {mode === "language" && <Language ctx={ctx} current={current} portfolio={portfolio} onRun={onRun} />}
    </section>
  );
}

// ---------- 1. presets: zero API calls ----------

function Presets({
  ctx,
  current,
  onRun,
  activeLabel,
}: {
  ctx: EngineContext;
  current: Current;
  onRun: (spec: OptimizationSpec, label: string) => void;
  activeLabel: string;
}) {
  return (
    <div className="space-y-2">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          onClick={() =>
            onRun(
              p.build(current.metrics, current.benchSectors["Information Technology"] ?? 0),
              p.title
            )
          }
          className={`w-full text-left rounded-md border px-3.5 py-2.5 transition-colors ${
            activeLabel === p.title
              ? "border-accent bg-panel2"
              : "border-edge hover:border-edge2 hover:bg-panel2"
          }`}
        >
          <div className="text-sm font-medium">{p.title}</div>
          <div className="text-xs text-faint mt-0.5">{p.blurb}</div>
        </button>
      ))}
      <p className="text-[11px] text-faint pt-1">
        Presets run the in-browser optimizer instantly — zero API calls.
      </p>
    </div>
  );
}

// ---------- 2. manual controls: zero API calls ----------

function Manual({
  current,
  onRun,
}: {
  current: Current;
  onRun: (spec: OptimizationSpec, label: string) => void;
}) {
  const [objective, setObjective] = useState<ObjectiveType>("minimize_volatility");
  const [targetVol, setTargetVol] = useState(Math.round(current.metrics.volatility * 0.85 * 100));
  const [maxPos, setMaxPos] = useState(12);
  const [techCap, setTechCap] = useState<number | null>(null);
  const [qualityMin, setQualityMin] = useState<number | null>(null);
  const [lowVolMin, setLowVolMin] = useState<number | null>(null);
  const [cashMax, setCashMax] = useState(15);
  const [turnover, setTurnover] = useState(40);
  const [taxBudget, setTaxBudget] = useState<number | null>(null);
  const [avoidWash, setAvoidWash] = useState(false);

  const build = (): OptimizationSpec => {
    const raw = {
      objective: {
        type: objective,
        target_volatility: objective === "target_volatility" ? targetVol / 100 : undefined,
      },
      constraints: {
        long_only: true,
        max_position_weight: maxPos / 100,
        sector_caps: techCap != null ? { "Information Technology": techCap / 100 } : undefined,
        factor_bounds:
          qualityMin != null || lowVolMin != null
            ? {
                ...(qualityMin != null ? { quality: { min: qualityMin } } : {}),
                ...(lowVolMin != null ? { low_vol: { min: lowVolMin } } : {}),
              }
            : undefined,
        cash_weight: { min: 0.01, max: cashMax / 100 },
        max_turnover: turnover / 100,
        max_realized_gains_usd: taxBudget ?? undefined,
        avoid_wash_sale: avoidWash || undefined,
      },
    };
    return validateAndClampSpec(raw).spec!;
  };

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-muted shrink-0">{label}</span>
      {children}
    </div>
  );

  return (
    <div className="text-sm">
      <Row label="objective">
        <select value={objective} onChange={(e) => setObjective(e.target.value as ObjectiveType)}>
          <option value="minimize_volatility">minimize volatility</option>
          <option value="maximize_sharpe">maximize Sharpe (CAPM)</option>
          <option value="target_volatility">target a volatility level</option>
          <option value="minimize_tracking_error">minimize tracking error</option>
          <option value="harvest_losses">harvest losses</option>
        </select>
      </Row>
      {objective === "target_volatility" && (
        <Row label={`target vol ${targetVol}%`}>
          <input
            type="range"
            min={5}
            max={30}
            value={targetVol}
            onChange={(e) => setTargetVol(+e.target.value)}
            className="w-40"
          />
        </Row>
      )}
      <Row label={`max position ${maxPos}%`}>
        <input type="range" min={5} max={30} value={maxPos} onChange={(e) => setMaxPos(+e.target.value)} className="w-40" />
      </Row>
      <Row label={techCap == null ? "tech sector cap: off" : `tech sector cap ${techCap}%`}>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={techCap != null}
            onChange={(e) => setTechCap(e.target.checked ? 35 : null)}
          />
          {techCap != null && (
            <input type="range" min={10} max={60} value={techCap} onChange={(e) => setTechCap(+e.target.value)} className="w-28" />
          )}
        </div>
      </Row>
      <Row label={qualityMin == null ? "quality tilt: off" : `quality tilt ≥ ${qualityMin.toFixed(1)}σ`}>
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={qualityMin != null} onChange={(e) => setQualityMin(e.target.checked ? 0.2 : null)} />
          {qualityMin != null && (
            <input type="range" min={0} max={8} value={qualityMin * 10} onChange={(e) => setQualityMin(+e.target.value / 10)} className="w-28" />
          )}
        </div>
      </Row>
      <Row label={lowVolMin == null ? "low-vol tilt: off" : `low-vol tilt ≥ ${lowVolMin.toFixed(1)}σ`}>
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={lowVolMin != null} onChange={(e) => setLowVolMin(e.target.checked ? 0.2 : null)} />
          {lowVolMin != null && (
            <input type="range" min={0} max={8} value={lowVolMin * 10} onChange={(e) => setLowVolMin(+e.target.value / 10)} className="w-28" />
          )}
        </div>
      </Row>
      <Row label={`max cash ${cashMax}%`}>
        <input type="range" min={2} max={40} value={cashMax} onChange={(e) => setCashMax(+e.target.value)} className="w-40" />
      </Row>
      <Row label={`max turnover ${turnover}%`}>
        <input type="range" min={5} max={100} value={turnover} onChange={(e) => setTurnover(+e.target.value)} className="w-40" />
      </Row>
      <Row label={taxBudget == null ? "tax budget: off" : `realized gains ≤ $${taxBudget.toLocaleString()}`}>
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={taxBudget != null} onChange={(e) => setTaxBudget(e.target.checked ? 10000 : null)} />
          {taxBudget != null && (
            <input type="range" min={0} max={100000} step={2500} value={taxBudget} onChange={(e) => setTaxBudget(+e.target.value)} className="w-28" />
          )}
        </div>
      </Row>
      <Row label="avoid wash-sale risk">
        <input type="checkbox" checked={avoidWash} onChange={(e) => setAvoidWash(e.target.checked)} />
      </Row>

      <button
        onClick={() => onRun(build(), "Manual spec")}
        className="mt-3 w-full bg-accent text-bg font-semibold text-sm py-2.5 rounded-md hover:opacity-90 transition-opacity"
      >
        Run optimizer
      </button>
      <p className="text-[11px] text-faint mt-2">
        Runs instantly in the browser — zero API calls, fully usable with no key.
      </p>
    </div>
  );
}

// ---------- 3. natural language: visitor's own Anthropic key ----------

function Language({
  ctx,
  current,
  portfolio,
  onRun,
}: {
  ctx: EngineContext;
  current: Current;
  portfolio: Portfolio;
  onRun: (spec: OptimizationSpec, label: string, nlRationale?: (r: any) => Promise<string>) => void;
}) {
  const [key, setKey] = useState("");
  const [text, setText] = useState(
    "Cut my volatility by about 15% without selling anything at a big gain, keep tech under 40%, and stay diversified."
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [specPreview, setSpecPreview] = useState<string | null>(null);

  const portfolioSummary = ctx.model.tickers
    .map((t, i) => `${t}: ${pct(current.weights[i])}`)
    .join(", ");
  const marketSummary =
    `Universe: ${ctx.model.tickers.join(", ")}. Benchmark ${"SPY"}. ` +
    `Current portfolio volatility ${pct(current.metrics.volatility)}, beta ${current.metrics.beta.toFixed(2)}, ` +
    `tracking error ${pct(current.metrics.tracking_error)}. ` +
    `Benchmark-proxy sector weights: ${Object.entries(current.benchSectors)
      .map(([s, w]) => `${s} ${pct(w)}`)
      .join(", ")}. Risk-free rate ${pct(ctx.model.riskFree, 2)}.`;

  const go = async () => {
    setBusy(true);
    setError(null);
    setSpecPreview(null);
    try {
      const { spec } = await translateObjective(key, text, portfolioSummary, marketSummary);
      setSpecPreview(JSON.stringify(spec, null, 2));
      onRun(spec, `“${text.length > 60 ? text.slice(0, 57) + "…" : text}”`, (result) =>
        writeRationale(key, text, result)
      );
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <textarea
        rows={3}
        className="w-full resize-y"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Describe your objective and constraints in plain English…"
      />
      <input
        type="password"
        className="w-full"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Anthropic API key (sk-ant-…)"
        autoComplete="off"
      />
      <button
        onClick={go}
        disabled={busy || !key || !text.trim()}
        className="w-full bg-accent text-bg font-semibold text-sm py-2.5 rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "Translating objective…" : "Translate & optimize"}
      </button>
      {error && <p className="text-down text-xs">{error}</p>}
      {specPreview && (
        <details className="text-xs" open>
          <summary className="text-faint cursor-pointer">Structured spec the model produced</summary>
          <pre className="num bg-panel2 border border-edge rounded-md p-2 mt-1 overflow-x-auto text-[11px] leading-relaxed">
            {specPreview}
          </pre>
        </details>
      )}
      <p className="text-[11px] text-faint leading-relaxed">
        Your key stays in React state only — never written to localStorage or cookies, sent nowhere
        except <span className="num">api.anthropic.com</span> directly from your browser. The model
        only translates your words into the spec above and writes the client note; every number is
        computed by the deterministic engine. Presets and manual mode work with no key at all.
      </p>
    </div>
  );
}
