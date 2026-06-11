/**
 * rebalance-desk data ingest
 * --------------------------
 * Fetches REAL market data once, on the owner's machine, and commits the
 * result to /public/market/snapshot.json so the deployed static site needs
 * no API keys and no network.
 *
 * Sources (all free):
 *   - Daily close history + volume: configurable provider via PRICE_PROVIDER
 *       "yahoo"   (default, keyless)  Yahoo Finance chart API
 *       "fmp"     Financial Modeling Prep, key in FMP_API_KEY
 *       "finnhub" Finnhub, key in FINNHUB_API_KEY
 *   - Shares outstanding, fundamentals (net income, equity, revenue,
 *     operating income, diluted EPS): SEC EDGAR XBRL companyfacts
 *   - SIC code / industry: SEC EDGAR submissions
 *   - Risk-free rate: FRED DGS10 (10-Year Treasury constant maturity)
 *
 * INTEGRITY RULE: this script never fabricates a number. If a source is
 * unreachable, the field is written as null with a warning, and the UI
 * renders it as unavailable.
 *
 * Usage:  npm run ingest
 * Env:    SEC_USER_AGENT="your-name your-email"   (please set your own)
 *         PRICE_PROVIDER=yahoo|fmp|finnhub
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sicToSector } from "./sic-map.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../public/market/snapshot.json");

const TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "JPM", "UNH", "JNJ", "XOM", "PG", "HD", "CAT"];
const BENCHMARK = "SPY";
const HISTORY_DAYS = 250; // ~1 trading year
const ADV_WINDOW = 20;

const SEC_USER_AGENT = process.env.SEC_USER_AGENT ?? "rebalance-desk-demo contact@example.com";
const PRICE_PROVIDER = (process.env.PRICE_PROVIDER ?? "yahoo") as "yahoo" | "fmp" | "finnhub";

// ---------- helpers ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url: string, headers: Record<string, string> = {}, retries = 3): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (no retry)`);
      return await res.json();
    } catch (e: any) {
      if (i === retries || String(e.message).includes("no retry")) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function getText(url: string, headers: Record<string, string> = {}, retries = 4): Promise<string> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers }).catch((e) => {
      if (i === retries) throw e;
      return null;
    });
    if (res?.ok) return res.text();
    if (i === retries) throw new Error(`HTTP ${res?.status} for ${url}`);
    await sleep(2000 * (i + 1)); // FRED in particular 504s intermittently
  }
}

type Sourced<T> = { value: T | null; as_of: string | null; source: string };

const today = new Date().toISOString().slice(0, 10);

// ---------- price providers ----------

interface PriceHistory {
  dates: string[];
  closes: number[];
  volumes: number[];
  source: string;
  as_of: string;
}

async function fetchPricesYahoo(ticker: string): Promise<PriceHistory> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d&events=div%2Csplit`;
  const j = await getJSON(url, { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
  const r = j.chart.result[0];
  const ts: number[] = r.timestamp;
  const q = r.indicators.quote[0];
  const dates: string[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null) continue;
    dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
    closes.push(q.close[i]);
    volumes.push(q.volume[i] ?? 0);
  }
  const cut = Math.max(0, dates.length - HISTORY_DAYS);
  return {
    dates: dates.slice(cut),
    closes: closes.slice(cut),
    volumes: volumes.slice(cut),
    source: "Yahoo Finance chart API (query2.finance.yahoo.com), daily close",
    as_of: dates[dates.length - 1] ?? today,
  };
}

async function fetchPricesFMP(ticker: string): Promise<PriceHistory> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY not set");
  const j = await getJSON(
    `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?timeseries=${HISTORY_DAYS}&apikey=${key}`
  );
  const hist = [...j.historical].reverse();
  return {
    dates: hist.map((h: any) => h.date),
    closes: hist.map((h: any) => h.close),
    volumes: hist.map((h: any) => h.volume),
    source: "Financial Modeling Prep /historical-price-full, daily close",
    as_of: hist[hist.length - 1]?.date ?? today,
  };
}

async function fetchPricesFinnhub(ticker: string): Promise<PriceHistory> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not set");
  const to = Math.floor(Date.now() / 1000);
  const from = to - 400 * 86400;
  const j = await getJSON(
    `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}&token=${key}`
  );
  if (j.s !== "ok") throw new Error(`Finnhub status ${j.s}`);
  const cut = Math.max(0, j.t.length - HISTORY_DAYS);
  return {
    dates: j.t.slice(cut).map((t: number) => new Date(t * 1000).toISOString().slice(0, 10)),
    closes: j.c.slice(cut),
    volumes: j.v.slice(cut),
    source: "Finnhub /stock/candle, daily close",
    as_of: new Date(j.t[j.t.length - 1] * 1000).toISOString().slice(0, 10),
  };
}

const fetchPrices =
  PRICE_PROVIDER === "fmp" ? fetchPricesFMP : PRICE_PROVIDER === "finnhub" ? fetchPricesFinnhub : fetchPricesYahoo;

// ---------- SEC EDGAR ----------

const SEC_HEADERS = { "User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate" };
let lastSecCall = 0;
async function secJSON(url: string): Promise<any> {
  // SEC fair-access guideline: stay well under 10 req/s
  const wait = lastSecCall + 150 - Date.now();
  if (wait > 0) await sleep(wait);
  lastSecCall = Date.now();
  return getJSON(url, SEC_HEADERS);
}

interface FactPick {
  val: number;
  end: string;
  fy: number;
  form: string;
  accn: string;
}

/** Latest annual (10-K, fp=FY) value for a us-gaap tag. */
function latestAnnual(facts: any, tag: string, unit = "USD"): FactPick | null {
  const items = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
  if (!items) return null;
  const annual = items.filter(
    (i: any) => i.form === "10-K" && i.fp === "FY" && i.start && i.end &&
      // duration close to a year (350-380 days) → true annual figure, not a quarter
      (new Date(i.end).getTime() - new Date(i.start).getTime()) / 86400000 > 340
  );
  if (!annual.length) return null;
  annual.sort((a: any, b: any) => (a.end < b.end ? -1 : 1));
  const last = annual[annual.length - 1];
  return { val: last.val, end: last.end, fy: last.fy, form: last.form, accn: last.accn };
}

