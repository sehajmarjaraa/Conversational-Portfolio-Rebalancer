// ---------- snapshot (produced by ingest, committed to /public/market) ----------

export interface Sourced<T = number> {
  value: T | null;
  as_of: string | null;
  source: string;
}

export interface PriceHistory {
  dates: string[];
  closes: number[];
  volumes: number[];
  source: string;
  as_of: string;
}

export interface TickerSnapshot {
  is_benchmark: boolean;
  name: string;
  cik?: string | null;
  prices: PriceHistory | null;
  quote: Sourced;
  adv_dollar: Sourced & { window_days?: number };
  sector: {
    gics_style: string;
    sic: string;
    sic_description: string;
    as_of: string;
    source: string;
  } | null;
  shares_outstanding?: Sourced;
  market_cap?: Sourced;
  fundamentals: {
    net_income_fy: Sourced;
    stockholders_equity: Sourced;
    revenue_fy: Sourced;
    operating_income_fy: Sourced;
    eps_diluted_fy: Sourced;
    revenue_growth_yoy: Sourced;
    roe: Sourced;
    operating_margin: Sourced;
    pe: Sourced;
    pb: Sourced;
  } | null;
}

export interface Snapshot {
  schema_version: number;
  generated_at: string;
  price_provider: string;
  benchmark: string;
  history_days: number;
  risk_free: Sourced & { series: string };
  tickers: Record<string, TickerSnapshot>;
  warnings: string[];
  note: string;
}

// ---------- portfolio ----------

export interface Lot {
  id: string;
  shares: number;
  cost_basis_per_share: number; // illustrative — cost basis is private information
  acquired: string; // ISO date
}

export interface Position {
  ticker: string;
  lots: Lot[];
}

export interface Portfolio {
  positions: Position[];
  cash_usd: number;
}

// ---------- optimization spec (the only thing the LLM is allowed to produce) ----------

export const FACTOR_NAMES = ["growth", "value", "momentum", "quality", "low_vol", "size"] as const;
export type FactorName = (typeof FACTOR_NAMES)[number];

export type ObjectiveType =
  | "minimize_volatility"
  | "maximize_sharpe"
  | "target_volatility"
  | "minimize_tracking_error"
  | "harvest_losses";

export interface OptimizationSpec {
  objective: {
    type: ObjectiveType;
    /** annualized, e.g. 0.12 — required when type === "target_volatility" */
    target_volatility?: number;
  };
  constraints: {
    long_only: true;
    /** per-name cap, fraction of portfolio (0–1) */
    max_position_weight?: number;
    /** GICS-style sector name → max weight */
    sector_caps?: Record<string, number>;
    /** bounds on portfolio factor z-score exposures */
    factor_bounds?: Partial<Record<FactorName, { min?: number; max?: number }>>;
    /** cash sleeve bounds, fraction of portfolio */
    cash_weight?: { min?: number; max?: number };
    /** one-way turnover cap, fraction of portfolio (0–1) */
    max_turnover?: number;
    /** tax budget: cap on net realized capital gains in USD */
    max_realized_gains_usd?: number;
    /** skip loss-sales that would carry wash-sale risk */
    avoid_wash_sale?: boolean;
  };
  notes?: string;
}

// ---------- engine output ----------

export interface ProposedTrade {
  ticker: string;
  action: "BUY" | "SELL";
  share_count: number;
  notional_usd: number;
  percent_of_portfolio_delta: number; // signed, in weight points (0–1 scale)
  rationale: string;
}

export interface MetricSet {
  expected_return: number;
  volatility: number;
  sharpe: number;
  sortino: number;
  max_drawdown_estimate: number;
  tracking_error: number;
  beta: number;
  concentration_top5: number;
}

export interface SectorRow {
  sector: string;
  pre: number;
  post: number;
  benchmark: number; // cap-weighted universe proxy — labeled assumption
}

export interface FactorRow {
  factor: FactorName;
  pre: number;
  post: number;
}

export interface LotTaxImpact {
  ticker: string;
  lot_id: string;
  shares_sold: number;
  proceeds_usd: number;
  cost_basis_usd: number;
  realized_gain_usd: number;
  term: "short" | "long";
  wash_sale_risk: boolean;
  wash_sale_reason?: string;
}

export interface ConstraintCheck {
  constraint: string;
  limit: string;
  achieved: string;
  buffer: string;
  status: "ok" | "near-bound" | "violated";
}

export interface ConstraintRelaxationProposal {
  binding_constraint: string;
  current_limit: string;
  achievable_value: string;
  suggestion: string;
}

export interface ExecutionNote {
  ticker: string;
  sequence: number;
  liquidity_flag: boolean;
  trade_pct_of_adv: number | null;
  order_type: string;
  note: string;
}

export interface RebalanceResult {
  feasible: boolean;
  relaxation_proposal: ConstraintRelaxationProposal | null;
  proposed_trades: ProposedTrade[];
  pre_post_metrics: { pre: MetricSet; post: MetricSet };
  sector_exposures_pre_post: SectorRow[];
  factor_exposures: FactorRow[];
  tax_impact_estimate: {
    lots: LotTaxImpact[];
    total_realized_gain_usd: number;
    short_term_gain_usd: number;
    long_term_gain_usd: number;
    wash_sale_flags: number;
  };
  constraint_compliance_check: ConstraintCheck[];
  execution_notes: ExecutionNote[];
  one_paragraph_rationale: string; // deterministic default; NL mode may replace with LLM-written text grounded in these numbers
  target_weights: Record<string, number>;
  pre_weights: Record<string, number>;
  spec: OptimizationSpec;
}
