import type { Snapshot } from "../types";

export function Footer({ snapshot }: { snapshot: Snapshot }) {
  return (
    <footer className="border-t border-edge mt-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap justify-between gap-4 mb-5">
          <span className="num text-sm text-accent font-semibold">rebalance-desk</span>
          <span className="text-xs text-faint">
            Built by <span className="text-muted">Sehaj Marjara</span> ·{" "}
            <a className="underline hover:text-ink" href="https://www.linkedin.com/in/sehajmarjara/">LinkedIn</a> ·{" "}
            <a className="underline hover:text-ink" href="https://github.com/sehajmarjaraa">GitHub</a> ·{" "}
            <a className="underline hover:text-ink" href="#">Resume</a>
          </span>
        </div>
        <p className="text-[11px] text-faint leading-relaxed max-w-3xl">
          Research and educational demonstration using public market data and SEC filings as of the
          dates stated in the provenance panel (snapshot generated{" "}
          {snapshot.generated_at.slice(0, 10)}). Not investment advice and not a recommendation to
          buy, sell, or hold any security or to adopt any portfolio or strategy. Holdings and
          cost-basis lots are illustrative. Expected returns rely on a labeled CAPM assumption.
          Past performance does not predict future results.
        </p>
      </div>
    </footer>
  );
}
