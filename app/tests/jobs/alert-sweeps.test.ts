import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkStageSla } from "@/lib/sla/check-stage-sla";
import { checkDisengagement } from "@/lib/copilot/check-disengagement";
import { checkOverdueTasks } from "@/lib/sla/check-overdue-tasks";
import { createClient, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

/**
 * These sweeps run every few minutes, possibly overlapping. Each must alert exactly once per
 * episode — not again on the next run, not again once the alert is read, and never twice from
 * two concurrent runs — and must not let already-alerted clients starve newer ones.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let orgId: string;
let stageId: string;
let rmId: string;

beforeAll(async () => {
  const { org, stage } = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
  orgId = org.id;
  stageId = stage.id; // slaHours: 24
  rmId = (await createUser(orgId, { role: "RM", orgRole: "MEMBER" })).id;
});
afterAll(async () => {
  await prisma.activity.deleteMany({ where: { organizationId: orgId } });
  await deleteOrgs(orgId);
});

const alerts = (type: string, clientId: string) =>
  prisma.notification.count({ where: { type, payload: { path: ["clientId"], equals: clientId } } });

async function client(opts: { stageEnteredAt?: Date; createdAt?: Date } = {}) {
  const c = await createClient(orgId, stageId);
  return prisma.client.update({
    where: { id: c.id },
    data: { assignedToId: rmId, stageEnteredAt: opts.stageEnteredAt ?? new Date(), createdAt: opts.createdAt ?? new Date() },
  });
}

describe("stage SLA sweep", () => {
  it("alerts a breached client exactly once — even after the alert is read", async () => {
    const c = await client({ stageEnteredAt: new Date(Date.now() - 30 * HOUR) });
    await checkStageSla();
    expect(await alerts("stage_sla_breach", c.id)).toBe(1);

    await prisma.notification.updateMany({ where: { type: "stage_sla_breach", userId: rmId }, data: { readAt: new Date() } });
    await checkStageSla();
    await checkStageSla();
    expect(await alerts("stage_sla_breach", c.id)).toBe(1);
  });

  it("alerts again for a new stay in a stage, and never for a client within its SLA", async () => {
    const breached = await client({ stageEnteredAt: new Date(Date.now() - 30 * HOUR) });
    const fresh = await client({ stageEnteredAt: new Date(Date.now() - 2 * HOUR) });
    await checkStageSla();

    // Time-shift: that alert went out 40h ago, then the client moved to a new stage 25h ago
    // (stageEnteredAt resets, after the alert) and has breached that stage's 24h SLA too.
    await prisma.client.update({
      where: { id: breached.id },
      data: { slaBreachNotifiedAt: new Date(Date.now() - 40 * HOUR), stageEnteredAt: new Date(Date.now() - 25 * HOUR) },
    });
    await checkStageSla();

    expect(await alerts("stage_sla_breach", breached.id)).toBe(2);
    expect(await alerts("stage_sla_breach", fresh.id)).toBe(0);
  });

  it("concurrent runs never alert twice", async () => {
    const c = await client({ stageEnteredAt: new Date(Date.now() - 30 * HOUR) });
    await Promise.all([checkStageSla(), checkStageSla(), checkStageSla()]);
    expect(await alerts("stage_sla_breach", c.id)).toBe(1);
  });

  it("a backlog of already-alerted breaches doesn't starve a new one", async () => {
    // 250 long-breached clients (older than any batch could cover) that were already alerted.
    const old = new Date(Date.now() - 400 * DAY);
    await prisma.client.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        organizationId: orgId,
        clientCode: `BACKLOG-${orgId}-${i}`,
        name: `Backlog ${i}`,
        mobile: "1",
        currentStageId: stageId,
        assignedToId: rmId,
        stageEnteredAt: old,
        slaBreachNotifiedAt: new Date(old.getTime() + 25 * HOUR),
      })),
    });
    const newest = await client({ stageEnteredAt: new Date(Date.now() - 30 * HOUR) });

    await checkStageSla();
    expect(await alerts("stage_sla_breach", newest.id)).toBe(1);
  });
});

describe("disengagement sweep", () => {
  it("alerts once per quiet spell, not again after the alert is read", async () => {
    const c = await client({ createdAt: new Date(Date.now() - 10 * DAY) });
    await checkDisengagement();
    await prisma.notification.updateMany({ where: { type: "client_disengaged", userId: rmId }, data: { readAt: new Date() } });
    await checkDisengagement();
    expect(await alerts("client_disengaged", c.id)).toBe(1);
  });

  it("re-alerts only after contact resumed and lapsed again", async () => {
    const c = await client({ createdAt: new Date(Date.now() - 40 * DAY) });
    // Alerted 30 days ago; contact resumed 20 days ago; quiet since.
    await prisma.client.update({ where: { id: c.id }, data: { disengagedNotifiedAt: new Date(Date.now() - 30 * DAY) } });
    await prisma.activity.create({
      data: { organizationId: orgId, clientId: c.id, type: "NOTE", payload: {}, createdAt: new Date(Date.now() - 20 * DAY) },
    });
    await checkDisengagement();
    expect(await alerts("client_disengaged", c.id)).toBe(1);
  });

  it("doesn't alert for recent contact, and concurrent runs never alert twice", async () => {
    const active = await client({ createdAt: new Date(Date.now() - 10 * DAY) });
    await prisma.activity.create({ data: { organizationId: orgId, clientId: active.id, type: "NOTE", payload: {} } });
    const quiet = await client({ createdAt: new Date(Date.now() - 10 * DAY) });

    await Promise.all([checkDisengagement(), checkDisengagement(), checkDisengagement()]);
    expect(await alerts("client_disengaged", active.id)).toBe(0);
    expect(await alerts("client_disengaged", quiet.id)).toBe(1);
  });
});

describe("overdue task sweep", () => {
  it("concurrent runs flag and alert each task once", async () => {
    const c = await client();
    const task = await prisma.task.create({
      data: { organizationId: orgId, clientId: c.id, assignedToId: rmId, title: "Call", dueAt: new Date(Date.now() - HOUR) },
    });
    await Promise.all([checkOverdueTasks(), checkOverdueTasks(), checkOverdueTasks()]);

    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("OVERDUE");
    expect(await prisma.notification.count({ where: { type: "task_overdue", payload: { path: ["taskId"], equals: task.id } } })).toBe(1);
  });
});
