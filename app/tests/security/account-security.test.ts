import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  resetUserPasswordAction,
  setUserActiveAction,
  setUserManagerAction,
  setUserRoleAction,
  signOutUserAction,
} from "@/app/(dashboard)/settings/users/actions";
import { changeOwnPasswordAction } from "@/app/org/account/actions";
import { resetPasswordAction } from "@/app/reset-password/[token]/actions";
import { consumeVerificationToken, issueVerificationToken } from "@/lib/auth/verification-tokens";
import { asUser, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let orgId: string;
let owner: U, orgAdmin: U, crmAdmin: U, rm: U;

beforeAll(async () => {
  orgId = (await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] })).org.id;
  owner = await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" });
  orgAdmin = await createUser(orgId, { role: "ADMIN", orgRole: "ADMIN" });
  // A CRM admin who is only an org MEMBER: passes requireRole(["ADMIN"]) but must not reach owners.
  crmAdmin = await createUser(orgId, { role: "ADMIN", orgRole: "MEMBER" });
  rm = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
});
afterAll(() => deleteOrgs(orgId));

const snapshot = (id: string) =>
  prisma.user.findUniqueOrThrow({ where: { id }, select: { role: true, isActive: true, passwordHash: true, managerId: true, sessionsRevokedAt: true } });

describe("a CRM admin can't take over a higher org role's account", () => {
  it.each([
    ["the owner", () => owner],
    ["an org admin", () => orgAdmin],
  ])("a member-level CRM admin can't change %s's password, role, status, manager or sessions", async (_, target) => {
    asUser(crmAdmin);
    const before = await snapshot(target().id);

    for (const attempt of [
      () => resetUserPasswordAction(target().id, "attacker-password"),
      () => setUserRoleAction(target().id, "RM"),
      () => setUserActiveAction(target().id, false),
      () => setUserManagerAction(target().id, crmAdmin.id),
      () => signOutUserAction(target().id),
    ]) {
      expect(await attempt()).toEqual({ __actionError: expect.stringMatching(/owner|higher organization role/) });
    }
    expect(await snapshot(target().id)).toEqual(before);
  });

  it("can still manage users at or below their own org role", async () => {
    asUser(crmAdmin);
    expect(await setUserRoleAction(rm.id, "MANAGER")).toBeUndefined();
    expect((await snapshot(rm.id)).role).toBe("MANAGER");
  });

  it("an owner can still manage an org admin", async () => {
    asUser(owner);
    expect(await setUserRoleAction(orgAdmin.id, "MANAGER")).toBeUndefined();
  });
});

describe("password changes end existing sessions", () => {
  it("an admin password reset revokes the user's sessions", async () => {
    asUser(owner);
    const before = Date.now();
    await resetUserPasswordAction(rm.id, "new-password-123");
    expect((await snapshot(rm.id)).sessionsRevokedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("changing your own password revokes your sessions", async () => {
    const user = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await (await import("bcryptjs")).default.hash("old-password-1", 4) } });
    asUser(user);
    const before = Date.now();
    const form = new FormData();
    form.append("currentPassword", "old-password-1");
    form.append("newPassword", "new-password-1");
    expect(await changeOwnPasswordAction(form)).toBeUndefined();
    expect((await snapshot(user.id)).sessionsRevokedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("a forgot-password reset revokes the user's sessions", async () => {
    const user = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
    const token = await issueVerificationToken(user.id, "PASSWORD_RESET");
    const before = Date.now();
    const form = new FormData();
    form.append("password", "reset-password-1");
    expect(await resetPasswordAction(token, {}, form)).toEqual({ success: true });
    expect((await snapshot(user.id)).sessionsRevokedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("single-use tokens", () => {
  it("can be consumed exactly once, even by concurrent requests", async () => {
    const token = await issueVerificationToken(rm.id, "PASSWORD_RESET");
    const results = await Promise.all(Array.from({ length: 8 }, () => consumeVerificationToken(token, "PASSWORD_RESET")));
    expect(results.filter(Boolean)).toEqual([{ userId: rm.id }]);
    expect(await consumeVerificationToken(token, "PASSWORD_RESET")).toBeNull();
  });

  it("rejects a token presented for a different purpose, without burning it", async () => {
    const token = await issueVerificationToken(rm.id, "EMAIL_VERIFY");
    expect(await consumeVerificationToken(token, "PASSWORD_RESET")).toBeNull();
    expect(await consumeVerificationToken(token, "EMAIL_VERIFY")).toEqual({ userId: rm.id });
  });

  it("rejects an expired token", async () => {
    const token = await issueVerificationToken(rm.id, "PASSWORD_RESET");
    await prisma.verificationToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await consumeVerificationToken(token, "PASSWORD_RESET")).toBeNull();
  });
});
