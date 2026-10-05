const LOCALE = "en-IN";

/** Locale-pinned formatters — avoids SSR/client hydration mismatches from runtime-locale-dependent Intl defaults. */
export function formatDateTime(date: Date): string {
  return date.toLocaleString(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString(LOCALE, { dateStyle: "medium" });
}

export function formatNumber(value: number): string {
  return value.toLocaleString(LOCALE);
}

/** A duration as the two largest units, e.g. "45m", "2h 10m", "3d 4h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}
