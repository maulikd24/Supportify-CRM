import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { getProductAccess } from "@/lib/billing/access";
import type { OrgRole, Product, Role } from "@/generated/prisma/client";

/** Where agent-portal logins (orgRole AGENT) are sent from anywhere else in the app. */
export const AGENT_HOME = "/portal";

/** Redirects to /login if unauthenticated, or /dashboard if authenticated but not in allowedRoles. */
export async function requireRole(allowedRoles: Role[]) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.orgRole === "AGENT") redirect(AGENT_HOME);
  if (!allowedRoles.includes(session.user.role)) redirect("/clients");
  return session;
}

/**
 * Any signed-in team member. Agent-portal logins are sent to the portal unless
 * `allowAgent` is set (only for self-service things: own account, own notifications).
 */
export async function requireUser(opts: { allowAgent?: boolean } = {}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.orgRole === "AGENT" && !opts.allowAgent) redirect(AGENT_HOME);
  return session;
}

/** Agent-portal pages and actions: only orgRole AGENT. */
export async function requireAgent() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.orgRole !== "AGENT") redirect("/");
  return session;
}

/**
 * Supportify tenancy guard: redirects to /login if unauthenticated. Every
 * CRM and QA route/query must go through this (or requireUser, which already
 * carries the same organizationId) — organizationId is the actual isolation
 * boundary between paying customers, independent of the CRM-specific `role`
 * hierarchy checked by requireRole.
 */
export async function requireOrg(allowedOrgRoles?: OrgRole[], opts: { allowAgent?: boolean } = {}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Agents never reach team pages (CRM, QA admin) unless explicitly allowed.
  if (session.user.orgRole === "AGENT" && !opts.allowAgent && !allowedOrgRoles?.includes("AGENT")) redirect(AGENT_HOME);
  if (allowedOrgRoles && !allowedOrgRoles.includes(session.user.orgRole)) {
    redirect("/dashboard");
  }
  return session;
}

/**
 * Billing gate: requires an org (see requireOrg) AND an active/unexpired-trial
 * subscription for the given product. QA Sentinel and CRM are billed and
 * gated completely independently — an org can have one without the other.
 *
 * Layouts only gate page renders — server actions are separately callable
 * endpoints, so every action for a paid product must call this itself too.
 */
export async function requireProductAccess(product: Product, allowedOrgRoles?: OrgRole[]) {
  const session = await requireOrg(allowedOrgRoles);

  const access = await getProductAccess(session.user.organizationId, product);
  if (!access.allowed) redirect(`/billing/${product}`);

  return session;
}

/**
 * CRM data actions (clients, tasks, journeys, pipeline settings): a signed-in user
 * whose org has active CRM access, matching the (dashboard) layout's gate. Layouts
 * only gate page renders, so these actions must check the subscription themselves.
 */
export async function requireCrmUser() {
  const session = await requireUser();
  const access = await getProductAccess(session.user.organizationId, "CRM");
  if (!access.allowed) redirect("/billing/CRM");
  return session;
}

/** requireRole + the CRM subscription check of requireCrmUser. */
export async function requireCrmRole(allowedRoles: Role[]) {
  const session = await requireRole(allowedRoles);
  const access = await getProductAccess(session.user.organizationId, "CRM");
  if (!access.allowed) redirect("/billing/CRM");
  return session;
}

/**
 * Supportify staff only. This is the one guard in the app that intentionally
 * sits outside the organizationId tenant boundary — everything reachable
 * behind it must stay aggregate/metadata-only (org names, plan/usage stats),
 * never a customer's client/ticket data. `isPlatformAdmin` is never settable
 * through any customer-reachable UI.
 */
export async function requirePlatformAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isPlatformAdmin) redirect("/");
  return session;
}
