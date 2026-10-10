import { after, NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/cron/auth";
import { pollHelpdeskSources, processIngestJobs } from "@/lib/cx/ingest/helpdesk";
import { triggerCxWorker } from "@/lib/cx/ingest/trigger";

// Each run imports for up to ~50s, then hands off to a fresh invocation so a large backfill
// drains within per-function time limits (Vercel Hobby). Kicked by the cron tick.
export const maxDuration = 60;
const WORK_BUDGET_MS = 50_000;
const MAX_CHAIN = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const depth = Number(url.searchParams.get("depth") ?? 0);
  const organizationId = url.searchParams.get("org") ?? undefined;

  after(async () => {
    const poll = await pollHelpdeskSources(organizationId);
    const result = await processIngestJobs(WORK_BUDGET_MS, organizationId);
    console.log("cx-worker run", { depth, organizationId, poll, ...result });

    // Keep going while there is a backlog or another page of history to list; a rate-limited
    // helpdesk waits for the next tick instead.
    if ((result.remaining > 0 || poll.more) && !result.rateLimited && depth < MAX_CHAIN) {
      await triggerCxWorker({ depth: depth + 1, organizationId });
    }
  });

  return NextResponse.json({ ok: true, depth }, { status: 202 });
}
