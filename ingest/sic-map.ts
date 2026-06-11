/**
 * SIC code → GICS-style sector mapping.
 *
 * The SIC code itself comes from SEC EDGAR (real, traceable). This mapping
 * from SIC ranges to GICS-style sector names is a deterministic convention
 * maintained in this file — it is labeled as such in the provenance panel.
 */
export function sicToSector(sic: number): string {
  if (sic >= 100 && sic <= 999) return "Materials";
  if (sic >= 1000 && sic <= 1499) {
    if (sic >= 1300 && sic <= 1399) return "Energy";
    return "Materials";
  }
  if (sic >= 1500 && sic <= 1799) return "Industrials";
  if (sic >= 2000 && sic <= 2199) return "Consumer Staples";
  if (sic >= 2800 && sic <= 2836) {
    if (sic >= 2833) return "Health Care";
    return "Materials";
  }
  if (sic === 2840 || sic === 2844) return "Consumer Staples";
  if (sic >= 2900 && sic <= 2999) return "Energy";
  if (sic >= 3570 && sic <= 3579) return "Information Technology";
  if (sic >= 3600 && sic <= 3699) return "Information Technology";
  if (sic >= 3823 && sic <= 3829) return "Information Technology";
  if (sic >= 3841 && sic <= 3851) return "Health Care";
  if (sic >= 3520 && sic <= 3569) return "Industrials";
  if (sic >= 3700 && sic <= 3799) {
    if (sic === 3711 || sic === 3714) return "Consumer Discretionary";
    return "Industrials";
  }
  if (sic >= 4800 && sic <= 4899) return "Communication Services";
  if (sic >= 4900 && sic <= 4999) return "Utilities";
  if (sic >= 5000 && sic <= 5199) return "Consumer Discretionary";
  if (sic >= 5200 && sic <= 5999) {
    if (sic === 5411 || sic === 5412 || sic === 5912) return "Consumer Staples";
    return "Consumer Discretionary";
  }
  if (sic === 6324) return "Health Care"; // hospital & medical service plans (managed care)
  if (sic >= 6000 && sic <= 6499) return "Financials";
  if (sic >= 6500 && sic <= 6599) return "Real Estate";
  if (sic >= 6798 && sic <= 6799) return "Real Estate";
  if (sic >= 7370 && sic <= 7379) return "Information Technology";
  if (sic >= 7800 && sic <= 7999) return "Communication Services";
  if (sic >= 8000 && sic <= 8099) return "Health Care";
  if (sic >= 2000 && sic <= 3999) return "Industrials";
  return "Other";
}
