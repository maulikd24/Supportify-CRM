/** CX display helpers, safe for client components. */

const LOCALE = "en-IN";

/** Money in the org's currency, compact above 10k ("$1.2M", "₹45K"). */
export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: Math.abs(value) >= 100 || value === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString(LOCALE)}`;
  }
}

export function formatShare(share: number | null): string {
  return share == null ? "–" : `${Math.round(share * 100)}%`;
}

/** Sentiment from -1 … 1 shown as -100 … +100. */
export function formatSentiment(value: number | null): string {
  if (value == null) return "–";
  const n = Math.round(value * 100);
  return n > 0 ? `+${n}` : String(n);
}

export function formatCsat(value: number | null): string {
  return value == null ? "–" : value.toFixed(1);
}

export function formatChange(change: number | null): string | null {
  if (change == null || !Number.isFinite(change)) return null;
  const pct = Math.round(change * 100);
  return pct === 0 ? "no change" : `${pct > 0 ? "+" : ""}${pct}%`;
}

export const CHANNEL_LABEL: Record<string, string> = { email: "Email", chat: "Chat", voice: "Phone", social: "Social", survey: "Survey", review: "Review", unknown: "Unknown" };
export const SOURCE_LABEL: Record<string, string> = { HELPDESK: "Helpdesk", SURVEY: "Surveys", REVIEW: "Reviews", CALL: "Calls", BOT: "Bot" };
