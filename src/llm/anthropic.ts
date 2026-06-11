import Anthropic from "@anthropic-ai/sdk";
import type { OptimizationSpec, RebalanceResult } from "../types";
import { validateAndClampSpec } from "../engine/spec";

/**
 * Natural-language mode — the ONLY place an API call happens, and it runs on
 * the visitor's own Anthropic key.
 *
 *  - The key lives in React state only, is never written to localStorage or
 *    cookies, and is sent nowhere except api.anthropic.com.
 *  - The LLM's only job is translating the user's text into a structured
 *    OptimizationSpec (schema-enforced via output_config.format, validated
 *    and clamped client-side, one retry on schema failure), and optionally
 *    rewriting the client paragraph grounded in engine-computed numbers.
 *  - The LLM never selects trades and never computes a metric.
 *  - Determinism note: current Anthropic models (Opus 4.7+) removed sampling
 *    parameters entirely (temperature/top_p 400), so no sampling params are
 *    sent; the schema constraint + clamping provide the determinism the spec
 *    translation needs.
 */

const MODEL = "claude-opus-4-8";

const SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["objective", "constraints"],
  properties: {
    objective: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: {
          type: "string",
          enum: [
            "minimize_volatility",
            "maximize_sharpe",
            "target_volatility",
            "minimize_tracking_error",
            "harvest_losses",
          ],
        },
        target_volatility: { type: ["number", "null"] },
      },
    },
    constraints: {
      type: "object",
      additionalProperties: false,
      required: ["long_only"],
      properties: {
        long_only: { type: "boolean", enum: [true] },
        max_position_weight: { type: ["number", "null"] },
        sector_caps: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            "Information Technology": { type: "number" },
            "Consumer Discretionary": { type: "number" },
            "Consumer Staples": { type: "number" },
            Financials: { type: "number" },
            "Health Care": { type: "number" },
            Energy: { type: "number" },
            Industrials: { type: "number" },
            "Communication Services": { type: "number" },
            Utilities: { type: "number" },
            Materials: { type: "number" },
            "Real Estate": { type: "number" },
          },
        },
        factor_bounds: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            growth: { $ref: "#/$defs/bound" },
            value: { $ref: "#/$defs/bound" },
            momentum: { $ref: "#/$defs/bound" },
            quality: { $ref: "#/$defs/bound" },
            low_vol: { $ref: "#/$defs/bound" },
            size: { $ref: "#/$defs/bound" },
          },
        },
        cash_weight: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: { min: { type: ["number", "null"] }, max: { type: ["number", "null"] } },
        },
        max_turnover: { type: ["number", "null"] },
        max_realized_gains_usd: { type: ["number", "null"] },
        avoid_wash_sale: { type: ["boolean", "null"] },
      },
    },
    notes: { type: ["string", "null"] },
  },
  $defs: {
    bound: {
      type: "object",
      additionalProperties: false,
      properties: { min: { type: ["number", "null"] }, max: { type: ["number", "null"] } },
    },
  },
} as const;

function specSystemPrompt(portfolioSummary: string, marketSummary: string): string {
  return `You translate a client's natural-language rebalancing objective into a structured optimization spec for a deterministic mean-variance optimizer. You never pick trades and never compute metrics — the engine does all math from real market data.

Rules:
- Weights, caps, turnover, and volatility are fractions (5% → 0.05).
- "reduce volatility by X%" → objective target_volatility = current volatility × (1 − X).
- Factor bounds are portfolio z-score exposures, sensible range −1.5 to +1.5; "tilt toward X" → min ≈ 0.1–0.3.
- "avoid taxes" / "no gains" → max_realized_gains_usd small or 0; "harvest losses" → objective harvest_losses with avoid_wash_sale true.
- Only include constraints the user asked for or that are clearly implied. long_only is always true.
- If the user names a sector cap "to benchmark", use the benchmark proxy weight from the market summary.

Current portfolio:
${portfolioSummary}

Market context (all real, dated figures from the committed snapshot):
${marketSummary}`;
}

export interface NLResult {
  spec: OptimizationSpec;
  warnings: string[];
}

export async function translateObjective(
  apiKey: string,
  userText: string,
  portfolioSummary: string,
  marketSummary: string
): Promise<NLResult> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const ask = async (extra?: string): Promise<unknown> => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: specSystemPrompt(portfolioSummary, marketSummary),
      output_config: { format: { type: "json_schema", schema: SPEC_SCHEMA as any } },
      messages: [
        {
          role: "user",
          content: `Translate this objective into an optimization spec:\n\n"${userText}"${extra ? `\n\n${extra}` : ""}`,
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("Model returned no text content");
    return JSON.parse(text.text);
  };

  let raw = await ask();
  let { spec, errors } = validateAndClampSpec(raw);
  if (!spec) {
    // one retry, telling the model what failed
    raw = await ask(`Your previous spec failed validation: ${errors.join("; ")}. Return a corrected spec.`);
    const second = validateAndClampSpec(raw);
    spec = second.spec;
    errors = second.errors;
    if (!spec) throw new Error(`Spec failed validation after retry: ${errors.join("; ")}`);
  }
  return { spec, warnings: errors };
}

export async function writeRationale(
  apiKey: string,
  userText: string,
  result: RebalanceResult
): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const m = result.pre_post_metrics;
  const grounding = {
    objective: result.spec.objective,
    constraints: result.spec.constraints,
    trades: result.proposed_trades.map((t) => ({
      ticker: t.ticker,
      action: t.action,
      shares: t.share_count,
      notional: Math.round(t.notional_usd),
    })),
    metrics_pre: m.pre,
    metrics_post: m.post,
    realized_gain_usd: Math.round(result.tax_impact_estimate.total_realized_gain_usd),
    wash_sale_flags: result.tax_impact_estimate.wash_sale_flags,
  };
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You write one client-facing paragraph explaining a proposed rebalance. Use ONLY the numbers provided — never invent a figure, never add new numbers, never recommend anything beyond what the data shows. Plain, professional fiduciary tone. End by noting this is an educational demonstration, not investment advice. Return only the paragraph.",
    messages: [
      {
        role: "user",
        content: `Client's stated objective: "${userText}"\n\nEngine-computed result (all figures deterministic, from real market data):\n${JSON.stringify(grounding, null, 2)}`,
      },
    ],
  });
  const text = response.content.find((b) => b.type === "text");
  return text && text.type === "text" ? text.text.trim() : result.one_paragraph_rationale;
}
