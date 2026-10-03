import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { assessTicket, analyzeDsat } from "@/lib/qa/assessor";
import { TRIAL_REVIEW_QUOTA } from "@/lib/billing/plans";
import { createBulkReviewAction, createReviewAction } from "@/app/qa/reviews/actions";
import { submitDsatAction } from "@/app/qa/dsat/actions";
import { createTenant, type Tenant } from "../helpers/fixtures";
import { actAs, RedirectError } from "../helpers/session";
import { fd } from "../isolation/cases";

vi.mock("@/lib/qa/zendesk-client", () => ({
  ZendeskAuthError: class extends Error {},
  ZendeskClient: class {
    async getTicketWithConversation() {
      return { ticket: { subject: "s" }, conversation: [], agentName: "Agent", agentEmail: "agent@example.test" };
    }
  },
}));

const REVIEW = {
  result: { overall_score: 90, criteria_scores: {}, summary: "ok" },
  usage: { input_tokens: 1, output_tokens: 1, cost_usd: 0 },
};

let org: Tenant;

async function setQuota(quota: number | null, used = 0) {
  await prisma.productSubscription.update({
    where: { organizationId_product: { organizationId: org.organizationId, product: "QA_SENTINEL" } },
    data: { reviewQuota: quota, reviewsUsedThisPeriod: used },
  });
}
async function used() {
  const sub = await prisma.productSubscription.findUniqueOrThrow({
    where: { organizationId_product: { organizationId: org.organizationId, product: "QA_SENTINEL" } },
  });
  return sub.reviewsUsedThisPeriod;
}
const review = () => createReviewAction(fd({ ticketId: "1001", sopId: org.ids.sop }));

beforeEach(async () => {
  vi.mocked(assessTicket).mockReset().mockResolvedValue(REVIEW as never);
  vi.mocked(analyzeDsat).mockReset();
  org = await createTenant("Q");
  actAs(org.admin);
});

describe("QA review quota (audit P0 #3)", () => {
  it("gives new self-serve trials a finite review quota", async () => {
    const sub = await prisma.productSubscription.findUniqueOrThrow({
      where: { organizationId_product: { organizationId: org.organizationId, product: "QA_SENTINEL" } },
    });
    expect(sub.reviewQuota).toBe(TRIAL_REVIEW_QUOTA);
  });

  it("never overshoots the quota under concurrent reviews", async () => {
    await setQuota(3);
    const results = await Promise.allSettled(Array.from({ length: 10 }, review));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await used()).toBe(3);
    expect(vi.mocked(assessTicket)).toHaveBeenCalledTimes(3); // blocked calls never reach the LLM
  });

  it("refunds the reservation when the review itself fails", async () => {
    await setQuota(5, 2);
    vi.mocked(assessTicket).mockRejectedValueOnce(new Error("LLM down"));
    await expect(review()).rejects.toThrow("LLM down");
    expect(await used()).toBe(2);
  });

  it("bulk review stops exactly at the remaining quota", async () => {
    await setQuota(4, 2);
    const summary = await createBulkReviewAction("1\n2\n3\n4\n5", org.ids.sop);
    expect(summary).toMatchObject({ reviewed: 2, quotaBlocked: 3, failed: 0 });
    expect(await used()).toBe(4);
  });

  it("null quota (enterprise) stays unlimited but still meters usage", async () => {
    await setQuota(null, 1000);
    await review();
    expect(await used()).toBe(1001);
  });
});

describe("QA actions require an active subscription (audit P0 #3)", () => {
  const expectBillingRedirect = async (p: Promise<unknown>) => {
    const error = await p.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(RedirectError);
    expect((error as RedirectError).url).toBe("/billing/QA_SENTINEL");
  };

  it("blocks reviews and DSAT once the trial has expired — before any LLM call", async () => {
    await prisma.productSubscription.update({
      where: { organizationId_product: { organizationId: org.organizationId, product: "QA_SENTINEL" } },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    await expectBillingRedirect(review());
    await expectBillingRedirect(createBulkReviewAction("1", org.ids.sop));
    await expectBillingRedirect(submitDsatAction(fd({ inputMode: "manual", manualConversation: "[CUSTOMER]: hi" })));
    expect(vi.mocked(assessTicket)).not.toHaveBeenCalled();
    expect(vi.mocked(analyzeDsat)).not.toHaveBeenCalled();
  });

  it("blocks an org with no QA subscription at all", async () => {
    await prisma.productSubscription.delete({
      where: { organizationId_product: { organizationId: org.organizationId, product: "QA_SENTINEL" } },
    });
    await expectBillingRedirect(review());
    expect(vi.mocked(assessTicket)).not.toHaveBeenCalled();
  });
});
