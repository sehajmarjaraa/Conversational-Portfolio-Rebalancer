import type { Portfolio } from "../types";

/**
 * Demo portfolio — REAL tickers, illustrative holdings.
 *
 * Share counts and weights are a realistic long-only allocation across the
 * ingested universe. Cost-basis lots are ILLUSTRATIVE (cost basis is private
 * information and cannot be sourced publicly); they are clearly labeled as
 * such in the UI and fully editable. Everything priced against the lots uses
 * real market prices from the committed snapshot.
 */
export const DEMO_PORTFOLIO: Portfolio = {
  cash_usd: 36_000,
  positions: [
    {
      ticker: "AAPL",
      lots: [
        { id: "AAPL-1", shares: 380, cost_basis_per_share: 168.4, acquired: "2023-03-14" },
        { id: "AAPL-2", shares: 200, cost_basis_per_share: 228.9, acquired: "2025-01-08" },
      ],
    },
    {
      ticker: "MSFT",
      lots: [
        { id: "MSFT-1", shares: 240, cost_basis_per_share: 312.5, acquired: "2023-06-21" },
        { id: "MSFT-2", shares: 145, cost_basis_per_share: 428.0, acquired: "2025-07-15" },
      ],
    },
    {
      ticker: "NVDA",
      lots: [
        { id: "NVDA-1", shares: 450, cost_basis_per_share: 47.2, acquired: "2023-09-05" },
        { id: "NVDA-2", shares: 240, cost_basis_per_share: 134.6, acquired: "2025-02-19" },
      ],
    },
    {
      ticker: "GOOGL",
      lots: [
        { id: "GOOGL-1", shares: 190, cost_basis_per_share: 131.8, acquired: "2023-11-02" },
        { id: "GOOGL-2", shares: 105, cost_basis_per_share: 196.3, acquired: "2025-05-12" },
      ],
    },
    {
      ticker: "AMZN",
      lots: [
        { id: "AMZN-1", shares: 250, cost_basis_per_share: 128.7, acquired: "2023-08-15" },
        { id: "AMZN-2", shares: 145, cost_basis_per_share: 219.4, acquired: "2025-04-22" },
      ],
    },
    {
      ticker: "JPM",
      lots: [
        { id: "JPM-1", shares: 200, cost_basis_per_share: 146.2, acquired: "2023-05-30" },
        { id: "JPM-2", shares: 105, cost_basis_per_share: 244.8, acquired: "2025-03-11" },
      ],
    },
    {
      ticker: "UNH",
      lots: [
        { id: "UNH-1", shares: 80, cost_basis_per_share: 512.6, acquired: "2024-02-13" },
        { id: "UNH-2", shares: 65, cost_basis_per_share: 488.1, acquired: "2025-09-04" },
      ],
    },
    {
      ticker: "JNJ",
      lots: [
        { id: "JNJ-1", shares: 180, cost_basis_per_share: 158.9, acquired: "2023-10-17" },
        { id: "JNJ-2", shares: 120, cost_basis_per_share: 162.4, acquired: "2025-06-25" },
      ],
    },
    {
      ticker: "XOM",
      lots: [
        { id: "XOM-1", shares: 300, cost_basis_per_share: 104.3, acquired: "2023-04-04" },
        { id: "XOM-2", shares: 180, cost_basis_per_share: 119.7, acquired: "2025-08-19" },
      ],
    },
    {
      ticker: "PG",
      lots: [
        { id: "PG-1", shares: 300, cost_basis_per_share: 148.5, acquired: "2023-07-11" },
        { id: "PG-2", shares: 180, cost_basis_per_share: 171.2, acquired: "2025-10-08" },
      ],
    },
    {
      ticker: "HD",
      lots: [
        { id: "HD-1", shares: 110, cost_basis_per_share: 302.4, acquired: "2023-12-06" },
        { id: "HD-2", shares: 75, cost_basis_per_share: 396.8, acquired: "2025-11-20" },
      ],
    },
    {
      ticker: "CAT",
      lots: [
        { id: "CAT-1", shares: 40, cost_basis_per_share: 241.6, acquired: "2023-02-22" },
        { id: "CAT-2", shares: 25, cost_basis_per_share: 528.3, acquired: "2025-12-15" },
      ],
    },
  ],
};
