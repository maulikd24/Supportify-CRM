import { prisma } from "@/lib/db/prisma";
import type { Stage } from "@/generated/prisma/client";

/**
 * Default pipeline seeded for a brand-new organization — fully editable
 * afterwards via Settings > Stages. Not a fixed enum: any org can rename,
 * reorder, add, or remove stages, and mark any of them `isTerminal` (see
 * Stage.isTerminal in schema.prisma) to control when a client auto-completes.
 */
export const DEFAULT_STAGE_DEFINITIONS = [
  { name: "New", sequence: 1, slaHours: 24, isTerminal: false },
  { name: "Contacted", sequence: 2, slaHours: 48, isTerminal: false },
  { name: "Qualified", sequence: 3, slaHours: 72, isTerminal: false },
  { name: "Proposal", sequence: 4, slaHours: 120, isTerminal: false },
  { name: "Won", sequence: 5, slaHours: 24, isTerminal: true },
] as const;

export async function getStageBySequence(organizationId: string, sequence: number): Promise<Stage> {
  return prisma.stage.findUniqueOrThrow({ where: { organizationId_sequence: { organizationId, sequence } } });
}

/** The stage new clients start in — the org's lowest-sequence active stage. */
export async function getFirstStage(organizationId: string): Promise<Stage> {
  const stage = await prisma.stage.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { sequence: "asc" },
  });
  if (!stage) throw new Error("This organization has no active stages configured.");
  return stage;
}

export async function getAllStages(organizationId: string): Promise<Stage[]> {
  return prisma.stage.findMany({ where: { organizationId, isActive: true }, orderBy: { sequence: "asc" } });
}
