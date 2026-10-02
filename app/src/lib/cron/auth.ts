/**
 * Scheduled-job auth. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`;
 * external schedulers (and the auto-review chain) may send `x-cron-secret`.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (
    request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret
  );
}
