import { prisma } from "@/lib/db/prisma";
import type { TicketRequester } from "@/lib/qa/helpdesks/types";

/**
 * Matching QA Sentinel tickets to CRM clients, always within one organization.
 *  1. An admin's RequesterLink for the requester's email, then phone, decides outright
 *     (a link with clientId null means "this requester is not a client").
 *  2. Otherwise exactly one client with the same email, or else exactly one with the same
 *     phone number. Ambiguous matches (two clients share it) link nothing.
 */

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+$/.test(e) ? e : null;
}

/** Digits only; at least 7 so stray short numbers never match anything. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 7 ? digits : null;
}

/** The part of a phone number compared: the last 10 digits, so "+91 98000 11111" matches "9800011111". */
export function phoneKey(digits: string): string {
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export type NormalizedRequester = { name: string | null; email: string | null; phone: string | null };

export function normalizeRequester(r: TicketRequester | undefined): NormalizedRequester {
  return { name: r?.name?.trim() || null, email: normalizeEmail(r?.email), phone: normalizePhone(r?.phone) };
}

/** The client a requester's tickets belong to, or null. `undefined` link = no admin decision. */
export async function resolveClient(organizationId: string, requester: NormalizedRequester): Promise<string | null> {
  for (const [kind, value] of [["email", requester.email], ["phone", requester.phone]] as const) {
    if (!value) continue;
    const link = await prisma.requesterLink.findUnique({
      where: { organizationId_kind_value: { organizationId, kind, value } },
      select: { clientId: true },
    });
    if (link) return link.clientId;
  }

  if (requester.email) {
    const byEmail = await prisma.client.findMany({
      where: { organizationId, email: { equals: requester.email, mode: "insensitive" } },
      select: { id: true },
      take: 2,
    });
    if (byEmail.length === 1) return byEmail[0].id;
    if (byEmail.length > 1) return null;
  }
  if (requester.phone) {
    const key = phoneKey(requester.phone);
    const byPhone = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Client"
      WHERE "organizationId" = ${organizationId}
        AND right(regexp_replace(mobile, '\\D', '', 'g'), 10) = ${key}
      LIMIT 2`;
    if (byPhone.length === 1) return byPhone[0].id;
  }
  return null;
}

/** Stores the requester on a new review and links it to its client, if one matches. */
export async function linkNewReview(review: { id: string; organizationId: string }, requester: TicketRequester | undefined): Promise<string | null> {
  const r = normalizeRequester(requester);
  if (!r.email && !r.phone) return null;
  const clientId = await resolveClient(review.organizationId, r);
  await prisma.ticketReview.update({
    where: { id: review.id },
    data: { requesterName: r.name, requesterEmail: r.email, requesterPhone: r.phone, clientId, clientLinkedBy: clientId ? "auto" : null },
  });
  return clientId;
}

/**
 * An admin's decision for every ticket from this requester (by the identifiers the review has):
 * link them to `clientId`, or (null) to no client. Applies to past reviews and future ones.
 * Returns the clients whose linked reviews changed, so their support health can be re-checked.
 */
export async function setRequesterClient(
  admin: { id: string; organizationId: string },
  identity: { email: string | null; phone: string | null },
  clientId: string | null,
): Promise<string[]> {
  const organizationId = admin.organizationId;
  const identifiers = [
    ...(identity.email ? [{ kind: "email", value: identity.email }] : []),
    ...(identity.phone ? [{ kind: "phone", value: identity.phone }] : []),
  ];
  if (identifiers.length === 0) return [];

  const match = {
    organizationId,
    OR: [
      ...(identity.email ? [{ requesterEmail: identity.email }] : []),
      ...(identity.phone ? [{ requesterPhone: identity.phone }] : []),
    ],
  };
  const before = await prisma.ticketReview.findMany({ where: { ...match, clientId: { not: null } }, select: { clientId: true }, distinct: ["clientId"] });

  await prisma.$transaction([
    ...identifiers.map(({ kind, value }) =>
      prisma.requesterLink.upsert({
        where: { organizationId_kind_value: { organizationId, kind, value } },
        create: { organizationId, kind, value, clientId, createdById: admin.id },
        update: { clientId, createdById: admin.id },
      }),
    ),
    prisma.ticketReview.updateMany({ where: match, data: { clientId, clientLinkedBy: clientId ? "manual" : null } }),
  ]);

  return [...new Set([...before.map((b) => b.clientId!), ...(clientId ? [clientId] : [])])];
}
