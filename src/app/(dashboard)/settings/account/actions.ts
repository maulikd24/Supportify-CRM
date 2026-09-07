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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function changeOwnPasswordAction(formData: FormData) {
  const session = await requireUser();

  const parsed = changePasswordSchema.parse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

  const valid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
  if (!valid) throw new Error("Current password is incorrect");

  const passwordHash = await bcrypt.hash(parsed.newPassword, 10);
  await prisma.user.update({ where: { id: session.user.id }, data: { passwordHash } });
}

/** Starts (or restarts) 2FA setup: generates a fresh secret and stores it encrypted, but leaves twoFactorEnabled false until the user proves possession via confirmTwoFactorSetupAction. */
export async function startTwoFactorSetupAction() {
  const session = await requireUser();

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { twoFactorSecret: encryptJson(secret), twoFactorEnabled: false, twoFactorRecoveryCodes: Prisma.JsonNull },
  });

  const qrDataUrl = await totpQrDataUrl(session.user.email, secret);
  return { secret, qrDataUrl };
}

const confirmSchema = z.object({ code: z.string().min(6).max(6) });

/** Verifies the first code from the authenticator app, then enables 2FA and issues one-time recovery codes (shown to the user exactly once). */
export async function confirmTwoFactorSetupAction(formData: FormData) {
  const session = await requireUser();

  const parsed = confirmSchema.parse({ code: formData.get("code") });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  if (!user.twoFactorSecret) throw new Error("Start two-factor setup first");

  const secret = decryptJson<string>(user.twoFactorSecret);
  if (!verifyTotpToken(secret, parsed.code)) throw new Error("Invalid code — check your authenticator app and try again");

  const recoveryCodes = generateRecoveryCodes();
  const hashed = await hashRecoveryCodes(recoveryCodes);

  await prisma.user.update({
    where: { id: session.user.id },
    data: { twoFactorEnabled: true, twoFactorRecoveryCodes: hashed },
  });

  return { recoveryCodes };
}

const disableSchema = z.object({ currentPassword: z.string().min(1) });

export async function disableTwoFactorAction(formData: FormData) {
  const session = await requireUser();

  const parsed = disableSchema.parse({ currentPassword: formData.get("currentPassword") });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  const valid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
  if (!valid) throw new Error("Current password is incorrect");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: Prisma.JsonNull },
  });
}

export async function regenerateRecoveryCodesAction(formData: FormData) {
  const session = await requireUser();

  const parsed = disableSchema.parse({ currentPassword: formData.get("currentPassword") });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  if (!user.twoFactorEnabled) throw new Error("Two-factor authentication is not enabled");
  const valid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
  if (!valid) throw new Error("Current password is incorrect");

  const recoveryCodes = generateRecoveryCodes();
  const hashed = await hashRecoveryCodes(recoveryCodes);
  await prisma.user.update({ where: { id: session.user.id }, data: { twoFactorRecoveryCodes: hashed } });

  return { recoveryCodes };
}
