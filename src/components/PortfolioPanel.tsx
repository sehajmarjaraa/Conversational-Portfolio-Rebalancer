import { useState } from "react";
import type { Portfolio, Snapshot } from "../types";
import type { EngineContext } from "../engine/engine";
import { pct, usd } from "../ui/format";

export function PortfolioPanel({
  ctx,
  snapshot,
  portfolio,
  setPortfolio,
  totalValue,
}: {
  ctx: EngineContext;
  snapshot: Snapshot;
  portfolio: Portfolio;
  setPortfolio: (p: Portfolio) => void;
  totalValue: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const updateLot = (ticker: string, lotId: string, field: "shares" | "cost_basis_per_share" | "acquired", value: string) => {
    const next: Portfolio = JSON.parse(JSON.stringify(portfolio));
    const pos = next.positions.find((p) => p.ticker === ticker);
    if (!pos) return;
    const lot = pos.lots.find((l) => l.id === lotId);
    if (!lot) return;
    if (field === "acquired") lot.acquired = value;
    else {
      const n = parseFloat(value);
      if (!isFinite(n) || n < 0) return;
      lot[field] = n;
    }
    setPortfolio(next);
  };

  const updateCash = (value: string) => {
    const n = parseFloat(value);
    if (!isFinite(n) || n < 0) return;
    setPortfolio({ ...portfolio, cash_usd: n });
  };

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-semibold">Current portfolio</h2>
        <span className="num text-sm text-muted">{usd(totalValue)}</span>
      </div>
      <p className="text-[11px] text-faint mb-4 leading-relaxed">
        Prices are real (as of {ctx.model.window.end}). Holdings and cost-basis lots are{" "}
        <span className="text-warn">illustrative</span> — cost basis is private information — and
        fully editable. Click a row to edit its lots.
      </p>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="label text-left">
              <th className="pb-2 pr-2 font-semibold">ticker</th>
              <th className="pb-2 pr-2 font-semibold text-right">shares</th>
              <th className="pb-2 pr-2 font-semibold text-right">price</th>
              <th className="pb-2 pr-2 font-semibold text-right">value</th>
              <th className="pb-2 font-semibold text-right">weight</th>
            </tr>
          </thead>
          <tbody>
            {ctx.model.tickers.map((t) => {
              const pos = portfolio.positions.find((p) => p.ticker === t);
              const shares = pos ? pos.lots.reduce((a, l) => a + l.shares, 0) : 0;
              const px = ctx.model.prices[t];
              const mv = shares * px;
              const isOpen = expanded === t;
              return [
                <tr
                  key={t}
                  onClick={() => setExpanded(isOpen ? null : t)}
                  className="border-t border-edge cursor-pointer hover:bg-panel2 transition-colors"
                >
                  <td className="py-2 pr-2">
                    <span className="num font-medium">{t}</span>
                    <span className="text-faint text-xs ml-2 hidden sm:inline">
                      {snapshot.tickers[t].sector?.gics_style ?? ""}
                    </span>
                  </td>
                  <td className="num py-2 pr-2 text-right">{shares.toLocaleString()}</td>
                  <td className="num py-2 pr-2 text-right text-muted">{px.toFixed(2)}</td>
                  <td className="num py-2 pr-2 text-right">{usd(mv)}</td>
                  <td className="num py-2 text-right">{pct(mv / totalValue)}</td>
                </tr>,
                isOpen && pos && (
                  <tr key={`${t}-lots`} className="bg-panel2">
                    <td colSpan={5} className="px-2 py-3">
                      <div className="space-y-2">
                        {pos.lots.map((lot) => (
                          <div key={lot.id} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="num text-faint w-16">{lot.id}</span>
                            <label className="flex items-center gap-1">
                              <span className="text-faint">sh</span>
                              <input
                                type="number"
                                className="w-20"
                                value={lot.shares}
                                min={0}
                                onChange={(e) => updateLot(t, lot.id, "shares", e.target.value)}
                              />
                            </label>
                            <label className="flex items-center gap-1">
                              <span className="text-faint">basis $</span>
                              <input
                                type="number"
                                className="w-24"
                                value={lot.cost_basis_per_share}
                                min={0}
                                step="0.01"
                                onChange={(e) =>
                                  updateLot(t, lot.id, "cost_basis_per_share", e.target.value)
                                }
                              />
                            </label>
                            <label className="flex items-center gap-1">
                              <span className="text-faint">acquired</span>
                              <input
                                type="date"
                                value={lot.acquired}
                                onChange={(e) => updateLot(t, lot.id, "acquired", e.target.value)}
                              />
                            </label>
                            <span
                              className={`num ml-auto ${
                                px >= lot.cost_basis_per_share ? "text-up" : "text-down"
                              }`}
                            >
                              {px >= lot.cost_basis_per_share ? "+" : ""}
                              {usd((px - lot.cost_basis_per_share) * lot.shares)} unrealized
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
            <tr className="border-t border-edge">
              <td className="py-2 pr-2 text-muted">Cash</td>
              <td colSpan={2} />
              <td className="py-2 pr-2 text-right">
                <input
                  type="number"
                  className="w-28 text-right"
                  value={portfolio.cash_usd}
                  min={0}
                  step={1000}
                  onChange={(e) => updateCash(e.target.value)}
                />
              </td>
              <td className="num py-2 text-right">{pct(portfolio.cash_usd / totalValue)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
