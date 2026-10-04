import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteOrganizationAction } from "@/app/(dashboard)/settings/data/actions";
import { createClientAction } from "@/app/(dashboard)/clients/actions";
import { asUser, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

/**
 * "Delete organization" (and GDPR erasure) must remove every row an org owns,
 * however much history it has. Several relations used to be RESTRICT, which
 * Postgres checks row-by-row mid-cascade, so the delete failed as soon as an
 * org had e.g. a client with stage history.
 */

// Every model with an organizationId column, read from the schema so new models are covered automatically.
const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
const ORG_SCOPED_MODELS = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
  .filter(([, , body]) => /^\s+organizationId\s+String/m.test(body))
  .map(([, name]) => name);

type Delegate = { count: (args: { where: { organizationId: string } }) => Promise<number> };
const delegate = (model: string) => (prisma as unknown as Record<string, Delegate>)[model[0].toLowerCase() + model.slice(1)];

async function rowsOwnedBy(organizationId: string) {
  const counts: Record<string, number> = {};
  for (const model of ORG_SCOPED_MODELS) counts[model] = await delegate(model).count({ where: { organizationId } });
  return counts;
}

/** An org with real history in every product area, created the way the app creates it. */
async function populatedOrg() {
  const { org, stage } = await createOrg({
    products: [
      { product: "CRM", planId: "scale", seats: 50 },
      { product: "QA_SENTINEL", planId: "scale", reviewQuota: 1000 },
    ],
  });
  const organizationId = org.id;
  const owner = await createUser(organizationId);
  const rm = await createUser(organizationId, { role: "RM", orgRole: "MEMBER" });
  await prisma.user.update({ where: { id: rm.id }, data: { managerId: owner.id } });
  const stage2 = await prisma.stage.create({ data: { organizationId, name: "Won", sequence: 2, slaHours: 24 } });

  // A client created through the real action writes StageHistory + Activity + AuditLog like production does.
  asUser(owner);
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: "Acme", mobile: `+1555${organizationId.slice(-6)}`, email: "", clientType: "", leadSource: "", referralSource: "", notes: "", assignedToId: rm.id })) form.append(k, v);
  const created = (await createClientAction(form)) as { client: { id: string } };
  if (!created?.client) throw new Error(`createClientAction returned ${JSON.stringify(created)}`);
  const clientId = created.client.id;
  await prisma.stageHistory.create({ data: { clientId, fromStageId: stage.id, toStageId: stage2.id, changedById: rm.id } });

  const template = await prisma.messageTemplate.create({ data: { organizationId, channel: "whatsapp", provider: "meta", name: "t", body: "hi" } });
  const journey = await prisma.journey.create({ data: { organizationId, name: "j", definition: {}, createdById: owner.id } });
  const run = await prisma.journeyRun.create({ data: { organizationId, journeyId: journey.id, clientId } });
  const sop = await prisma.sopDocument.create({ data: { organizationId, name: "SOP", content: "x" } });
  const review = await prisma.ticketReview.create({ data: { organizationId, ticketId: "1", primarySopId: sop.id } });
  const calibration = await prisma.calibrationSession.create({ data: { organizationId, reviewId: review.id, createdById: owner.id } });
  const webhook = await prisma.webhookEndpoint.create({ data: { organizationId, url: "https://x.test", encryptedSecret: "x", events: [] } });

  await Promise.all([
    prisma.document.create({ data: { organizationId, clientId, documentType: "ID" } }),
    prisma.exception.create({ data: { organizationId, clientId, stageId: stage.id, reason: "r" } }),
    prisma.task.create({ data: { organizationId, clientId, assignedToId: rm.id, title: "t", dueAt: new Date() } }),
    prisma.activity.create({ data: { organizationId, clientId, userId: rm.id, type: "NOTE", payload: {} } }),
    prisma.message.create({ data: { organizationId, clientId, templateId: template.id, channel: "whatsapp", provider: "meta", direction: "OUTBOUND", body: "b" } }),
    prisma.journeyRunStep.create({ data: { runId: run.id, nodeId: "n", nodeType: "action", status: "success" } }),
    prisma.notification.create({ data: { organizationId, userId: rm.id, type: "t", payload: {} } }),
    prisma.auditLog.create({ data: { organizationId, userId: owner.id, entity: "Client", entityId: clientId, action: "a" } }),
    prisma.apiKey.create({ data: { organizationId, name: "k", keyPrefix: "sk", hashedKey: `h_${organizationId}`, createdById: owner.id } }),
    prisma.webhookDelivery.create({ data: { webhookEndpointId: webhook.id, event: "e", success: true } }),
    prisma.calibrationEntry.create({ data: { sessionId: calibration.id, reviewerId: rm.id } }),
    prisma.coachingSession.create({ data: { organizationId, reviewId: review.id, agentEmail: "a@x.test", coachId: owner.id, notes: "n" } }),
    prisma.reviewDispute.create({ data: { organizationId, reviewId: review.id, raisedById: rm.id, resolvedById: owner.id, reason: "r" } }),
    prisma.verificationToken.create({ data: { token: `t_${organizationId}`, userId: rm.id, purpose: "EMAIL_VERIFY", expiresAt: new Date() } }),
  ]);

  return { organizationId, owner, rm, clientId, orgName: org.name };
}

let A: Awaited<ReturnType<typeof populatedOrg>>;
let B: Awaited<ReturnType<typeof populatedOrg>>;

beforeAll(async () => {
  A = await populatedOrg();
  B = await populatedOrg();
});
afterAll(() => deleteOrgs(A.organizationId, B.organizationId));

describe("deleting an organization", () => {
  it("covers the org-scoped models it should", () => {
    expect(ORG_SCOPED_MODELS).toEqual(expect.arrayContaining(["Client", "User", "Task", "Activity", "TicketReview"]));
  });

  it("removes every row the org owns — and nothing of anyone else's", async () => {
    const before = await rowsOwnedBy(A.organizationId);
    expect(before.Client).toBe(1); // sanity: the fixture really populated the org
    const otherOrgBefore = await rowsOwnedBy(B.organizationId);

    asUser(A.owner);
    // Succeeds by signing the owner out (signOut is mocked in tests).
    await deleteOrganizationAction(A.orgName);

    expect(await prisma.organization.count({ where: { id: A.organizationId } })).toBe(0);
    const after = await rowsOwnedBy(A.organizationId);
    expect(Object.entries(after).filter(([, n]) => n > 0), "rows left behind").toEqual([]);
    // Rows with no organizationId of their own, reached only through a parent.
    expect(await prisma.stageHistory.count({ where: { clientId: A.clientId } })).toBe(0);
    expect(await prisma.journeyRunStep.count({ where: { run: { organizationId: A.organizationId } } })).toBe(0);
    expect(await prisma.verificationToken.count({ where: { userId: { in: [A.owner.id, A.rm.id] } } })).toBe(0);

    expect(await rowsOwnedBy(B.organizationId)).toEqual(otherOrgBefore);
  });

  it("still refuses to delete a single user or client that has history", async () => {
    // NO ACTION (unlike CASCADE) keeps protecting records outside a whole-org delete.
    await expect(prisma.user.delete({ where: { id: B.rm.id } })).rejects.toThrow();
    await expect(prisma.client.delete({ where: { id: B.clientId } })).rejects.toThrow();
  });
});
