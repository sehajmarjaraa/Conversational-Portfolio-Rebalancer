# rebalance-desk

A fiduciary portfolio rebalancing tool that loads a real-ticker portfolio with real market data,
computes risk analytics from real return history, and proposes constraint-aware trades that
revalue live — entirely in the browser, with no backend and no API key.

```
npm install && npm run dev
```

First load shows the demo portfolio with real, dated metrics and one preset objective already
applied — no key, no network (the market snapshot is committed).

## What's real, what's assumed

**Real, traceable, dated** (see the provenance panel in the app — every figure shows its source
and as-of date):

| Data | Source |
|---|---|
| Daily close history (~250 sessions) + volume, 12 tickers + SPY | Yahoo Finance chart API (default keyless provider; FMP/Finnhub supported with a key) |
| Shares outstanding, net income, stockholders' equity, revenue, operating income, diluted EPS, revenue growth | SEC EDGAR XBRL `companyfacts` (tag + form + accession recorded per figure) |
| SIC code / industry | SEC EDGAR `submissions` |
| Risk-free rate | FRED DGS10 (10-Year Treasury constant maturity) |
| Market cap, P/E, P/B, ROE, operating margin, 20-day avg dollar volume | Computed in ingest from the above (formula recorded in the `source` field) |

**Labeled assumptions** (also called out in the UI):

- **Equity risk premium = 4.5%** — expected return is CAPM (rf + β·ERP); Sharpe/Sortino numerators
  derive from it. Forward-looking by construction.
- **Factor proxies** — growth = FY revenue growth YoY; value = mean z(1/P-E, 1/P-B);
  momentum = 12-1 month price return; quality = mean z(ROE, operating margin);
  low-vol = −z(realized σ); size = z(log market cap). Cross-sectional z-scores over the 12-name
  universe. Missing inputs (e.g. JPM/XOM don't report `OperatingIncomeLoss`) score neutral 0 —
  never invented.
- **Benchmark sector weights** — cap-weighted proxy over the 12-name universe (SPY holdings are
  not ingested).
- **SIC → GICS-style sector mapping** — deterministic convention in `ingest/sic-map.ts`; the SIC
  code itself is from SEC EDGAR.
- **Fixed-weight history** — pre/post max drawdown and tracking error apply today's weights to the
  historical window.
- **Cost-basis lots are illustrative** (cost basis is private) and fully editable in the UI.
- **Whole-share trades** — targets are rounded to whole shares; cash absorbs the residual.
  Compliance checks allow 20bp of rounding drift.

**Integrity rule:** the ingest never fabricates a market or company number. If a source is
unreachable, the field is committed as `null` with the source string
`"unavailable at ingest time"`, the warning is recorded in `snapshot.warnings`, and the UI renders
it as unavailable.

## Architecture

```
ingest/ingest.ts        npm run ingest → public/market/snapshot.json (committed, dated, sourced)
ingest/sic-map.ts       SIC → GICS-style sector convention
src/engine/stats.ts     returns alignment, covariance/correlation, vol, beta, TE, drawdown, Sortino
src/engine/factors.ts   six characteristic factor z-scores from real inputs
src/engine/optimizer.ts constrained mean-variance optimizer (see Method) + infeasibility detection
src/engine/engine.ts    trades, tax lots (HIFO), wash-sale flags, compliance, execution notes
src/engine/spec.ts      OptimizationSpec schema validation + clamping (applied to ALL spec sources)
src/engine/presets.ts   5 committed preset objectives (zero API calls)
src/llm/anthropic.ts    NL mode: visitor's key, schema-constrained spec translation + client note
src/components/…        UI (hero, portfolio editor, controls, results, methodology, footer)
scripts/engine-test.ts  headless engine smoke test: npx tsx scripts/engine-test.ts
```

### Optimization method (stated)

Projected gradient descent on the mean-variance objective with an **exact projection onto the
box-and-simplex set** ({lb ≤ w ≤ ub, Σw ∈ [investMin, investMax]} via bisection on the simplex
Lagrange multiplier) and **quadratic exterior penalties** for sector caps, factor bounds, turnover,
and the tax budget, escalated over 8 outer rounds (×10 each, 400 inner steps). Deterministic:
initialized at current weights, fixed iteration counts, no randomness. Objectives: minimize
volatility, maximize Sharpe (CAPM), target a volatility level, minimize tracking error, harvest
losses (TE-anchored with a loss-name pressure term). Infeasible constraint sets are caught by
analytic capacity pre-checks and a post-solve violation audit and returned as a
`constraint_relaxation_proposal` naming the binding constraint — no trade is ever forced.

### The LLM boundary

The LLM is used for exactly two things, both on the **visitor's own Anthropic key**
(`claude-opus-4-8`, structured output via `output_config.format` JSON schema, validated and
clamped client-side with one retry):

1. translating a natural-language objective into the same `OptimizationSpec` the presets use;
2. optionally rewriting the one-paragraph client note, grounded **only** in engine-computed
   numbers passed to it.

It never selects trades and never computes a metric. The key lives in React state only — never
localStorage, never sent anywhere except `api.anthropic.com`. Presets and manual controls are
fully usable with no key. Note on "temperature 0": current Anthropic models (Opus 4.7+) removed
sampling parameters from the API entirely, so none are sent; the JSON-schema constraint plus
client-side clamping provide the determinism the translation step needs.

## Re-running the ingest

```
SEC_USER_AGENT="your-name your-email@example.com" npm run ingest
```

- `SEC_USER_AGENT` — please set your own contact per SEC fair-access policy (a default is
  provided). Requests are throttled to well under 10/s.
- `PRICE_PROVIDER=yahoo|fmp|finnhub` — `yahoo` (default) needs no key;
  `fmp` needs `FMP_API_KEY`; `finnhub` needs `FINNHUB_API_KEY`. All free tiers.
- FRED occasionally returns 504; the fetch retries with backoff.

The committed snapshot was generated on **2026-06-09** (prices as of 2026-06-09 close-to-date,
DGS10 4.56% as of 2026-06-08, fundamentals from each issuer's latest 10-K/10-Q as dated per field).

## Deploying (all free, static `dist/`)

`npm run build` → `dist/`. The Vite `base` is relative (`./`), so the build works on all four
hosts with no per-host config:

- **Vercel** — import the repo; framework preset Vite (build `npm run build`, output `dist`).
- **Cloudflare Pages** — build command `npm run build`, output directory `dist`.
- **GitHub Pages** — publish `dist/` (e.g. `actions/deploy-pages` or push `dist` to `gh-pages`);
  the relative base handles the `/repo-name/` subpath.
- **Hugging Face Spaces (static)** — create a static Space and upload the contents of `dist/`.

No environment variables are needed in deployment — the snapshot is committed and the only API
call (NL mode) uses the visitor's pasted key from the browser.

## Disclaimer

Research and educational demonstration using public market data and SEC filings as of the stated
dates. Not investment advice; not a recommendation on any security or portfolio. Holdings and
cost-basis lots are illustrative.