/** Same as latestAnnual but the figure one fiscal year earlier (for growth). */
function priorAnnual(facts: any, tag: string, latestEnd: string, unit = "USD"): FactPick | null {
  const items = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
  if (!items) return null;
  const annual = items.filter(
    (i: any) => i.form === "10-K" && i.fp === "FY" && i.start && i.end && i.end < latestEnd &&
      (new Date(i.end).getTime() - new Date(i.start).getTime()) / 86400000 > 340
  );
  if (!annual.length) return null;
  annual.sort((a: any, b: any) => (a.end < b.end ? -1 : 1));
  const last = annual[annual.length - 1];
  // must be roughly one year before
  const gap = (new Date(latestEnd).getTime() - new Date(last.end).getTime()) / 86400000;
  if (gap < 300 || gap > 430) return null;
  return { val: last.val, end: last.end, fy: last.fy, form: last.form, accn: last.accn };
}

/** Latest instantaneous (balance-sheet) value for a tag. */
function latestInstant(facts: any, tag: string, unit = "USD"): FactPick | null {
  const items = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
  if (!items) return null;
  const pts = items.filter((i: any) => i.end && (i.form === "10-K" || i.form === "10-Q"));
  if (!pts.length) return null;
  pts.sort((a: any, b: any) => (a.end < b.end ? -1 : 1));
  const last = pts[pts.length - 1];
  return { val: last.val, end: last.end, fy: last.fy, form: last.form, accn: last.accn };
}

function firstTag(facts: any, tags: string[], picker: (f: any, t: string) => FactPick | null): { pick: FactPick; tag: string } | null {
  for (const t of tags) {
    const p = picker(facts, t);
    if (p) return { pick: p, tag: t };
  }
  return null;
}

/**
 * Some filers keep a legacy tag with stale values (e.g. MSFT's "Revenues"
 * stops in FY2010). Pick, across candidate tags, the one whose latest annual
 * figure has the most recent period end.
 */
function freshestTag(facts: any, tags: string[]): { pick: FactPick; tag: string } | null {
  let best: { pick: FactPick; tag: string } | null = null;
  for (const t of tags) {
    const p = latestAnnual(facts, t);
    if (p && (!best || p.end > best.pick.end)) best = { pick: p, tag: t };
  }
  return best;
}

const sourced = <T,>(pick: { pick: FactPick; tag: string } | null, cik: string): Sourced<number> & { tag?: string; accession?: string; period_end?: string } =>
  pick
    ? {
        value: pick.pick.val,
        as_of: pick.pick.end,
        source: `SEC EDGAR XBRL companyfacts CIK ${cik}, us-gaap:${pick.tag}, ${pick.pick.form} accession ${pick.pick.accn}`,
        tag: pick.tag,
        accession: pick.pick.accn,
        period_end: pick.pick.end,
      }
    : { value: null, as_of: null, source: "unavailable at ingest time" };

// ---------- main ----------

