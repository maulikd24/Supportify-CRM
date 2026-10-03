import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createReviewAction, createBulkReviewAction } from "@/app/qa/reviews/actions";
import { submitDsatAction } from "@/app/qa/dsat/actions";
import { runReview } from "@/lib/qa/run-review";
import { analyzeDsat } from "@/lib/qa/assessor";
import type { SubscriptionStatus } from "@/generated/prisma/client";
import { asUser, createOrg, createUser, deleteOrgs, isRedirect, prisma } from "../helpers";

vi.mock("@/lib/qa/run-review", () => ({ runReview: vi.fn() }));
vi.mock("@/lib/qa/assessor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/qa/assessor")>()),
  analyzeDsat: vi.fn(),
}));

/**
 * The /qa layout bounces lapsed orgs to /billing, but server actions are
 * separately callable endpoints. Each paid (LLM-backed) action must check the
 * subscription itself — quota alone isn't enough, since a canceled plan can
 * still have unused quota left.
 */
const orgIds: string[] = [];
afterAll(() => deleteOrgs(...orgIds));
beforeEach(() => {
  vi.mocked(runReview).mockReset();
  vi.mocked(analyzeDsat).mockReset();
});

async function lapsedOrg(status: SubscriptionStatus, trialEndsAt: Date | null = null) {
  const { org } = await createOrg({
    products: [{ product: "QA_SENTINEL", status, planId: "starter", reviewQuota: 100, trialEndsAt }],
  });
  orgIds.push(org.id);
  const admin = await createUser(org.id);
  const sop = await prisma.sopDocument.create({ data: { organizationId: org.id, name: "SOP", content: "Be kind." } });
  await prisma.helpdeskConnection.create({
    data: { organizationId: org.id, provider: "zendesk", accountLabel: "x.zendesk.com", encryptedCredentials: "x", isValid: true },
  });
  asUser(admin);
  return { org, sop };
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describe.each([
  ["canceled", () => lapsedOrg("CANCELED")],
  ["expired trial", () => lapsedOrg("TRIALING", new Date(Date.now() - 60_000))],
])("QA actions for a %s subscription with quota left", (_, setup) => {
  it("refuse to run reviews or DSAT analysis — before any LLM call or quota use", async () => {
    const { org, sop } = await setup();

    for (const attempt of [
      () => createReviewAction(form({ ticketId: "1", sopId: sop.id })),
      () => createBulkReviewAction("1\n2", sop.id),
      () => submitDsatAction(form({ inputMode: "manual", manualConversation: "[CUSTOMER]: hi\n[AGENT]: hello" })),
    ]) {
      const error = await attempt().then(() => null, (e: unknown) => e);
      expect(isRedirect(error, "/billing/QA_SENTINEL")).toBe(true);
    }

    expect(runReview).not.toHaveBeenCalled();
    expect(analyzeDsat).not.toHaveBeenCalled();
    const sub = await prisma.productSubscription.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(sub.reviewsUsedThisPeriod).toBe(0);
  });
});
