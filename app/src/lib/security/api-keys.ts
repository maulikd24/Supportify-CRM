import { randomBytes, createHash } from "crypto";

const PREFIX = "sk_live_";

/** Generates a new raw API key and its indexable hash. The raw value is shown to the user exactly once. */
export function generateApiKey(): { raw: string; keyPrefix: string; hashedKey: string } {
  const raw = `${PREFIX}${randomBytes(24).toString("hex")}`;
  return { raw, keyPrefix: raw.slice(0, PREFIX.length + 8), hashedKey: hashApiKey(raw) };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
