import { after, NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/cron/auth";
import { pollAllOrganizations, processQueue } from "@/lib/qa/auto-review";
import { triggerAutoReviewRun } from "@/lib/qa/auto-review-trigger";

// Each run reviews for up to ~50s, then hands off to a fresh invocation so a
// large queue drains within per-function time limits (Vercel Hobby).
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

  // Respond at once; the work continues in the background for this invocation's max duration.
  after(async () => {
    if (depth === 0 && !organizationId) {
      console.log("auto-review poll", await pollAllOrganizations());
    }
    const result = await processQueue(WORK_BUDGET_MS, organizationId);
    console.log("auto-review run", { depth, organizationId, ...result });

    if (result.remaining > 0 && depth < MAX_CHAIN) {
      await triggerAutoReviewRun({ depth: depth + 1, organizationId });
    }
  });

  return NextResponse.json({ ok: true, depth }, { status: 202 });
}
