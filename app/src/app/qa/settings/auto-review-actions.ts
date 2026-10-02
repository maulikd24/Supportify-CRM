"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { pollOrganization } from "@/lib/qa/auto-review";
import { triggerAutoReviewRun } from "@/lib/qa/auto-review-trigger";
import { ensureOverageSubscriptionItem, overageAvailability } from "@/lib/qa/usage";

const ADMIN_ROLES = ["OWNER", "ADMIN"] as const;
const CHECK_NOW_COOLDOWN_MS = 5 * 60 * 1000;

function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 25);
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  sopId: z.string().min(1).nullable(),
  samplePercent: z.number().int().min(0).max(100),
  alwaysReviewBadCsat: z.boolean(),
  includeTags: z.string().max(500),
  excludeTags: z.string().max(500),
});

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function saveAutoReviewSettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const session = await requireOrg([...ADMIN_ROLES]);
  const organizationId = session.user.organizationId;
  const result = settingsSchema.safeParse(input);
  if (!result.success) return { ok: false, error: "Check the auto-review settings and try again" };
  const parsed = result.data;

  if (parsed.sopId) {
    const sop = await prisma.sopDocument.findUnique({ where: { id: parsed.sopId, organizationId }, select: { id: true } });
    if (!sop) return { ok: false, error: "Pick one of your SOPs" };
  }
  if (parsed.enabled) {
    const [connection, sopCount] = await Promise.all([
      prisma.zendeskConnection.findUnique({ where: { organizationId }, select: { isValid: true } }),
      prisma.sopDocument.count({ where: { organizationId } }),
    ]);
    if (!connection?.isValid) return { ok: false, error: "Connect Zendesk (and pass the connection test) before turning on auto-review" };
    if (sopCount === 0) return { ok: false, error: "Add at least one SOP before turning on auto-review" };
  }

  const data = {
    enabled: parsed.enabled,
    sopId: parsed.sopId,
    samplePercent: parsed.samplePercent,
    alwaysReviewBadCsat: parsed.alwaysReviewBadCsat,
    includeTags: parseTags(parsed.includeTags),
    excludeTags: parseTags(parsed.excludeTags),
  };
  await prisma.autoReviewConfig.upsert({
    where: { organizationId },
    update: data,
    create: { organizationId, ...data },
  });

  revalidatePath("/qa/settings");
  return { ok: true };
}

const overageSchema = z.object({
  allowOverage: z.boolean(),
  overageCap: z.number().int().min(1).max(100_000).nullable(),
});

export async function saveOverageSettingsAction(input: z.input<typeof overageSchema>): Promise<ActionResult> {
  const session = await requireOrg([...ADMIN_ROLES]);
  const organizationId = session.user.organizationId;
  const result = overageSchema.safeParse(input);
  if (!result.success) return { ok: false, error: "Enter a cap between 1 and 100,000, or leave it empty" };
  const parsed = result.data;

  const sub = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } },
  });
  if (!sub) return { ok: false, error: "QA Sentinel isn't active for your organization" };

  if (parsed.allowOverage) {
    const availability = overageAvailability(sub);
    if (!availability.available) return { ok: false, error: availability.reason ?? "Overages aren't available on your plan" };
    try {
      await ensureOverageSubscriptionItem(sub.stripeSubscriptionId!);
    } catch (error) {
      console.error("Failed to attach overage price to subscription", { organizationId, error });
      return { ok: false, error: "Couldn't turn on overage billing right now. Please try again, or contact support." };
    }
  }

  await prisma.productSubscription.update({
    where: { id: sub.id },
    data: { allowOverage: parsed.allowOverage, overageCap: parsed.overageCap },
  });

  revalidatePath("/qa/settings");
  revalidatePath("/qa");
  return { ok: true };
}

/** Checks Zendesk for newly solved tickets right away and starts reviewing them in the background. */
export async function runAutoReviewNowAction(): Promise<ActionResult<{ found: number; queued: number }>> {
  const session = await requireOrg([...ADMIN_ROLES]);
  const organizationId = session.user.organizationId;

  const config = await prisma.autoReviewConfig.findUnique({ where: { organizationId } });
  if (!config?.enabled) return { ok: false, error: "Turn on auto-review first" };
  if (config.lastPolledAt && Date.now() - config.lastPolledAt.getTime() < CHECK_NOW_COOLDOWN_MS) {
    return { ok: false, error: "Checked a few minutes ago. Try again shortly." };
  }

  let counts: { found: number; queued: number };
  try {
    counts = await pollOrganization(organizationId);
  } catch (error) {
    console.error("Check-now poll failed", { organizationId, error });
    return { ok: false, error: "Couldn't reach Zendesk. Re-test the connection above and try again." };
  }
  after(() => triggerAutoReviewRun({ organizationId }));

  revalidatePath("/qa/settings");
  return { ok: true, ...counts };
}
