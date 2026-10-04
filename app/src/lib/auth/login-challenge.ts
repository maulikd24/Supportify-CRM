import { createHash, createHmac, timingSafeEqual } from "crypto";

import bcrypt from "bcryptjs";

/**
 * Proof that a user just entered the right password, carried from the password
 * step to the 2FA step of login in place of the password itself (which would
 * otherwise round-trip through the browser in the form state).
 *
 * Signed with the NextAuth secret, expires after a few minutes, and is bound to
 * the user's current password hash — changing the password voids it. On its
 * own it can't sign anyone in: it only ever stands in for the password, and the
 * Credentials provider still requires a valid 2FA code alongside it.
 */

const TTL_MS = 5 * 60 * 1000;

type ChallengeUser = { id: string; passwordHash: string };

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("base64url").slice(0, 16);
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`login-2fa:${payload}`).digest("base64url");
}

export function issueLoginChallenge(user: ChallengeUser, now = Date.now()): string {
  const payload = `${user.id}.${now + TTL_MS}.${passwordFingerprint(user.passwordHash)}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * The Credentials provider's first factor: the password, or — for a 2FA user only — a
 * challenge from the password step. A challenge never satisfies login for an account
 * without 2FA, since the second factor is what makes it safe to skip the password.
 */
export async function passesFirstFactor(
  user: ChallengeUser & { twoFactorEnabled: boolean },
  input: { password?: unknown; challenge?: unknown },
): Promise<boolean> {
  if (typeof input.challenge === "string" && input.challenge) {
    return user.twoFactorEnabled && verifyLoginChallenge(input.challenge, user);
  }
  if (typeof input.password === "string") return bcrypt.compare(input.password, user.passwordHash);
  return false;
}

export function verifyLoginChallenge(challenge: string, user: ChallengeUser, now = Date.now()): boolean {
  const parts = challenge.split(".");
  if (parts.length !== 4) return false;
  const [userId, expiresAt, fingerprint, signature] = parts;

  const expected = Buffer.from(sign(`${userId}.${expiresAt}.${fingerprint}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

  return userId === user.id && Number(expiresAt) > now && fingerprint === passwordFingerprint(user.passwordHash);
}
