"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { ALL_CRITERIA } from "@/lib/qa/assessor";
import type { Prisma } from "@/generated/prisma/client";

/** Starts a calibration session for an existing AI review — org owners/admins only, since it's a QA-management activity. */
export async function startCalibrationAction(reviewId: string) {
  const session = await requireOrg(["OWNER", "ADMIN"]);

  const review = await prisma.ticketReview.findUnique({
    where: { id: reviewId, organizationId: session.user.organizationId },
  });
  if (!review) throw new Error("Review not found");

  const calibration = await prisma.calibrationSession.create({
    data: {
      organizationId: session.user.organizationId,
      reviewId: review.id,
      createdById: session.user.id,
    },
  });

  revalidatePath("/qa/calibration");
  revalidatePath(`/qa/reviews/${reviewId}`);
  return { sessionId: calibration.id };
}

const scoreSchema = z.object(
  Object.fromEntries(ALL_CRITERIA.map(([key]) => [key, z.coerce.number().int().min(0).max(100)])),
);

/** Submits the current user's own score — one shot: no editing after submit, so scores stay blind and honest. */
export async function submitCalibrationEntryAction(sessionId: string, formData: FormData) {
  const session = await requireOrg();

  const calibration = await prisma.calibrationSession.findUnique({
    where: { id: sessionId, organizationId: session.user.organizationId },
  });
  if (!calibration) throw new Error("Calibration session not found");
  if (calibration.status === "CLOSED") throw new Error("This calibration session is closed");

  const existing = await prisma.calibrationEntry.findUnique({
    where: { sessionId_reviewerId: { sessionId, reviewerId: session.user.id } },
  });
  if (existing?.submittedAt) throw new Error("You've already submitted your score for this session");

  const parsed = scoreSchema.parse(
    Object.fromEntries(ALL_CRITERIA.map(([key]) => [key, formData.get(key)])),
  );
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const values = Object.values(parsed);
  const overallScore = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);

  await prisma.calibrationEntry.upsert({
    where: { sessionId_reviewerId: { sessionId, reviewerId: session.user.id } },
    create: {
      sessionId,
      reviewerId: session.user.id,
      overallScore,
      criteriaScores: parsed as Prisma.InputJsonValue,
      notes,
      submittedAt: new Date(),
    },
    update: {
      overallScore,
      criteriaScores: parsed as Prisma.InputJsonValue,
      notes,
      submittedAt: new Date(),
    },
  });

  revalidatePath(`/qa/calibration/${sessionId}`);
}

/** Closes the session: locks out further submissions and reveals every entry to every viewer, including anyone who never submitted. */
export async function closeCalibrationSessionAction(sessionId: string) {
  const session = await requireOrg(["OWNER", "ADMIN"]);

  await prisma.calibrationSession.update({
    where: { id: sessionId, organizationId: session.user.organizationId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  revalidatePath(`/qa/calibration/${sessionId}`);
  revalidatePath("/qa/calibration");
}
