"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { Prisma } from "@/generated/prisma/client";
import { encryptJson, decryptJson } from "@/lib/security/crypto";
import {
  generateTotpSecret,
  totpQrDataUrl,
  verifyTotpToken,
  generateRecoveryCodes,
  hashRecoveryCodes,
} from "@/lib/security/two-factor";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { recordAudit } from "@/lib/audit/record";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export const changeOwnPasswordAction = withUserErrors(async function changeOwnPasswordAction(formData: FormData) {
  const session = await requireUser({ allowAgent: true });

  const parsed = changePasswordSchema.parse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

  const valid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
  if (!valid) throw new UserError("Current password is incorrect");

  const passwordHash = await bcrypt.hash(parsed.newPassword, 10);
  // End every session, this one included: a changed password must lock out
  // anyone holding an old session. (Keeping just the current one would mean
  // trusting NextAuth's client-callable session update to bump authTime.) The
  // form sends the user to /login; their revoked session is rejected anyway.
  await prisma.user.update({ where: { id: session.user.id }, data: { passwordHash, sessionsRevokedAt: new Date() } });
  await recordAudit({ organizationId: user.organizationId, userId: user.id, entity: "User", entityId: user.id, action: "auth.password_changed" });
});

/** Starts (or restarts) 2FA setup: generates a fresh secret and stores it encrypted, but leaves twoFactorEnabled false until the user proves possession via confirmTwoFactorSetupAction. */
export const startTwoFactorSetupAction = withUserErrors(async function startTwoFactorSetupAction() {
  const session = await requireUser({ allowAgent: true });

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { twoFactorSecret: encryptJson(secret), twoFactorEnabled: false, twoFactorRecoveryCodes: Prisma.JsonNull },
  });

  const qrDataUrl = await totpQrDataUrl(session.user.email, secret);
  return { secret, qrDataUrl };
});

const confirmSchema = z.object({ code: z.string().min(6).max(6) });

/** Verifies the first code from the authenticator app, then enables 2FA and issues one-time recovery codes (shown to the user exactly once). */
export const confirmTwoFactorSetupAction = withUserErrors(async function confirmTwoFactorSetupAction(formData: FormData) {
  const session = await requireUser({ allowAgent: true });

  const parsed = confirmSchema.parse({ code: formData.get("code") });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  if (!user.twoFactorSecret) throw new UserError("Start two-factor setup first");

  const secret = decryptJson<string>(user.twoFactorSecret);
  if (!verifyTotpToken(secret, parsed.code)) throw new UserError("Invalid code — check your authenticator app and try again");

  const recoveryCodes = generateRecoveryCodes();
  const hashed = await hashRecoveryCodes(recoveryCodes);

  await prisma.user.update({
    where: { id: session.user.id },
    data: { twoFactorEnabled: true, twoFactorRecoveryCodes: hashed },
  });
  await recordAudit({ organizationId: user.organizationId, userId: user.id, entity: "User", entityId: user.id, action: "auth.2fa_enabled" });

  return { recoveryCodes };
});

const disableSchema = z.object({ currentPassword: z.string().min(1) });

export const disableTwoFactorAction = withUserErrors(async function disableTwoFactorAction(formData: FormData) {
  const session = await requireUser({ allowAgent: true });

  const parsed = disableSchema.parse({ currentPassword: formData.get("currentPassword") });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    include: { organization: { select: { require2fa: true } } },
  });
  if (user.organization.require2fa) {
    throw new UserError("Your organization requires two-factor authentication, so it can't be turned off.");
  }
  const valid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
  if (!valid) throw new UserError("Current password is incorrect");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: Prisma.JsonNull },
  });
  await recordAudit({ organizationId: user.organizationId, userId: user.id, entity: "User", entityId: user.id, action: "auth.2fa_disabled" });
});

export const regenerateRecoveryCodesAction = withUserErrors(async function regenerateRecoveryCodesAction(formData: FormData) {
  const session = await requireUser({ allowAgent: true });

  const parsed = disableSchema.parse({ currentPassword: formData.get("currentPassword") });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  if (!user.twoFactorEnabled) throw new UserError("Two-factor authentication is not enabled");
  const valid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
  if (!valid) throw new UserError("Current password is incorrect");

  const recoveryCodes = generateRecoveryCodes();
  const hashed = await hashRecoveryCodes(recoveryCodes);
  await prisma.user.update({ where: { id: session.user.id }, data: { twoFactorRecoveryCodes: hashed } });

  return { recoveryCodes };
});
