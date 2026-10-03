import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { inviteAgentAction, resendAgentInviteAction, setAgentActiveAction } from "@/app/qa/agents/actions";
import { acknowledgeCoachingAction, raiseMyDisputeAction } from "@/app/portal/actions";
import { createCoachingAction } from "@/app/qa/coaching/actions";
import { saveAuditorCommentAction } from "@/app/qa/reviews/actions";
import { setUserRoleAction } from "@/app/(dashboard)/settings/users/actions";
import { countBillableSeats } from "@/lib/billing/seats";
import { agentIdentity, agentReviewsWhere } from "@/lib/qa/portal";
import { asUser, createOrg, createUser, deleteOrgs, isRedirect, prisma } from "../helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let org: string, trialOrg: string, starterOrg: string, other: string;
let admin: U, trialAdmin: U, starterAdmin: U, otherAdmin: U, agent: U, teammate: U;
let myReview: string, teammateReview: string, myCoaching: string, teammateCoaching: string;

const uid = () => Math.random().toString(36).slice(2, 8);

async function makeAgent(organizationId: string, helpdeskEmail: string | null = null) {
  const id = `ag_${uid()}`;
  return prisma.user.create({
    data: { id, organizationId, name: `Agent ${id}`, email: `${id}@login.test`, helpdeskEmail, passwordHash: "x", role: "RM", orgRole: "AGENT" },
  });
}

beforeAll(async () => {
  org = (await createOrg({ products: [{ product: "CRM", planId: "growth", seats: 20 }, { product: "QA_SENTINEL", planId: "growth", reviewQuota: 500 }] })).org.id;
  trialOrg = (await createOrg({ products: [{ product: "QA_SENTINEL", status: "TRIALING", trialEndsAt: new Date(Date.now() + 7 * 86_400_000) }] })).org.id;
  starterOrg = (await createOrg({ products: [{ product: "QA_SENTINEL", planId: "starter", reviewQuota: 100 }] })).org.id;
  other = (await createOrg({ products: [{ product: "QA_SENTINEL", planId: "growth", reviewQuota: 500 }] })).org.id;
  admin = await createUser(org);
  trialAdmin = await createUser(trialOrg);
  starterAdmin = await createUser(starterOrg);
  otherAdmin = await createUser(other);
  // Reviews are filed under the Zendesk email, which differs from the agent's login.
  agent = await makeAgent(org, `zd-${uid()}@acme.test`);
  teammate = await makeAgent(org);
  myReview = (await prisma.ticketReview.create({ data: { organizationId: org, ticketId: "A-1", agentEmail: agent.helpdeskEmail!.toUpperCase(), overallScore: 60, criteriaScores: { accuracy: 60 } } })).id;
  teammateReview = (await prisma.ticketReview.create({ data: { organizationId: org, ticketId: "B-1", agentEmail: teammate.email, overallScore: 50, criteriaScores: { accuracy: 50 } } })).id;
  myCoaching = (await prisma.coachingSession.create({ data: { organizationId: org, agentEmail: agent.helpdeskEmail!, coachId: admin.id, notes: "Check the order first" } })).id;
  teammateCoaching = (await prisma.coachingSession.create({ data: { organizationId: org, agentEmail: teammate.email, coachId: admin.id, notes: "x" } })).id;
});
beforeEach(() => asUser(agent));
afterAll(() => deleteOrgs(org, trialOrg, starterOrg, other));

describe("agent logins are walled off from the team app", () => {
  it("are redirected to the portal from QA admin and CRM actions", async () => {
    for (const call of [
      () => createCoachingAction({ agentEmail: agent.helpdeskEmail!, reviewId: myReview, focusAreas: [], notes: "self", dueDate: null }),
      () => saveAuditorCommentAction(myReview, "I'm great"),
      () => setUserRoleAction(teammate.id, "ADMIN"),
      () => inviteAgentAction({ name: "x", email: "x@x.test" }),
    ]) {
      const error = await call().then(() => null, (e: unknown) => e);
      expect(isRedirect(error, "/portal")).toBe(true);
    }
  });

  it("never take a CRM seat", async () => {
    expect(await countBillableSeats(org)).toBe(1); // just the admin
  });

  it("see only their own reviews, matched by Zendesk email case-insensitively", async () => {
    const me = await agentIdentity(agent.id, org);
    const ids = (await prisma.ticketReview.findMany({ where: { organizationId: org, ...agentReviewsWhere(me.emails) }, select: { id: true } })).map((r) => r.id);
    expect(ids).toEqual([myReview]);
  });
});

