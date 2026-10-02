import { prisma } from "@/lib/db/prisma";
import type { OrgRole } from "@/generated/prisma/client";

/** Plans that include enterprise controls (audit export, security policies). */
const ELIGIBLE_PLANS = ["scale", "enterprise"];

/** Session length choices offered to admins, in hours (8h, 24h, 7d, 30d). */
export const SESSION_LIMIT_OPTIONS = [8, 24, 24 * 7, 24 * 30] as const;

export function sessionLimitLabel(hours: number): string {
  if (hours < 24) return `${hours} hours`;
  const days = hours / 24;
  return days === 1 ? "24 hours" : `${days} days`;
}

/**
 * Enterprise controls are available when any of the org's products is on Scale
 * or Enterprise, or on a live trial (so prospects can evaluate them).
 */
export async function enterpriseControlsAvailable(organizationId: string): Promise<boolean> {
  const subs = await prisma.productSubscription.findMany({
    where: { organizationId },
    select: { status: true, planId: true, trialEndsAt: true },
  });
  const now = new Date();
  return subs.some(
    (s) =>
      (s.status === "TRIALING" && s.trialEndsAt != null && s.trialEndsAt > now) ||
      ((s.status === "ACTIVE" || s.status === "PAST_DUE") && s.planId != null && ELIGIBLE_PLANS.includes(s.planId)),
  );
}

export type AuthMethod = "password" | "sso" | "google" | "unknown";

export type SessionPolicyInput = {
  authTime: number; // ms epoch when this session signed in
  authMethod: AuthMethod;
  orgRole: OrgRole;
  userSessionsRevokedAt: Date | null;
  org: { sessionMaxHours: number | null; sessionsRevokedAt: Date | null; requireSso: boolean };
};

/**
 * Whether an existing session may continue. Checked on every request (in the
 * NextAuth jwt callback), so policy changes and "sign out" take effect at once.
 * The owner is exempt from "require SSO" so a broken SSO setup can't lock the
 * organization out.
 */
export function sessionAllowed(input: SessionPolicyInput, now = Date.now()): boolean {
  if (input.userSessionsRevokedAt && input.authTime < input.userSessionsRevokedAt.getTime()) return false;
  if (input.org.sessionsRevokedAt && input.authTime < input.org.sessionsRevokedAt.getTime()) return false;
  if (input.org.sessionMaxHours != null && now - input.authTime > input.org.sessionMaxHours * 3_600_000) return false;
  if (input.org.requireSso && input.authMethod !== "sso" && input.orgRole !== "OWNER") return false;
  return true;
}

/** Password/Google sign-in is refused for non-owners when the org requires SSO. */
export function ssoRequiredFor(org: { requireSso: boolean }, orgRole: OrgRole): boolean {
  return org.requireSso && orgRole !== "OWNER";
}
