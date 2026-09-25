const DAY_MS = 86_400_000;

export function startOfDay(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(date = new Date()): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Counts (or sums) items into `count` consecutive buckets of `bucketDays` days,
 * ending with the bucket that contains today. Items outside the range are ignored.
 */
export function bucketize<T>(
  items: T[],
  getDate: (item: T) => Date | null,
  { count, bucketDays = 1, getValue = () => 1 }: { count: number; bucketDays?: number; getValue?: (item: T) => number },
): { start: Date; value: number }[] {
  const first = addDays(startOfDay(), -(count - 1) * bucketDays);
  const buckets = Array.from({ length: count }, (_, i) => ({ start: addDays(first, i * bucketDays), value: 0 }));
  for (const item of items) {
    const date = getDate(item);
    if (!date) continue;
    const index = Math.floor((date.getTime() - first.getTime()) / (bucketDays * DAY_MS));
    if (index >= 0 && index < count) buckets[index].value += getValue(item);
  }
  return buckets;
}

/** "3d", "5h", "12m" — compact age since `date`. */
export function formatAge(date: Date, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
  return `${minutes}m`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** "+18%" / "−4%" / null when there's no baseline to compare against. */
export function formatDelta(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%`;
}
