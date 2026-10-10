"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireProductAccess } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { CX_TRIAL_BACKFILL_DAYS } from "@/lib/billing/plans";
import { getHelpdeskProvider, isHelpdeskProvider } from "@/lib/qa/helpdesks";
import { triggerCxWorker } from "@/lib/cx/ingest/trigger";
import { BACKFILL_DAYS } from "@/lib/cx/settings-shared";

const PATH = "/cx/sources";
const admin = () => requireProductAccess("CX_INTELLIGENCE", ["OWNER", "ADMIN"]);

/** Starts importing the org's connected helpdesk: history back to `backfillDays`, then new tickets as they're solved. */
export const startHelpdeskImportAction = withUserErrors(async function startHelpdeskImportAction(backfillDays: number) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const days = z.number().int().refine((d) => (BACKFILL_DAYS as readonly number[]).includes(d), "Pick how far back to import").parse(backfillDays);

  const connection = await prisma.helpdeskConnection.findUnique({ where: { organizationId } });
  if (!connection || !isHelpdeskProvider(connection.provider)) throw new UserError("Connect your helpdesk first");
  if (!connection.isValid) throw new UserError("The helpdesk connection needs attention. Test it again first.");

  const sub = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product: "CX_INTELLIGENCE" } },
    select: { status: true },
  });
  const effectiveDays = sub?.status === "TRIALING" ? Math.min(days, CX_TRIAL_BACKFILL_DAYS) : days;
  const backfillFrom = new Date(Date.now() - effectiveDays * 24 * 60 * 60 * 1000);

  const existing = await prisma.cxSource.findUnique({ where: { organizationId_provider: { organizationId, provider: connection.provider } } });
  if (existing && existing.status !== "paused") throw new UserError("This helpdesk is already being imported");
  const label = `${getHelpdeskProvider(connection.provider).name} · ${connection.accountLabel}`;
  const source = existing
    ? // Reconnecting the same helpdesk carries on from where the import stopped.
      await prisma.cxSource.update({ where: { id: existing.id }, data: { status: "active", lastError: null, label } })
    : await prisma.cxSource.create({ data: { organizationId, type: "HELPDESK", provider: connection.provider, label, backfillFrom } });

  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "CxSource",
    entityId: source.id,
    action: existing ? "cx.source_resumed" : "cx.source_connected",
    newValue: { provider: connection.provider, backfillDays: existing ? null : effectiveDays },
  });
  await triggerCxWorker({ organizationId });
  revalidatePath(PATH);
  return { backfillDays: effectiveDays };
});

async function ownSource(organizationId: string, sourceId: string) {
  const source = await prisma.cxSource.findFirst({ where: { id: sourceId, organizationId } });
  if (!source) throw new UserError("Source not found");
  return source;
}

export const pauseSourceAction = withUserErrors(async function pauseSourceAction(sourceId: string) {
  const session = await admin();
  const source = await ownSource(session.user.organizationId, sourceId);
  await prisma.cxSource.update({ where: { id: source.id }, data: { status: "paused", lastError: null } });
  await recordAudit({ organizationId: source.organizationId, userId: session.user.id, entity: "CxSource", entityId: source.id, action: "cx.source_paused" });
  revalidatePath(PATH);
});

/** Stops importing from a source for good. Conversations already imported are kept. */
export const removeSourceAction = withUserErrors(async function removeSourceAction(sourceId: string) {
  const session = await admin();
  const source = await ownSource(session.user.organizationId, sourceId);
  await prisma.cxSource.delete({ where: { id: source.id } });
  await recordAudit({ organizationId: source.organizationId, userId: session.user.id, entity: "CxSource", entityId: source.id, action: "cx.source_removed", oldValue: { provider: source.provider } });
  revalidatePath(PATH);
});
