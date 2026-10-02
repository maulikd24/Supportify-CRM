import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setUserRoleAction } from "@/app/(dashboard)/settings/users/actions";
import { saveSecurityPoliciesAction, signOutAllDevicesAction } from "@/app/org/security/actions";
import { saveOverageSettingsAction } from "@/app/qa/settings/auto-review-actions";
import { GET as exportAuditLog } from "@/app/org/audit-log/export/route";
import { asUser, createOrg, createUser, deleteOrgs, isRedirect, prisma, signedOut } from "../helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let orgId: string, starterOrg: string, owner: U, member: U, rm: U, starterOwner: U;

beforeAll(async () => {
  orgId = (await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }, { product: "QA_SENTINEL", planId: "scale", reviewQuota: 2000 }] })).org.id;
  owner = await createUser(orgId);
  member = await createUser(orgId, { role: "MANAGER", orgRole: "MEMBER" });
  rm = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
  starterOrg = (await createOrg({ products: [{ product: "CRM", planId: "starter", seats: 5 }] })).org.id;
  starterOwner = await createUser(starterOrg);
});
afterAll(() => deleteOrgs(orgId, starterOrg));

async function expectRedirect(p: Promise<unknown>) {
  const error = await p.then(() => null, (e) => e);
  expect(isRedirect(error)).toBe(true);
}

describe("role checks", () => {
  it("signed-out callers are sent to login", async () => {
    signedOut();
    await expectRedirect(setUserRoleAction(rm.id, "ADMIN"));
  });

  it("only CRM admins can change roles", async () => {
    asUser(rm);
    await expectRedirect(setUserRoleAction(rm.id, "ADMIN"));
    asUser(member);
    await expectRedirect(setUserRoleAction(rm.id, "ADMIN"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rm.id } })).role).toBe("RM");
  });

  it("only org owners/admins can change security policies, overages or sign everyone out", async () => {
    asUser(member);
    await expectRedirect(saveSecurityPoliciesAction({ require2fa: true, requireSso: false, sessionMaxHours: null }));
    await expectRedirect(saveOverageSettingsAction({ allowOverage: true, overageCap: 10 }));
    await expectRedirect(signOutAllDevicesAction());
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect([org.require2fa, org.sessionsRevokedAt]).toEqual([false, null]);
  });

  it("members can't export the audit log", async () => {
    asUser(member);
    expect((await exportAuditLog(new Request("http://test/org/audit-log/export"))).status).toBe(403);
  });
});

describe("plan gating", () => {
  it("Starter orgs can't turn on security policies or export the audit log", async () => {
    asUser(starterOwner);
    const result = await saveSecurityPoliciesAction({ require2fa: true, requireSso: false, sessionMaxHours: null });
    expect(result).toEqual({ __actionError: expect.stringMatching(/Scale and Enterprise/) });
    expect((await exportAuditLog(new Request("http://test/org/audit-log/export"))).status).toBe(403);
  });

  it("Scale orgs can, the change is audited, and SSO can't be required before it's set up", async () => {
    asUser(owner);
    expect(await saveSecurityPoliciesAction({ require2fa: true, requireSso: false, sessionMaxHours: 8 })).toBeUndefined();
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect([org.require2fa, org.sessionMaxHours]).toEqual([true, 8]);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "security.policy_changed" } })).toBe(1);
    const sso = await saveSecurityPoliciesAction({ require2fa: true, requireSso: true, sessionMaxHours: 8 });
    expect(sso).toEqual({ __actionError: expect.stringMatching(/Set up single sign-on first/) });
  });

  it("anyone can loosen policies after a downgrade", async () => {
    await prisma.organization.update({ where: { id: starterOrg }, data: { require2fa: true } });
    asUser(starterOwner);
    expect(await saveSecurityPoliciesAction({ require2fa: false, requireSso: false, sessionMaxHours: null })).toBeUndefined();
  });
});
