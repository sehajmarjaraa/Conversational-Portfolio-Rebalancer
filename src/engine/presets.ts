import type { MetricSet, OptimizationSpec } from "../types";

/**
 * Committed preset objectives — each runs the deterministic optimizer with
 * zero API calls. Some are parameterized by the portfolio's CURRENT metrics
 * (e.g. "reduce volatility 20%"), so they are functions, evaluated at click
 * time from engine-computed numbers.
 */

export interface Preset {
  id: string;
  title: string;
  blurb: string;
  build: (current: MetricSet, benchTechWeight: number) => OptimizationSpec;
}

export const PRESETS: Preset[] = [
  {
    id: "devol",
    title: "Reduce volatility 20%, max 8% per name",
    blurb: "Target 0.8× current σ with a hard position cap",
    build: (m) => ({
      objective: { type: "target_volatility", target_volatility: Math.round(m.volatility * 0.8 * 1000) / 1000 },
      constraints: { long_only: true, max_position_weight: 0.08, cash_weight: { min: 0.02, max: 0.25 } },
      notes: "Preset: cut portfolio volatility ~20% from current with an 8% per-name cap (12-name universe).",
    }),
  },
  {
    id: "trimtech",
    title: "Cut tech to benchmark weight",
    blurb: "Sector cap at the cap-weighted universe proxy, min tracking error",
    build: (_m, benchTech) => ({
      objective: { type: "minimize_tracking_error" },
      constraints: {
        long_only: true,
        sector_caps: { "Information Technology": Math.round(benchTech * 1000) / 1000 },
        max_position_weight: 0.15,
        cash_weight: { min: 0.01, max: 0.1 },
      },
      notes: "Preset: bring Information Technology down to its benchmark-proxy weight while hugging the benchmark.",
    }),
  },
  {
    id: "quality",
    title: "Tilt toward quality and low-vol",
    blurb: "Factor floors on quality & low-vol, modest turnover",
    build: () => ({
      objective: { type: "minimize_volatility" },
      constraints: {
        long_only: true,
        factor_bounds: { quality: { min: 0.1 }, low_vol: { min: 0.1 } },
        max_position_weight: 0.12,
        max_turnover: 0.35,
        cash_weight: { min: 0.01, max: 0.15 },
      },
      notes: "Preset: rotate toward quality and low-volatility characteristics without excessive trading.",
    }),
  },
  {
    id: "harvest",
    title: "Harvest losses without wash-sale risk",
    blurb: "Realize embedded losses, skip wash-sale-flagged lots, $0 gain budget",
    build: () => ({
      objective: { type: "harvest_losses" },
      constraints: {
        long_only: true,
        max_realized_gains_usd: 0,
        avoid_wash_sale: true,
        max_turnover: 0.3,
        cash_weight: { min: 0.01, max: 0.2 },
      },
      notes: "Preset: tax-loss harvest while keeping the portfolio close to the benchmark and realizing no net gains.",
    }),
  },
  {
    id: "sharpe",
    title: "Max Sharpe, 25% turnover cap",
    blurb: "CAPM-based Sharpe with diversification and trading limits",
    build: () => ({
      objective: { type: "maximize_sharpe" },
      constraints: {
        long_only: true,
        max_position_weight: 0.15,
        max_turnover: 0.25,
        cash_weight: { min: 0.01, max: 0.1 },
      },
      notes: "Preset: maximize the CAPM-expected Sharpe ratio with position and turnover discipline.",
    }),
  },
];