async function main() {
  console.log(`rebalance-desk ingest — provider=${PRICE_PROVIDER}, SEC UA="${SEC_USER_AGENT}"`);
  const warnings: string[] = [];

  // ticker → CIK map
  let cikMap: Record<string, { cik: string; name: string }> = {};
  try {
    const tickersJson = await secJSON("https://www.sec.gov/files/company_tickers.json");
    for (const row of Object.values<any>(tickersJson)) {
      cikMap[row.ticker] = { cik: String(row.cik_str).padStart(10, "0"), name: row.title };
    }
  } catch (e: any) {
    warnings.push(`SEC company_tickers.json unreachable: ${e.message}`);
  }

  // risk-free rate from FRED
  let riskFree: any = { value: null, as_of: null, source: "FRED DGS10 — unavailable at ingest time", series: "DGS10" };
  try {
    const csv = await getText("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10");
    const lines = csv.trim().split("\n").slice(1).filter((l) => !l.includes(","+ "."));
    const valid = lines.filter((l) => /\d{4}-\d{2}-\d{2},[\d.]+/.test(l));
    const [date, val] = valid[valid.length - 1].split(",");
    riskFree = {
      value: parseFloat(val) / 100,
      as_of: date,
      series: "DGS10",
      source: "FRED, 10-Year Treasury Constant Maturity Rate (DGS10), fredgraph.csv",
    };
    console.log(`  risk-free DGS10 = ${val}% as of ${date}`);
  } catch (e: any) {
    warnings.push(`FRED DGS10 unreachable: ${e.message}`);
  }

  const tickersOut: Record<string, any> = {};

  for (const ticker of [...TICKERS, BENCHMARK]) {
    console.log(`  ${ticker} ...`);
    const entry: any = { is_benchmark: ticker === BENCHMARK };

    // prices
    try {
      const ph = await fetchPrices(ticker);
      entry.prices = ph;
      entry.quote = {
        value: ph.closes[ph.closes.length - 1],
        as_of: ph.as_of,
        source: `${ph.source} (last close)`,
      };
      // average daily dollar volume over last ADV_WINDOW days
      const n = ph.closes.length;
      const w = Math.min(ADV_WINDOW, n);
      let adv = 0;
      for (let i = n - w; i < n; i++) adv += ph.closes[i] * ph.volumes[i];
      entry.adv_dollar = {
        value: adv / w,
        as_of: ph.as_of,
        window_days: w,
        source: `computed in ingest: mean(close × volume) over last ${w} sessions, prices from ${ph.source}`,
      };
      await sleep(800); // be polite to the price provider
    } catch (e: any) {
      warnings.push(`${ticker} prices unreachable (${PRICE_PROVIDER}): ${e.message}`);
      entry.prices = null;
      entry.quote = { value: null, as_of: null, source: "unavailable at ingest time" };
      entry.adv_dollar = { value: null, as_of: null, source: "unavailable at ingest time" };
    }

    if (ticker === BENCHMARK) {
      entry.name = "SPDR S&P 500 ETF Trust";
      entry.sector = null;
      entry.fundamentals = null;
      tickersOut[ticker] = entry;
      continue;
    }

    const cikInfo = cikMap[ticker];
    entry.name = cikInfo?.name ?? ticker;
    entry.cik = cikInfo?.cik ?? null;

    // SEC submissions → SIC
    if (cikInfo) {
      try {
        const sub = await secJSON(`https://data.sec.gov/submissions/CIK${cikInfo.cik}.json`);
        const sic = parseInt(sub.sic, 10);
        entry.sector = {
          gics_style: sicToSector(sic),
          sic: sub.sic,
          sic_description: sub.sicDescription,
          as_of: today,
          source: `SEC EDGAR submissions CIK ${cikInfo.cik} (SIC ${sub.sic} "${sub.sicDescription}"); SIC→GICS-style mapping is a deterministic convention in ingest/sic-map.ts`,
        };
      } catch (e: any) {
        warnings.push(`${ticker} SEC submissions unreachable: ${e.message}`);
        entry.sector = null;
      }

      // SEC companyfacts → shares + fundamentals
      try {
        const facts = await secJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cikInfo.cik}.json`);
        const cik = cikInfo.cik;

        // Shares outstanding: some filers (e.g. Alphabet, multi-class) omit the
        // dei tag, so fall back to us-gaap share-count tags. For multi-class
        // filers the us-gaap consolidated tag covers all classes.
        entry.shares_outstanding = { value: null, as_of: null, source: "unavailable at ingest time" };
        const sharesItems = facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
        if (sharesItems?.length) {
          const s = [...sharesItems].sort((a: any, b: any) => (a.end < b.end ? -1 : 1)).pop();
          entry.shares_outstanding = {
            value: s.val,
            as_of: s.end,
            source: `SEC EDGAR XBRL companyfacts CIK ${cik}, dei:EntityCommonStockSharesOutstanding, ${s.form} accession ${s.accn}`,
          };
        } else {
          const fb = firstTag(facts, ["CommonStockSharesOutstanding", "CommonStockSharesIssued"], (f, t) =>
            latestInstant(f, t, "shares")
          );
          if (fb) {
            entry.shares_outstanding = {
              value: fb.pick.val,
              as_of: fb.pick.end,
              source: `SEC EDGAR XBRL companyfacts CIK ${cik}, us-gaap:${fb.tag}, ${fb.pick.form} accession ${fb.pick.accn}`,
            };
          }
        }

        const netIncome = sourced(firstTag(facts, ["NetIncomeLoss"], latestAnnual), cik);
        const equity = sourced(
          firstTag(facts, ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], latestInstant),
          cik
        );
        const revenue = sourced(
          freshestTag(facts, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"]),
          cik
        );
        const opIncome = sourced(firstTag(facts, ["OperatingIncomeLoss"], latestAnnual), cik);
        const epsPick = firstTag(facts, ["EarningsPerShareDiluted"], (f, t) => latestAnnual(f, t, "USD/shares"));
        const eps = sourced(epsPick, cik);

        // prior-year revenue for growth
        let revenueGrowth: Sourced<number> = { value: null, as_of: null, source: "unavailable at ingest time" };
        if (revenue.value != null && (revenue as any).tag) {
          const prior = priorAnnual(facts, (revenue as any).tag, revenue.as_of!);
          if (prior && prior.val !== 0) {
            revenueGrowth = {
              value: revenue.value / prior.val - 1,
              as_of: revenue.as_of,
              source: `computed in ingest: FY revenue (${revenue.as_of}) / prior FY revenue (${prior.end}) − 1, both SEC EDGAR XBRL us-gaap:${(revenue as any).tag}`,
            };
          }
        }

        entry.fundamentals = {
          net_income_fy: netIncome,
          stockholders_equity: equity,
          revenue_fy: revenue,
          operating_income_fy: opIncome,
          eps_diluted_fy: eps,
          revenue_growth_yoy: revenueGrowth,
          roe:
            netIncome.value != null && equity.value
              ? {
                  value: netIncome.value / equity.value,
                  as_of: netIncome.as_of,
                  source: "computed in ingest: FY net income / latest stockholders' equity, both SEC EDGAR XBRL",
                }
              : { value: null, as_of: null, source: "unavailable (missing inputs)" },
          operating_margin:
            opIncome.value != null && revenue.value
              ? {
                  value: opIncome.value / revenue.value,
                  as_of: opIncome.as_of,
                  source: "computed in ingest: FY operating income / FY revenue, both SEC EDGAR XBRL",
                }
              : { value: null, as_of: null, source: "unavailable (missing inputs; some financials do not report OperatingIncomeLoss)" },
        };

        // valuation needs price; computed here so the as-of pairing is explicit
        const px = entry.quote?.value;
        entry.fundamentals.pe =
          px != null && eps.value
            ? {
                value: px / eps.value,
                as_of: entry.quote.as_of,
                source: `computed in ingest: price (${entry.quote.as_of}) / FY diluted EPS (FY ended ${eps.as_of}); note the period mismatch is inherent to trailing P/E`,
              }
            : { value: null, as_of: null, source: "unavailable (missing inputs)" };
        entry.market_cap =
          px != null && entry.shares_outstanding.value
            ? {
                value: px * entry.shares_outstanding.value,
                as_of: entry.quote.as_of,
                source: `computed in ingest: price (${entry.quote.as_of}) × shares outstanding (${entry.shares_outstanding.as_of})`,
              }
            : { value: null, as_of: null, source: "unavailable (missing inputs)" };
        entry.fundamentals.pb =
          entry.market_cap.value && equity.value
            ? {
                value: entry.market_cap.value / equity.value,
                as_of: entry.quote.as_of,
                source: "computed in ingest: market cap / latest stockholders' equity (SEC EDGAR XBRL)",
              }
            : { value: null, as_of: null, source: "unavailable (missing inputs)" };
      } catch (e: any) {
        warnings.push(`${ticker} SEC companyfacts unreachable: ${e.message}`);
        entry.fundamentals = null;
        entry.shares_outstanding = { value: null, as_of: null, source: "unavailable at ingest time" };
        entry.market_cap = { value: null, as_of: null, source: "unavailable at ingest time" };
      }
    } else {
      entry.sector = null;
      entry.fundamentals = null;
    }

    tickersOut[ticker] = entry;
  }

  const snapshot = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    price_provider: PRICE_PROVIDER,
    benchmark: BENCHMARK,
    history_days: HISTORY_DAYS,
    risk_free: riskFree,
    tickers: tickersOut,
    warnings,
    note: "All figures fetched from the listed public sources at generated_at. Nothing in this file is fabricated; null means the source was unreachable during ingest.",
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 1));
  console.log(`\nWrote ${OUT_PATH}`);
  if (warnings.length) {
    console.log(`Warnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  - ${w}`);
  } else {
    console.log("No warnings — all sources reachable.");
  }
}

main().catch((e) => {
  console.error("Ingest failed:", e);
  process.exit(1);
});
