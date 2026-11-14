import type { Condition } from "../api";

export function kr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "No price";
  return `${amount.toLocaleString("nb-NO")} kr`;
}

/** API fees shown in kroner, e.g. "0,85 kr". */
export function fee(usd: number, usdToNok: number): string {
  const nok = usd * usdToNok;
  if (nok <= 0) return "0 kr";
  if (nok < 0.1) return "under 0,10 kr";
  return `${nok.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

export const CONDITION_ORDER: Condition[] = ["new", "like_new", "good", "fair", "needs_repair"];

export const CONDITION_LABEL: Record<Condition, string> = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  needs_repair: "Needs repair",
};
