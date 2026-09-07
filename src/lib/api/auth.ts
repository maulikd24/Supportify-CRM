import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { hashApiKey } from "@/lib/security/api-keys";
import { getProductAccess } from "@/lib/billing/access";
import type { Product } from "@/generated/prisma/client";

export type ApiAuthResult = { organizationId: string; apiKeyId: string; createdById: string };

/** Authenticates a `/api/v1/*` request via `Authorization: Bearer sk_live_...`. Returns null (caller responds 401) on any failure. */
export async function authenticateApiKey(request: Request): Promise<ApiAuthResult | null> {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;

  const key = await prisma.apiKey.findUnique({ where: { hashedKey: hashApiKey(token) } });
  if (!key || key.revokedAt) return null;

  // Best-effort — a slow write here should never block or fail the actual request.
  void prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  // Attributed to whichever user generated the key — actions that require a real
  // User row (stage history, audit log) need a genuine actor, not a synthetic one.
  return { organizationId: key.organizationId, apiKeyId: key.id, createdById: key.createdById };
}

export function unauthorized(message = "Invalid or missing API key"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/** Gates a product-specific endpoint on that org actually having active (or unexpired-trial) access — same rule as the app's own UI. */
export async function requireApiProductAccess(organizationId: string, product: Product): Promise<NextResponse | null> {
  const access = await getProductAccess(organizationId, product);
  if (!access.allowed) {
    return NextResponse.json(
      { error: `This organization does not have active access to ${product}` },
      { status: 403 },
    );
  }
  return null;
}
