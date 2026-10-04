"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireProductAccess } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { customScorecardsAvailable, normalizeCriteria, scorecardInputSchema } from "@/lib/qa/scorecard";
import { QA_GROWTH_UPSELL } from "@/lib/qa/plan-features";
import type { Prisma } from "@/generated/prisma/client";

const MAX_SCORECARDS = 25;

async function requireScorecardAdmin() {
  const session = await requireProductAccess("QA_SENTINEL", ["OWNER", "ADMIN"]);
  if (!(await customScorecardsAvailable(session.user.organizationId))) {
    throw new UserError(`Custom scorecards are ${QA_GROWTH_UPSELL}`);
  }
  return session;
}

function revalidate() {
  revalidatePath("/qa/scorecards");
  revalidatePath("/qa/settings");
}

export const createScorecardAction = withUserErrors(async function createScorecardAction(input: z.input<typeof scorecardInputSchema>) {
  const session = await requireScorecardAdmin();
  const organizationId = session.user.organizationId;
  const parsed = scorecardInputSchema.parse(input);
  const criteria = normalizeCriteria(parsed.criteria);

  const count = await prisma.scorecard.count({ where: { organizationId } });
  if (count >= MAX_SCORECARDS) throw new UserError(`You can have up to ${MAX_SCORECARDS} scorecards.`);

  const scorecard = await prisma.scorecard.create({
    data: { organizationId, name: parsed.name, criteria: criteria as unknown as Prisma.InputJsonValue, isDefault: count === 0 },
  });
  await recordAudit({ organizationId, userId: session.user.id, entity: "Scorecard", entityId: scorecard.id, action: "qa.scorecard_created", newValue: { name: parsed.name, criteria: criteria.length } });
  revalidate();
  return { id: scorecard.id };
});

export const updateScorecardAction = withUserErrors(async function updateScorecardAction(id: string, input: z.input<typeof scorecardInputSchema>) {
  const session = await requireScorecardAdmin();
  const organizationId = session.user.organizationId;
  const parsed = scorecardInputSchema.parse(input);
  const criteria = normalizeCriteria(parsed.criteria);

  const before = await prisma.scorecard.findFirst({ where: { id, organizationId } });
  if (!before) throw new UserError("Scorecard not found");

  // Past reviews keep their own snapshot, so editing only affects new reviews.
  await prisma.scorecard.update({ where: { id }, data: { name: parsed.name, criteria: criteria as unknown as Prisma.InputJsonValue } });
  await recordAudit({ organizationId, userId: session.user.id, entity: "Scorecard", entityId: id, action: "qa.scorecard_updated", oldValue: before.criteria as Prisma.InputJsonValue, newValue: criteria as unknown as Prisma.InputJsonValue });
  revalidate();
});

export const setDefaultScorecardAction = withUserErrors(async function setDefaultScorecardAction(id: string) {
  const session = await requireScorecardAdmin();
  const organizationId = session.user.organizationId;
  const target = await prisma.scorecard.findFirst({ where: { id, organizationId }, select: { id: true, name: true } });
  if (!target) throw new UserError("Scorecard not found");
  await prisma.$transaction([
    prisma.scorecard.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } }),
    prisma.scorecard.update({ where: { id }, data: { isDefault: true } }),
  ]);
  await recordAudit({ organizationId, userId: session.user.id, entity: "Scorecard", entityId: id, action: "qa.scorecard_default_changed", newValue: { name: target.name } });
  revalidate();
});

/** Deleting is allowed on any plan, so a downgraded org can still tidy up. */
export const deleteScorecardAction = withUserErrors(async function deleteScorecardAction(id: string) {
  const session = await requireProductAccess("QA_SENTINEL", ["OWNER", "ADMIN"]);
  const organizationId = session.user.organizationId;
  const target = await prisma.scorecard.findFirst({ where: { id, organizationId } });
  if (!target) throw new UserError("Scorecard not found");

  await prisma.scorecard.delete({ where: { id } });
  // Auto-review falls back to the default scorecard when its choice is deleted.
  await prisma.autoReviewConfig.updateMany({ where: { organizationId, scorecardId: id }, data: { scorecardId: null } });
  if (target.isDefault) {
    const next = await prisma.scorecard.findFirst({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    if (next) await prisma.scorecard.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  await recordAudit({ organizationId, userId: session.user.id, entity: "Scorecard", entityId: id, action: "qa.scorecard_deleted", oldValue: { name: target.name } });
  revalidate();
});