describe("portal actions", () => {
  it("lets an agent dispute their own review, not a teammate's", async () => {
    expect(await raiseMyDisputeAction(teammateReview, { criterionKey: null, reason: "Not my ticket but disputing" })).toEqual({ __actionError: "Review not found" });
    const { id } = (await raiseMyDisputeAction(myReview, { criterionKey: "accuracy", reason: "The refund amount was correct." })) as { id: string };
    const dispute = await prisma.reviewDispute.findUniqueOrThrow({ where: { id } });
    expect([dispute.raisedById, dispute.criterionKey]).toEqual([agent.id, "accuracy"]);
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "qa_dispute_raised" } })).toBe(1);
  });

  it("lets an agent acknowledge their own coaching and notifies the coach", async () => {
    expect(await acknowledgeCoachingAction(teammateCoaching, { agentResponse: "ok" })).toEqual({ __actionError: "Coaching session not found" });
    await acknowledgeCoachingAction(myCoaching, { agentResponse: "Will do from now on" });
    const s = await prisma.coachingSession.findUniqueOrThrow({ where: { id: myCoaching } });
    expect([s.status, s.agentResponse]).toEqual(["ACKNOWLEDGED", "Will do from now on"]);
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "qa_coaching_acknowledged" } })).toBe(1);
    expect(await acknowledgeCoachingAction(myCoaching, { agentResponse: "again" })).toEqual({ __actionError: "This session has already been acknowledged" });
  });

  it("are for agents only", async () => {
    asUser(admin);
    const error = await raiseMyDisputeAction(myReview, { criterionKey: null, reason: "Admin pretending" }).then(() => null, (e: unknown) => e);
    expect(isRedirect(error, "/")).toBe(true);
  });
});

describe("inviting agents", () => {
  it("creates an agent login and emails a set-password link", async () => {
    asUser(admin);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const email = `new-${uid()}@acme.test`;
    expect(await inviteAgentAction({ name: "New Agent", email: email.toUpperCase(), helpdeskEmail: `zd-${email}` })).toEqual({ emailed: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect([user.orgRole, user.helpdeskEmail, user.organizationId]).toEqual(["AGENT", `zd-${email}`, org]);
    expect(await prisma.verificationToken.count({ where: { userId: user.id, purpose: "PASSWORD_RESET" } })).toBe(1);
    expect(warn.mock.calls.some(([m]) => String(m).includes("/reset-password/"))).toBe(true);
    expect(await inviteAgentAction({ name: "Dup", email })).toEqual({ __actionError: "Someone already has a Supportify account with that email" });
    warn.mockRestore();
  });

  it("enforces the plan's agent seats and the Growth gate", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    asUser(trialAdmin);
    for (let i = 0; i < 5; i++) await makeAgent(trialOrg);
    expect(await inviteAgentAction({ name: "Sixth", email: `six-${uid()}@acme.test` })).toEqual({ __actionError: expect.stringMatching(/includes 5 agent portal logins/) });
    const someone = await prisma.user.findFirstOrThrow({ where: { organizationId: trialOrg, orgRole: "AGENT" } });
    await setAgentActiveAction(someone.id, false);
    expect(await inviteAgentAction({ name: "Sixth", email: `six-${uid()}@acme.test` })).toEqual({ emailed: true });
    expect(await setAgentActiveAction(someone.id, true)).toEqual({ __actionError: expect.stringMatching(/all in use/) });

    asUser(starterAdmin);
    expect(await inviteAgentAction({ name: "x", email: `s-${uid()}@acme.test` })).toEqual({ __actionError: expect.stringMatching(/Growth plans and above/) });
    vi.restoreAllMocks();
  });

  it("removing access signs the agent out; other orgs' agents are off limits", async () => {
    asUser(admin);
    await setAgentActiveAction(teammate.id, false);
    const t = await prisma.user.findUniqueOrThrow({ where: { id: teammate.id } });
    expect([t.isActive, t.sessionsRevokedAt != null]).toEqual([false, true]);

    asUser(otherAdmin);
    expect(await setAgentActiveAction(agent.id, false)).toEqual({ __actionError: "Agent not found" });
    expect(await resendAgentInviteAction(agent.id)).toEqual({ __actionError: "Agent not found" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: agent.id } })).isActive).toBe(true);
  });
});
