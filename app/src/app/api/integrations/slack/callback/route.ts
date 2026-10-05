import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { connectSlackChannel } from "@/lib/alerts/channels";
import { SLACK_STATE_COOKIE } from "@/lib/alerts/slack";

/** Slack redirects here after the admin picks a channel (or cancels). */
export async function GET(request: NextRequest) {
  const session = await requireRole(["ADMIN"]);
  const params = request.nextUrl.searchParams;

  const outcome = await connectSlackChannel(session.user, {
    code: params.get("code"),
    state: params.get("state"),
    expectedState: request.cookies.get(SLACK_STATE_COOKIE)?.value ?? null,
    error: params.get("error"),
  });

  const response = NextResponse.redirect(new URL(`/settings/alerts?slack=${outcome}`, request.url));
  response.cookies.delete({ name: SLACK_STATE_COOKIE, path: "/api/integrations/slack" });
  return response;
}
