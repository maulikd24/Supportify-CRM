import { UserError } from "@/lib/actions/user-error";
import { prisma } from "@/lib/db/prisma";
import { slugify } from "@/lib/cx/ai/discover";

/**
 * Editing the topic list. Every function takes the org from the caller's session and only ever
 * touches that org's topics. Topic keys never change (classification output refers to them), so
 * renaming changes the name only. Changes take effect on the next classification run.
 */

type OrgTopic = { id: string; parentId: string | null; status: string; name: string; key: string };

export async function ownTopic(organizationId: string, topicId: string): Promise<OrgTopic> {
  const topic = await prisma.topic.findFirst({ where: { id: topicId, organizationId }, select: { id: true, parentId: true, status: true, name: true, key: true } });
  if (!topic) throw new UserError("Topic not found");
  return topic;
}

async function activeTheme(organizationId: string, themeId: string) {
  const theme = await ownTopic(organizationId, themeId);
  if (theme.parentId || theme.status !== "ACTIVE") throw new UserError("Choose an active theme");
  return theme;
}

/** A key unused in this org: the slug of the name, with _2, _3… if taken. */
async function freeKey(organizationId: string, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (await prisma.topic.findMany({ where: { organizationId, key: { startsWith: base } }, select: { key: true } })).map((t) => t.key),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

export async function addTopic(
  organizationId: string,
  input: { name: string; description?: string | null; parentId: string | null; origin: "manual" | "proposed" },
) {
  const name = input.name.trim();
  if (input.parentId) await activeTheme(organizationId, input.parentId);
  const clash = await prisma.topic.findFirst({
    where: { organizationId, parentId: input.parentId, status: "ACTIVE", name: { equals: name, mode: "insensitive" } },
  });
  if (clash) throw new UserError(`"${clash.name}" already exists there`);
  return prisma.topic.create({
    data: { organizationId, key: await freeKey(organizationId, name), name, description: input.description?.trim() || null, parentId: input.parentId, origin: input.origin },
  });
}

export async function updateTopic(
  organizationId: string,
  topicId: string,
  input: { name?: string; description?: string | null; parentId?: string; ownerTeamId?: string | null },
) {
  const topic = await ownTopic(organizationId, topicId);
  if (topic.status !== "ACTIVE") throw new UserError("Only active topics can be edited");
  if (input.parentId !== undefined) {
    if (!topic.parentId) throw new UserError("A theme can't be moved under another theme");
    await activeTheme(organizationId, input.parentId);
  }
  if (input.ownerTeamId && !(await prisma.team.findFirst({ where: { id: input.ownerTeamId, organizationId } }))) throw new UserError("Team not found");
  return prisma.topic.update({
    where: { id: topic.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.ownerTeamId !== undefined ? { ownerTeamId: input.ownerTeamId } : {}),
    },
  });
}

/** Stops using a topic for new conversations; its history is kept. A theme must be emptied first. */
export async function archiveTopic(organizationId: string, topicId: string) {
  const topic = await ownTopic(organizationId, topicId);
  if (topic.status !== "ACTIVE") throw new UserError("That topic isn't active");
  if (!topic.parentId && (await prisma.topic.count({ where: { organizationId, parentId: topic.id, status: "ACTIVE" } })) > 0) {
    throw new UserError("Move or archive this theme's topics first");
  }
  return prisma.topic.update({ where: { id: topic.id }, data: { status: "ARCHIVED" } });
}

/**
 * Folds one topic into another: its conversations move over (a conversation already under the
 * target keeps one row, primary if either was), its issues move, and it is marked MERGED.
 * Returns the UTC days whose totals need rebuilding.
 */
export async function mergeTopic(organizationId: string, sourceId: string, targetId: string): Promise<string[]> {
  if (sourceId === targetId) throw new UserError("Choose a different topic to merge into");
  const [source, target] = await Promise.all([ownTopic(organizationId, sourceId), ownTopic(organizationId, targetId)]);
  if (!source.parentId || !target.parentId) throw new UserError("Only topics can be merged, not themes");
  if (source.status !== "ACTIVE" || target.status !== "ACTIVE") throw new UserError("Both topics must be active");

  return prisma.$transaction(async (tx) => {
    const days = await tx.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT to_char("startedAt", 'YYYY-MM-DD') AS day FROM "ConversationTopic"
      WHERE "organizationId" = ${organizationId} AND "topicId" = ${source.id}`;
    await tx.$executeRaw`
      INSERT INTO "ConversationTopic" ("conversationId", "topicId", "organizationId", "startedAt", channel, "isPrimary", confidence, evidence)
      SELECT "conversationId", ${target.id}, "organizationId", "startedAt", channel, "isPrimary", confidence, evidence
      FROM "ConversationTopic" WHERE "organizationId" = ${organizationId} AND "topicId" = ${source.id}
      ON CONFLICT ("conversationId", "topicId") DO UPDATE SET "isPrimary" = "ConversationTopic"."isPrimary" OR EXCLUDED."isPrimary"`;
    await tx.conversationTopic.deleteMany({ where: { organizationId, topicId: source.id } });
    await tx.topicIssue.updateMany({ where: { organizationId, topicId: source.id }, data: { topicId: target.id } });
    // Earlier merges into the source now point at the target.
    await tx.topic.updateMany({ where: { organizationId, mergedIntoId: source.id }, data: { mergedIntoId: target.id } });
    await tx.topic.update({ where: { id: source.id }, data: { status: "MERGED", mergedIntoId: target.id } });
    return days.map((d) => d.day);
  });
}

/** Analysed conversations in the window whose suggested new topic is `proposed` (case-insensitive). */
function proposedWhere(organizationId: string, proposed: string, since: Date) {
  return {
    organizationId,
    analysisStatus: "DONE" as const,
    startedAt: { gte: since },
    analysis: { proposedTopic: { equals: proposed, mode: "insensitive" as const } },
  };
}

export function countProposed(organizationId: string, proposed: string, since: Date): Promise<number> {
  return prisma.conversation.count({ where: proposedWhere(organizationId, proposed, since) });
}

/** Sends those conversations back for analysis so they pick up the new topic. Returns how many. */
export async function reanalyseProposed(organizationId: string, proposed: string, since: Date): Promise<number> {
  const { count } = await prisma.conversation.updateMany({ where: proposedWhere(organizationId, proposed, since), data: { analysisStatus: "PENDING" } });
  return count;
}

// ---- Issues -------------------------------------------------------------------------------

export async function createIssue(
  organizationId: string,
  userId: string,
  input: { topicId: string; title: string; note?: string | null; ownerTeamId?: string | null },
) {
  const topic = await ownTopic(organizationId, input.topicId);
  if (input.ownerTeamId && !(await prisma.team.findFirst({ where: { id: input.ownerTeamId, organizationId } }))) throw new UserError("Team not found");
  return prisma.topicIssue.create({
    data: { organizationId, topicId: topic.id, title: input.title.trim(), note: input.note?.trim() || null, ownerTeamId: input.ownerTeamId || null, createdById: userId },
  });
}

export async function setIssueStatus(organizationId: string, issueId: string, status: "OPEN" | "IN_PROGRESS" | "RESOLVED") {
  const issue = await prisma.topicIssue.findFirst({ where: { id: issueId, organizationId } });
  if (!issue) throw new UserError("Issue not found");
  return prisma.topicIssue.update({
    where: { id: issue.id },
    data: { status, resolvedAt: status === "RESOLVED" ? (issue.resolvedAt ?? new Date()) : null },
  });
}
