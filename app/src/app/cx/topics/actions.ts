"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { requireProductAccess } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { withUserErrors } from "@/lib/actions/user-error";
import { recomputeDays } from "@/lib/cx/ai/rollups";
import { triggerCxWorker } from "@/lib/cx/ingest/trigger";
import { addDays, startOfDay } from "@/lib/utils/date-buckets";
import {
  addTopic,
  archiveTopic,
  countProposed,
  createIssue,
  mergeTopic,
  ownTopic,
  reanalyseProposed,
  setIssueStatus,
  updateTopic,
} from "@/lib/cx/taxonomy";

const admin = () => requireProductAccess("CX_INTELLIGENCE", ["OWNER", "ADMIN"]);
const member = () => requireProductAccess("CX_INTELLIGENCE", ["OWNER", "ADMIN", "MEMBER"]);
/** Suggested topics are counted (and re-analysed) over the same window the topics page shows. */
const PROPOSAL_DAYS = 30;

function refresh(topicId?: string) {
  revalidatePath("/cx/topics");
  if (topicId) revalidatePath(`/cx/topics/${topicId}`);
}

const name = z.string().trim().min(1, "Give it a name").max(80, "Keep the name under 80 characters");
const description = z.string().trim().max(300, "Keep the description under 300 characters").nullable().optional();

const addSchema = z.object({ name, description, parentId: z.string().min(1).nullable() });

export const addTopicAction = withUserErrors(async function addTopicAction(input: z.input<typeof addSchema>) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const parsed = addSchema.parse(input);
  const topic = await addTopic(organizationId, { ...parsed, origin: "manual" });
  await recordAudit({ organizationId, userId: session.user.id, entity: "Topic", entityId: topic.id, action: "cx.topic_created", newValue: { name: topic.name, parentId: topic.parentId } });
  refresh();
});

const proposalSchema = z.object({ proposed: name, parentId: z.string().min(1), reanalyse: z.boolean() });

/** How many recent conversations accepting a suggestion would send back for analysis. */
export const proposalImpactAction = withUserErrors(async function proposalImpactAction(proposed: string) {
  const session = await admin();
  return countProposed(session.user.organizationId, name.parse(proposed), addDays(startOfDay(), -PROPOSAL_DAYS));
});

export const acceptProposalAction = withUserErrors(async function acceptProposalAction(input: z.input<typeof proposalSchema>) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const parsed = proposalSchema.parse(input);
  const topic = await addTopic(organizationId, { name: parsed.proposed, parentId: parsed.parentId, origin: "proposed" });
  const reanalysed = parsed.reanalyse ? await reanalyseProposed(organizationId, parsed.proposed, addDays(startOfDay(), -PROPOSAL_DAYS)) : 0;
  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "Topic",
    entityId: topic.id,
    action: "cx.topic_accepted",
    newValue: { name: topic.name, parentId: topic.parentId, reanalysed },
  });
  if (reanalysed > 0) after(() => triggerCxWorker({ organizationId }));
  refresh();
  return { topicId: topic.id, reanalysed };
});

const updateSchema = z.object({
  topicId: z.string().min(1),
  name: name.optional(),
  description,
  parentId: z.string().min(1).optional(),
  ownerTeamId: z.string().min(1).nullable().optional(),
});

export const updateTopicAction = withUserErrors(async function updateTopicAction(input: z.input<typeof updateSchema>) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const { topicId, ...changes } = updateSchema.parse(input);
  const before = await ownTopic(organizationId, topicId);
  await updateTopic(organizationId, topicId, changes);
  await recordAudit({ organizationId, userId: session.user.id, entity: "Topic", entityId: topicId, action: "cx.topic_updated", oldValue: { name: before.name, parentId: before.parentId }, newValue: changes });
  refresh(topicId);
});

export const archiveTopicAction = withUserErrors(async function archiveTopicAction(topicId: string) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const topic = await archiveTopic(organizationId, topicId);
  await recordAudit({ organizationId, userId: session.user.id, entity: "Topic", entityId: topic.id, action: "cx.topic_archived", oldValue: { name: topic.name } });
  refresh(topicId);
});

export const mergeTopicAction = withUserErrors(async function mergeTopicAction(input: { sourceId: string; targetId: string }) {
  const session = await admin();
  const organizationId = session.user.organizationId;
  const { sourceId, targetId } = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).parse(input);
  const days = await mergeTopic(organizationId, sourceId, targetId);
  // Daily totals by topic are rebuilt after the response; a large history can take a while.
  after(() => recomputeDays(organizationId, days));
  await recordAudit({ organizationId, userId: session.user.id, entity: "Topic", entityId: sourceId, action: "cx.topic_merged", newValue: { mergedIntoId: targetId } });
  refresh(targetId);
});

const issueSchema = z.object({
  topicId: z.string().min(1),
  title: z.string().trim().min(1, "Describe the issue").max(140, "Keep the title under 140 characters"),
  note: z.string().trim().max(2000).nullable().optional(),
  ownerTeamId: z.string().min(1).nullable().optional(),
});

export const createIssueAction = withUserErrors(async function createIssueAction(input: z.input<typeof issueSchema>) {
  const session = await member();
  const organizationId = session.user.organizationId;
  const parsed = issueSchema.parse(input);
  const issue = await createIssue(organizationId, session.user.id, parsed);
  await recordAudit({ organizationId, userId: session.user.id, entity: "TopicIssue", entityId: issue.id, action: "cx.issue_created", newValue: { title: issue.title, topicId: issue.topicId } });
  refresh(parsed.topicId);
});

export const setIssueStatusAction = withUserErrors(async function setIssueStatusAction(input: { issueId: string; status: "OPEN" | "IN_PROGRESS" | "RESOLVED" }) {
  const session = await member();
  const organizationId = session.user.organizationId;
  const parsed = z.object({ issueId: z.string().min(1), status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]) }).parse(input);
  const issue = await setIssueStatus(organizationId, parsed.issueId, parsed.status);
  await recordAudit({ organizationId, userId: session.user.id, entity: "TopicIssue", entityId: issue.id, action: "cx.issue_status_changed", newValue: { status: issue.status } });
  refresh(issue.topicId);
});
