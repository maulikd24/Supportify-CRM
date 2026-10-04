import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loginAction } from "@/app/login/actions";
import { signIn } from "@/lib/auth/config";
import { issueLoginChallenge, passesFirstFactor, verifyLoginChallenge } from "@/lib/auth/login-challenge";
import { createOrg, createUser, deleteOrgs, prisma } from "../helpers";

// The login action imports AuthError from next-auth, whose real module can't load outside Next.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));

/**
 * At the 2FA step of login, the form used to carry the user's plaintext password back to
 * the browser (in the action state and a hidden input). It now carries a signed,
 * short-lived challenge that only ever stands in for the password of a 2FA user.
 */

const PASSWORD = "correct-horse-battery-1";
let orgId: string;
let user: { id: string; email: string; passwordHash: string; twoFactorEnabled: boolean };

beforeAll(async () => {
  orgId = (await createOrg()).org.id;
  const u = await createUser(orgId);
  user = await prisma.user.update({
    where: { id: u.id },
    data: { passwordHash: await bcrypt.hash(PASSWORD, 4), twoFactorEnabled: true },
    select: { id: true, email: true, passwordHash: true, twoFactorEnabled: true },
  });
});
afterAll(() => deleteOrgs(orgId));
beforeEach(() => vi.mocked(signIn).mockReset());

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describe("login with 2FA", () => {
  it("never sends the password back to the browser at the 2FA step", async () => {
    const state = await loginAction({}, form({ email: user.email, password: PASSWORD }));

    expect(state.stage).toBe("2fa");
    expect(state.challenge).toEqual(expect.any(String));
    expect(JSON.stringify(state)).not.toContain(PASSWORD);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("completes sign-in with the challenge and code — no password", async () => {
    const { challenge } = await loginAction({}, form({ email: user.email, password: PASSWORD }));
    await loginAction({ stage: "2fa", email: user.email, challenge }, form({ email: user.email, challenge: challenge!, code: "123456" }));

    expect(signIn).toHaveBeenCalledWith("credentials", { email: user.email, challenge, code: "123456", redirectTo: "/dashboard" });
    expect(JSON.stringify(vi.mocked(signIn).mock.calls)).not.toContain(PASSWORD);
  });
});

describe("login challenge", () => {
  it("verifies for the user it was issued to, within its lifetime", () => {
    const c = issueLoginChallenge(user);
    expect(verifyLoginChallenge(c, user)).toBe(true);
  });

  it("rejects a tampered, foreign, expired or malformed challenge", () => {
    const c = issueLoginChallenge(user);
    const [id, exp, fp, sig] = c.split(".");
    expect(verifyLoginChallenge(`${id}.${Number(exp) + 3_600_000}.${fp}.${sig}`, user)).toBe(false); // extended expiry
    expect(verifyLoginChallenge(`${id}.${exp}.${fp}.${sig.slice(0, -2)}xx`, user)).toBe(false); // forged signature
    expect(verifyLoginChallenge(c, { ...user, id: "someone-else" })).toBe(false);
    expect(verifyLoginChallenge(c, user, Date.now() + 6 * 60_000)).toBe(false); // past the 5-minute lifetime
    expect(verifyLoginChallenge("not-a-challenge", user)).toBe(false);
  });

  it("is voided by a password change", () => {
    const c = issueLoginChallenge(user);
    expect(verifyLoginChallenge(c, { ...user, passwordHash: "$2a$04$a-different-hash" })).toBe(false);
  });
});

describe("first factor (what the Credentials provider checks before the 2FA code)", () => {
  it("accepts the right password, or a valid challenge for a 2FA user", async () => {
    expect(await passesFirstFactor(user, { password: PASSWORD })).toBe(true);
    expect(await passesFirstFactor(user, { password: "wrong" })).toBe(false);
    expect(await passesFirstFactor(user, { challenge: issueLoginChallenge(user) })).toBe(true);
  });

  it("never lets a challenge replace the password of an account without 2FA", async () => {
    const no2fa = { ...user, twoFactorEnabled: false };
    expect(await passesFirstFactor(no2fa, { challenge: issueLoginChallenge(no2fa) })).toBe(false);
  });

  it("rejects missing or non-string credentials", async () => {
    expect(await passesFirstFactor(user, {})).toBe(false);
    expect(await passesFirstFactor(user, { password: 123, challenge: "" })).toBe(false);
  });
});
