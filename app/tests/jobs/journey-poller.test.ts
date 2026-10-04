import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { processDueJourneySteps } from "@/lib/journeys/poller";
import { advanceRun } from "@/lib/journeys/engine";
import { createClient, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

// Only the claiming is under test here: advanceRun stands in for "send the journey's next message".
vi.mock("@/lib/journeys/engine", () => ({ advanceRun: vi.fn() }));

let orgId: string;
let runA: string;
let runB: string;
let runLater: string;

async function runWithStep(journeyId: string, clientId: string, scheduledFor: Date) {
  const run = await prisma.journeyRun.create({ data: { organizationId: orgId, journeyId, clientId, status: "WAITING", currentNodeId: "wait" } });
  await prisma.journeyRunStep.create({ data: { runId: run.id, nodeId: "wait", nodeType: "wait", status: "pending", scheduledFor } });
  return run.id;
}

beforeAll(async () => {
  const { org, stage } = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
  orgId = org.id;
  const owner = await createUser(orgId);
  const client = await createClient(orgId, stage.id);
  const journey = await prisma.journey.create({ data: { organizationId: orgId, name: "j", definition: {}, createdById: owner.id } });
  const due = new Date(Date.now() - 60_000);
  runA = await runWithStep(journey.id, client.id, due);
  runB = await runWithStep(journey.id, client.id, due);
  runLater = await runWithStep(journey.id, client.id, new Date(Date.now() + 3_600_000));
});
afterAll(() => deleteOrgs(orgId));
beforeEach(() => vi.mocked(advanceRun).mockReset());

const advancedRuns = () => vi.mocked(advanceRun).mock.calls.map(([runId]) => runId);

describe("journey poller", () => {
  it("overlapping polls advance each due run exactly once, and leave future steps alone", async () => {
    await Promise.all([processDueJourneySteps(), processDueJourneySteps(), processDueJourneySteps()]);
    const runs = advancedRuns().filter((id) => [runA, runB, runLater].includes(id));
    expect(runs.sort()).toEqual([runA, runB].sort());
  });

  it("doesn't re-advance a claimed run while its lease holds (e.g. the next tick)", async () => {
    await processDueJourneySteps();
    expect(advancedRuns().filter((id) => [runA, runB].includes(id))).toEqual([]);
  });

  it("retries a run once its lease expires, and one failing run doesn't stop the others", async () => {
    await prisma.journeyRunStep.updateMany({ where: { runId: { in: [runA, runB] } }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
    vi.mocked(advanceRun).mockImplementation(async (runId) => {
      if (runId === runA) throw new Error("provider down");
    });

    const result = await processDueJourneySteps();
    expect(advancedRuns()).toEqual(expect.arrayContaining([runA, runB]));
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });
});
