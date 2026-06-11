export function HowItWorks() {
  const panels = [
    {
      n: "01",
      title: "Real analytics from real returns",
      body: "250 aligned daily closes per name drive the covariance matrix, volatility, beta, tracking error, drawdown, and Sortino. Fundamentals come from SEC EDGAR XBRL filings; the risk-free rate from FRED. Nothing is simulated, nothing is fabricated — unreachable fields stay null.",
    },
    {
      n: "02",
      title: "Deterministic constrained optimizer",
      body: "Projected gradient descent over the mean-variance objective with exact box-and-simplex projection and penalty-enforced sector, factor, turnover, and tax constraints. Same spec in, same trades out — and infeasible specs return a relaxation proposal naming the binding constraint.",
    },
    {
      n: "03",
      title: "LLM as translator, nothing more",
      body: "Natural-language mode makes one schema-constrained API call on your own Anthropic key to turn plain English into the same structured spec the presets use, validated and clamped client-side. The model never selects a trade and never computes a number.",
    },
  ];
  return (
    <section className="mt-16">
      <h2 className="text-2xl font-semibold tracking-tight mb-6">How it works</h2>
      <div className="grid sm:grid-cols-3 gap-5">
        {panels.map((p) => (
          <div key={p.n} className="panel p-5">
            <div className="num text-accent text-xs mb-3">{p.n}</div>
            <h3 className="font-medium mb-2 text-sm">{p.title}</h3>
            <p className="text-xs text-muted leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
