/**
 * Starts a background auto-review worker invocation (the cron route chains
 * itself with this; the "Check now" action uses it to kick one off).
 */
export async function triggerAutoReviewRun({ depth = 0, organizationId }: { depth?: number; organizationId?: string }) {
  const base = process.env.APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error("Auto-review chain needs APP_URL and CRON_SECRET");
    return;
  }
  const next = new URL("/api/internal/cron/auto-review", base);
  next.searchParams.set("depth", String(depth));
  if (organizationId) next.searchParams.set("org", organizationId);
  try {
    await fetch(next, { headers: { "x-cron-secret": secret }, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.error("Failed to trigger next auto-review run", error);
  }
}
