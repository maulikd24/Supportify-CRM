import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as clients from "@/app/(dashboard)/clients/actions";
import { completeTaskAction, createTaskAction } from "@/app/(dashboard)/tasks/actions";
import { enrollClientInJourneyAction } from "@/app/(dashboard)/journeys/actions";
import { asUser, createClient, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

/**
 * Within one org, the client pages already hide other people's clients (an RM sees only
 * their own, a manager their team's, an admin everyone's). Server actions are callable
 * directly by id, so they must enforce the same rule — otherwise an RM can reassign, edit,
 * move or message a colleague's client just by knowing its id.
 */

type U = Awaited<ReturnType<typeof createUser>>;
let orgId: string;
let admin: U, manager: U, rmA: U, rmB: U;
let clientA: string, clientB: string, unassigned: string;
let docB: string, taskA: string, taskB: string, laterStage: string, templateId: string, journeyId: string;

beforeAll(async () => {
  const { org, stage } = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
  orgId = org.id;
  admin = await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" });
  manager = await createUser(orgId, { role: "MANAGER", orgRole: "MEMBER" });
  rmA = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
  rmB = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
  await prisma.user.update({ where: { id: rmA.id }, data: { managerId: manager.id } }); // rmA reports to manager; rmB doesn't

  const assign = async (assignedToId: string | null, name: string) =>
    (await prisma.client.update({ where: { id: (await createClient(orgId, stage.id, name)).id }, data: { assignedToId } })).id;
  clientA = await assign(rmA.id, "Client of A");
  clientB = await assign(rmB.id, "Client of B");
  unassigned = await assign(null, "Unassigned client");

  laterStage = (await prisma.stage.create({ data: { organizationId: orgId, name: "Won", sequence: 2, slaHours: 24 } })).id;
  docB = (await prisma.document.create({ data: { organizationId: orgId, clientId: clientB, documentType: "ID" } })).id;
  taskA = (await prisma.task.create({ data: { organizationId: orgId, clientId: clientA, assignedToId: rmA.id, title: "a", dueAt: new Date() } })).id;
  taskB = (await prisma.task.create({ data: { organizationId: orgId, clientId: clientB, assignedToId: rmB.id, title: "b", dueAt: new Date() } })).id;
  templateId = (await prisma.messageTemplate.create({ data: { organizationId: orgId, channel: "whatsapp", provider: "meta", name: "t", body: "hi", approved: true } })).id;
  journeyId = (
    await prisma.journey.create({
      data: {
        organizationId: orgId,
        name: "j",
        createdById: admin.id,
        definition: { nodes: [{ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "client_created" } }], edges: [] },
      },
    })
  ).id;
});
afterAll(() => deleteOrgs(orgId));

/** Everything an action could change about one client. */
const snapshot = async (clientId: string) => ({
  client: await prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
  activities: await prisma.activity.count({ where: { clientId } }),
  documents: await prisma.document.findMany({ where: { clientId }, orderBy: { id: "asc" } }),
  tasks: await prisma.task.findMany({ where: { clientId }, orderBy: { id: "asc" } }),
  messages: await prisma.message.count({ where: { clientId } }),
  journeyRuns: await prisma.journeyRun.count({ where: { clientId } }),
  stageHistory: await prisma.stageHistory.count({ where: { clientId } }),
});

const notFound = { __actionError: expect.stringMatching(/not found/) };

/** Every action an RM can call against a client id. */
const rmActions = (clientId: string, documentId: string) => [
  () => clients.reassignClientAction(clientId, rmA.id),
  () => clients.addClientNoteAction(clientId, "note"),
  () => clients.sendClientMessageAction(clientId, "whatsapp", templateId, {}),
  () => clients.recordRmContactAction(clientId, { contactMethod: "Phone", contactOutcome: "Connected" }),
  () => clients.addDocumentAction(clientId, "Passport", true),
  () => clients.updateDocumentStatusAction(documentId, { status: "VERIFIED" }),
  () => clients.updateClientDetailsAction(clientId, { dealValue: 1 }),
  () => clients.moveToStageAction(clientId, laterStage),
  () => clients.putOnHoldAction(clientId, { reason: "r" }),
  () => clients.resumeFromHoldAction(clientId),
  () => clients.markNotProceedingAction(clientId, { reason: "r" }),
  () => enrollClientInJourneyAction(journeyId, clientId),
  () => createTaskAction(taskForm(clientId)),
];

function taskForm(clientId: string) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ clientId, title: "t", dueAt: "2030-01-01", assignedToId: rmA.id })) f.append(k, v);
  return f;
}

describe("an RM", () => {
  it("can't act on another RM's client — every client action", async () => {
    asUser(rmA);
    const before = await snapshot(clientB);
    for (const attempt of rmActions(clientB, docB)) expect(await attempt()).toEqual(notFound);
    expect(await snapshot(clientB)).toEqual(before);
  });

  it("can't act on an unassigned client", async () => {
    asUser(rmA);
    const before = await snapshot(unassigned);
    expect(await clients.addClientNoteAction(unassigned, "note")).toEqual(notFound);
    expect(await clients.reassignClientAction(unassigned, rmA.id)).toEqual(notFound);
    expect(await snapshot(unassigned)).toEqual(before);
  });

  it("can't complete another RM's task, but can complete their own", async () => {
    asUser(rmA);
    expect(await completeTaskAction(taskB)).toEqual({ __actionError: "Task not found" });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskB } })).status).not.toBe("DONE");
    await completeTaskAction(taskA);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskA } })).status).toBe("DONE");
  });

  it("can still work their own client (control)", async () => {
    asUser(rmA);
    expect(await clients.addClientNoteAction(clientA, "note")).toBeUndefined();
    expect(await clients.updateClientDetailsAction(clientA, { dealValue: 5 })).toBeUndefined();
    expect(await createTaskAction(taskForm(clientA))).toMatchObject({ clientId: clientA });
    expect(await enrollClientInJourneyAction(journeyId, clientA)).toBeUndefined();
  });
});

describe("a manager", () => {
  it("can act on their reports' clients but not other teams'", async () => {
    asUser(manager);
    expect(await clients.addClientNoteAction(clientA, "from manager")).toBeUndefined();

    const before = await snapshot(clientB);
    expect(await clients.addClientNoteAction(clientB, "x")).toEqual(notFound);
    expect(await clients.correctStageAction(clientB, laterStage, "r")).toEqual(notFound);
    expect(await clients.reopenClientAction(clientB, { reason: "r" })).toEqual(notFound);
    expect(await clients.mergeClientsAction(clientA, clientB)).toEqual(notFound);
    expect(await snapshot(clientB)).toEqual(before);
  });

  it("merge search only returns clients on their team", async () => {
    asUser(manager);
    const hits = await clients.searchClientsForMergeAction("Client", "none");
    const ids = (hits as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(clientA);
    expect(ids).not.toContain(clientB);
    expect(ids).not.toContain(unassigned);
  });
});

describe("an admin", () => {
  it("can act on any client in the org, including unassigned ones", async () => {
    asUser(admin);
    expect(await clients.addClientNoteAction(clientB, "admin")).toBeUndefined();
    expect(await clients.addClientNoteAction(unassigned, "admin")).toBeUndefined();
    expect(await clients.updateDocumentStatusAction(docB, { status: "VERIFIED" })).toBeUndefined();
  });
});
