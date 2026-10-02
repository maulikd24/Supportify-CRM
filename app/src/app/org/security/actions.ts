"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { SESSION_LIMIT_OPTIONS, enterpriseControlsAvailable } from "@/lib/security/policy";

const policySchema = z.object({
  require2fa: z.boolean(),
  requireSso: z.boolean(),
  sessionMaxHours: z
    .number()
    .int()
    .nullable()
    .refine((h) => h === null || (SESSION_LIMIT_OPTIONS as readonly number[]).includes(h), "Pick one of the session lengths"),
});

export const saveSecurityPoliciesAction = withUserErrors(async function saveSecurityPoliciesAction(
  input: z.input<typeof policySchema>,
) {
  const session = await requireOrg(["OWNER", "ADMIN"]);
  const organizationId = session.user.organizationId;
  const next = policySchema.parse(input);

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { require2fa: true, requireSso: true, sessionMaxHours: true, workosOrganizationId: true },
  });
  const current = { require2fa: org.require2fa, requireSso: org.requireSso, sessionMaxHours: org.sessionMaxHours };

  // Tightening needs an eligible plan; loosening is always allowed so a downgrade never traps an org.
  const tightening =
    (next.require2fa && !current.require2fa) ||
    (next.requireSso && !current.requireSso) ||
    (next.sessionMaxHours !== null && next.sessionMaxHours !== current.sessionMaxHours);
  if (tightening && !(await enterpriseControlsAvailable(organizationId))) {
    throw new UserError("Security policies are available on Scale and Enterprise plans. Upgrade in Billing to turn them on.");
  }
  if (next.requireSso && !org.workosOrganizationId) {
    throw new UserError("Set up single sign-on first, then you can require it.");
  }

  await prisma.organization.update({ where: { id: organizationId }, data: next });
  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "Organization",
    entityId: organizationId,
    action: "security.policy_changed",
    oldValue: current,
    newValue: next,
  });
  revalidatePath("/org/security");
});

/** Ends every session in the organization (including the caller's) — e.g. after a suspected compromise. */
export const signOutAllDevicesAction = withUserErrors(async function signOutAllDevicesAction() {
  const session = await requireOrg(["OWNER", "ADMIN"]);
  const organizationId = session.user.organizationId;
  await prisma.organization.update({ where: { id: organizationId }, data: { sessionsRevokedAt: new Date() } });
  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "Organization",
    entityId: organizationId,
    action: "auth.sessions_revoked",
  });
});
