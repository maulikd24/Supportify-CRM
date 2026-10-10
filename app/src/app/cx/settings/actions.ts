"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireProductAccess } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { costSettingsSchema, getCostSettings, normalizeMappingValue, type CostSettingsInput } from "@/lib/cx/settings";

const PATH = "/cx/settings";
const admin = () => requireProductAccess("CX_INTELLIGENCE", ["OWNER", "ADMIN"]);

export const saveCostSettingsAction = withUserErrors(async function saveCostSettingsAction(input: CostSettingsInput) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const parsed = costSettingsSchema.parse(input);
  const before = await getCostSettings(organizationId);

  await prisma.cxCostSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...parsed },
    update: parsed,
  });
  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "CxCostSettings",
    entityId: organizationId,
    action: "cx.cost_settings_updated",
    oldValue: before,
    newValue: parsed,
  });
  revalidatePath(PATH);
});

const teamSchema = z.object({
  name: z.string().trim().min(1, "Give the team a name").max(80),
  kind: z.enum(["OWNER", "SUPPORT", "BPO"]),
  benchmarkTeamId: z.string().nullable().optional(),
});

async function ownTeam(organizationId: string, teamId: string) {
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId } });
  if (!team) throw new UserError("Team not found");
  return team;
}

export const createTeamAction = withUserErrors(async function createTeamAction(input: z.input<typeof teamSchema>) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const parsed = teamSchema.parse(input);
  if (await prisma.team.findUnique({ where: { organizationId_name: { organizationId, name: parsed.name } } })) {
    throw new UserError("A team with that name already exists");
  }
  // A BPO is benchmarked against one of this org's own in-house support teams.
  let benchmarkTeamId: string | null = null;
  if (parsed.kind === "BPO" && parsed.benchmarkTeamId) {
    const benchmark = await ownTeam(organizationId, parsed.benchmarkTeamId);
    if (benchmark.kind !== "SUPPORT") throw new UserError("Benchmark a BPO against an in-house support team");
    benchmarkTeamId = benchmark.id;
  }

  const team = await prisma.team.create({ data: { organizationId, name: parsed.name, kind: parsed.kind, benchmarkTeamId } });
  await recordAudit({ organizationId, userId: session.user.id, entity: "Team", entityId: team.id, action: "cx.team_created", newValue: { name: team.name, kind: team.kind } });
  revalidatePath(PATH);
});

export const deleteTeamAction = withUserErrors(async function deleteTeamAction(teamId: string) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const team = await ownTeam(organizationId, teamId);
  await prisma.team.delete({ where: { id: team.id } });
  await recordAudit({ organizationId, userId: session.user.id, entity: "Team", entityId: team.id, action: "cx.team_deleted", oldValue: { name: team.name, kind: team.kind } });
  revalidatePath(PATH);
});

const mappingSchema = z.object({
  teamId: z.string().min(1),
  matchType: z.enum(["email", "domain", "group"]),
  value: z.string().trim().min(1, "Enter an email, domain or group").max(200),
});

export const addTeamMappingAction = withUserErrors(async function addTeamMappingAction(input: z.input<typeof mappingSchema>) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const parsed = mappingSchema.parse(input);
  const team = await ownTeam(organizationId, parsed.teamId);
  const value = normalizeMappingValue(parsed.matchType, parsed.value);
  if (parsed.matchType === "email" && !/^[^\s@]+@[^\s@]+$/.test(value)) throw new UserError("Enter a full agent email address");
  if (parsed.matchType === "domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) throw new UserError("Enter a domain like bpo-partner.com");

  const existing = await prisma.agentTeamMapping.findUnique({
    where: { organizationId_matchType_value: { organizationId, matchType: parsed.matchType, value } },
    include: { team: { select: { name: true } } },
  });
  if (existing) throw new UserError(`Already mapped to ${existing.team.name}`);

  const mapping = await prisma.agentTeamMapping.create({ data: { organizationId, teamId: team.id, matchType: parsed.matchType, value } });
  await recordAudit({ organizationId, userId: session.user.id, entity: "AgentTeamMapping", entityId: mapping.id, action: "cx.team_mapping_added", newValue: { team: team.name, matchType: parsed.matchType, value } });
  revalidatePath(PATH);
});

export const removeTeamMappingAction = withUserErrors(async function removeTeamMappingAction(mappingId: string) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const mapping = await prisma.agentTeamMapping.findFirst({ where: { id: mappingId, organizationId } });
  if (!mapping) throw new UserError("Mapping not found");
  await prisma.agentTeamMapping.delete({ where: { id: mapping.id } });
  await recordAudit({ organizationId, userId: session.user.id, entity: "AgentTeamMapping", entityId: mapping.id, action: "cx.team_mapping_removed", oldValue: { matchType: mapping.matchType, value: mapping.value } });
  revalidatePath(PATH);
});
