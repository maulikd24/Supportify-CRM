import { randomBytes } from "crypto";

import { authenticator } from "otplib";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";

const ISSUER = "Supportify";
const RECOVERY_CODE_COUNT = 8;

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export async function totpQrDataUrl(email: string, secret: string): Promise<string> {
  const uri = authenticator.keyuri(email, ISSUER, secret);
  return QRCode.toDataURL(uri);
}

export function verifyTotpToken(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

/** Human-friendly one-time recovery codes, e.g. "8F3K-9QWX". Store only their bcrypt hashes. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => bcrypt.hash(code, 10)));
}

/** Checks `code` against the stored hashes; returns the remaining hash list with the matched one removed, or null if no match. */
export async function consumeRecoveryCode(hashes: string[], code: string): Promise<string[] | null> {
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(code, hashes[i])) {
      return [...hashes.slice(0, i), ...hashes.slice(i + 1)];
    }
  }
  return null;
}
