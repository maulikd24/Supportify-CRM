import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { SLACK_STATE_COOKIE, slackAuthorizeUrl, slackConfigured } from "@/lib/alerts/slack";

/** Starts "Add to Slack": sends the admin to Slack's consent screen with a CSRF state bound to this browser. */
export async function GET(request: NextRequest) {
  await requireRole(["ADMIN"]);
  if (!slackConfigured()) return NextResponse.redirect(new URL("/settings/alerts?slack=unavailable", request.url));

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(slackAuthorizeUrl(state));
  response.cookies.set(SLACK_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent on Slack's top-level redirect back to us
    path: "/api/integrations/slack",
    maxAge: 600,
  });
  return response;
}
