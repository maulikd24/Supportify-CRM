import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCoachingAction, updateCoachingAction } from "@/app/qa/coaching/actions";
import { raiseDisputeAction, resolveDisputeAction } from "@/app/qa/disputes/actions";
import { normalizeCriteria } from "@/lib/qa/scorecard";
import { asUser, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let org: string, starter: string, other: string;
let admin: U, lead: U, agentUser: U, starterAdmin: U;
let reviewId: string, otherReviewId: string, starterReviewId: string;

const criteria = normalizeCriteria([
  { label: "Politeness", description: "", weight: 1, autoFailBelow: null },
  { label: "Refund policy", description: "", weight: 3, autoFailBelow: 40 },
]);

async function review(organizationId: string, scores: Record<string, number>, overall: number, autoFailed = false) {
  return (
    await prisma.ticketReview.create({
      data: {
        organizationId,
        ticketId: `T-${Math.random().toString(36).slice(2, 7)}`,
        agentEmail: "Sam@Acme.test",
        agentName: "Sam",
        overallScore: overall,
        criteriaScores: scores,
        scorecardSnapshot: { name: "Refunds", criteria },
        autoFailed,
        autoFailReasons: autoFailed ? ["Refund policy"] : [],
      },
    })
  ).id;
}

beforeAll(async () => {
  org = (await createOrg({ products: [{ product: "QA_SENTINEL", planId: "growth", reviewQuota: 500 }] })).org.id;
  starter = (await createOrg({ products: [{ product: "QA_SENTINEL", planId: "starter", reviewQuota: 100 }] })).org.id;
  other = (await createOrg({ products: [{ product: "QA_SENTINEL", planId: "growth", reviewQuota: 500 }] })).org.id;
  admin = await createUser(org);
  lead = await createUser(org, { role: "RM", orgRole: "MEMBER" });
  agentUser = await prisma.user.create({
    data: { organizationId: org, name: "Sam", email: `sam-${org}@acme.test`, passwordHash: "x", role: "RM", orgRole: "MEMBER" },
  });
  starterAdmin = await createUser(starter);
  reviewId = await review(org, { politeness: 90, refund_policy: 30 }, 0, true);
  otherReviewId = await review(other, { politeness: 90, refund_policy: 30 }, 0, true);
  starterReviewId = await review(starter, { politeness: 90, refund_policy: 30 }, 0, true);
});
beforeEach(() => asUser(lead));
afterAll(() => deleteOrgs(org, starter, other));

describe("coaching", () => {
  it("lets any team member assign coaching from a review and walks it to completion", async () => {
    const { id } = (await createCoachingAction({ agentEmail: "sam@acme.test", reviewId, focusAreas: ["Refund policy"], notes: "Check the refund window first.", dueDate: "2026-12-01" })) as { id: string };
    const created = await prisma.coachingSession.findUniqueOrThrow({ where: { id } });
    expect([created.agentName, created.coachId, created.status]).toEqual(["Sam", lead.id, "ASSIGNED"]);

    await updateCoachingAction(id, { status: "ACKNOWLEDGED", agentResponse: "Will do" });
    await updateCoachingAction(id, { status: "COMPLETED", outcome: "Next 5 refunds were correct" });
    const done = await prisma.coachingSession.findUniqueOrThrow({ where: { id } });
    expect([done.status, done.agentResponse, done.outcome]).toEqual(["COMPLETED", "Will do", "Next 5 refunds were correct"]);
    expect(done.acknowledgedAt && done.completedAt).toBeTruthy();
    expect(await updateCoachingAction(id, { status: "CANCELLED" })).toEqual({ __actionError: "This session is already completed" });
    expect(await prisma.auditLog.count({ where: { organizationId: org, entityId: id } })).toBe(3);
  });

  it("notifies the agent when they have a Supportify login", async () => {
    const r = await prisma.ticketReview.create({ data: { organizationId: org, ticketId: "T-agent", agentEmail: agentUser.email.toUpperCase(), agentName: "Sam" } });
    await createCoachingAction({ agentEmail: agentUser.email, reviewId: r.id, focusAreas: [], notes: "Nice work, one tip.", dueDate: null });
    expect(await prisma.notification.count({ where: { userId: agentUser.id, type: "qa_coaching_assigned" } })).toBe(1);
  });

  it("only the coach or an admin can update a session", async () => {
    asUser(admin);
    const { id } = (await createCoachingAction({ agentEmail: "sam@acme.test", reviewId: null, focusAreas: [], notes: "Admin's session", dueDate: null })) as { id: string };
    asUser(lead);
    expect(await updateCoachingAction(id, { status: "CANCELLED" })).toEqual({ __actionError: "Only the coach or an admin can update this session" });
  });

  it("rejects agents and reviews from another organization, and Starter plans", async () => {
    expect(await createCoachingAction({ agentEmail: "sam@acme.test", reviewId: otherReviewId, focusAreas: [], notes: "x", dueDate: null })).toEqual({ __actionError: "Review not found" });
    expect(await createCoachingAction({ agentEmail: "nobody@acme.test", reviewId: null, focusAreas: [], notes: "x", dueDate: null })).toEqual({ __actionError: "No reviews found for that agent" });
    const otherSession = await prisma.coachingSession.create({ data: { organizationId: other, agentEmail: "sam@acme.test", coachId: admin.id, notes: "x" } });
    asUser(admin);
    expect(await updateCoachingAction(otherSession.id, { status: "CANCELLED" })).toEqual({ __actionError: "Coaching session not found" });
    asUser(starterAdmin);
    expect(await createCoachingAction({ agentEmail: "sam@acme.test", reviewId: starterReviewId, focusAreas: [], notes: "x", dueDate: null })).toEqual({
      __actionError: expect.stringMatching(/Growth plans and above/),
    });
  });
});

describe("disputes", () => {
  it("raises one open dispute per review and notifies admins", async () => {
    const { id } = (await raiseDisputeAction(reviewId, { criterionKey: "refund_policy", reason: "Order was within the 30-day window." })) as { id: string };
    expect(await raiseDisputeAction(reviewId, { criterionKey: null, reason: "Another complaint here" })).toEqual({ __actionError: "This review already has an open dispute" });
    expect(await prisma.notification.count({ where: { userId: admin.id, type: "qa_dispute_raised", payload: { path: ["disputeId"], equals: id } } })).toBe(1);
    const fresh = await review(org, { politeness: 50, refund_policy: 50 }, 50);
    expect(await raiseDisputeAction(fresh, { criterionKey: "made_up", reason: "This criterion doesn't exist" })).toEqual({ __actionError: "Pick one of this review's criteria" });
    expect(await raiseDisputeAction(fresh, { criterionKey: null, reason: "short" })).toEqual({ __actionError: expect.stringMatching(/at least 10 characters/) });
  });

  it("only owners and admins resolve; adjusting recalculates the weighted score and clears the auto-fail", async () => {
    const dispute = await prisma.reviewDispute.findFirstOrThrow({ where: { reviewId, status: "OPEN" } });
    await expect(resolveDisputeAction(dispute.id, { decision: "uphold", note: "No" })).rejects.toThrow();

    asUser(admin);
    expect(await resolveDisputeAction(dispute.id, { decision: "adjust", note: "x", scores: { refund_policy: 30 } })).toEqual({
      __actionError: "Change at least one score, or uphold the original",
    });
    await resolveDisputeAction(dispute.id, { decision: "adjust", note: "Agreed, refund was in policy.", scores: { refund_policy: 70 } });

    const after = await prisma.ticketReview.findUniqueOrThrow({ where: { id: reviewId } });
    // (90×1 + 70×3) / 4 = 75, and 70 clears the auto-fail threshold of 40.
    expect([after.overallScore, after.autoFailed, after.criteriaScores]).toEqual([75, false, { politeness: 90, refund_policy: 70 }]);
    const resolved = await prisma.reviewDispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect([resolved.status, resolved.originalScore, resolved.adjustedScore, resolved.resolvedById]).toEqual(["ADJUSTED", 0, 75, admin.id]);
    expect(await prisma.notification.count({ where: { userId: lead.id, type: "qa_dispute_resolved" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: org, action: "qa.review_score_adjusted", entityId: reviewId } })).toBe(1);
    expect(await resolveDisputeAction(dispute.id, { decision: "uphold", note: "again" })).toEqual({ __actionError: "This dispute has already been resolved" });
  });

  it("upholding leaves the score unchanged", async () => {
    const { id } = (await raiseDisputeAction(reviewId, { criterionKey: null, reason: "Overall still feels too low." })) as { id: string };
    asUser(admin);
    await resolveDisputeAction(id, { decision: "uphold", note: "75 is fair." });
    expect((await prisma.ticketReview.findUniqueOrThrow({ where: { id: reviewId } })).overallScore).toBe(75);
    expect((await prisma.reviewDispute.findUniqueOrThrow({ where: { id } })).status).toBe("UPHELD");
  });

  it("can't dispute or resolve across organizations, or on Starter", async () => {
    expect(await raiseDisputeAction(otherReviewId, { criterionKey: null, reason: "Not my org's review" })).toEqual({ __actionError: "Review not found" });
    const foreign = await prisma.reviewDispute.create({ data: { organizationId: other, reviewId: otherReviewId, raisedById: admin.id, reason: "x" } });
    asUser(admin);
    expect(await resolveDisputeAction(foreign.id, { decision: "adjust", note: "x", scores: { refund_policy: 100 } })).toEqual({ __actionError: "Dispute not found" });
    expect((await prisma.ticketReview.findUniqueOrThrow({ where: { id: otherReviewId } })).overallScore).toBe(0);
    asUser(starterAdmin);
    expect(await raiseDisputeAction(starterReviewId, { criterionKey: null, reason: "Starter plan dispute" })).toEqual({
      __actionError: expect.stringMatching(/Growth plans and above/),
    });
  });
});
