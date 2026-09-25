import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { getProductAccess } from "@/lib/billing/access";
import type { OrgRole, Product, Role } from "@/generated/prisma/client";

/** Redirects to /login if unauthenticated, or /dashboard if authenticated but not in allowedRoles. */
export async function requireRole(allowedRoles: Role[]) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!allowedRoles.includes(session.user.role)) redirect("/clients");
  return session;
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

/**
 * Supportify tenancy guard: redirects to /login if unauthenticated. Every
 * CRM and QA route/query must go through this (or requireUser, which already
 * carries the same organizationId) — organizationId is the actual isolation
 * boundary between paying customers, independent of the CRM-specific `role`
 * hierarchy checked by requireRole.
 */
export async function requireOrg(allowedOrgRoles?: OrgRole[]) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (allowedOrgRoles && !allowedOrgRoles.includes(session.user.orgRole)) {
    redirect("/dashboard");
  }
  return session;
}

/**
 * Billing gate: requires an org (see requireOrg) AND an active/unexpired-trial
 * subscription for the given product. QA Sentinel and CRM are billed and
 * gated completely independently — an org can have one without the other.
 */
export async function requireProductAccess(product: Product) {
  const session = await requireOrg();

  const access = await getProductAccess(session.user.organizationId, product);
  if (!access.allowed) redirect(`/billing/${product}`);

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
