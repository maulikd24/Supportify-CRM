import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => ({ billing: { meterEvents: { create: vi.fn() } } }) }));

import { claimReviewSlot, overageAvailability, releaseReviewSlot } from "@/lib/qa/usage";
import { createOrg, deleteOrgs, prisma } from "../helpers";

const orgs: string[] = [];
async function qaOrg(sub: NonNullable<Parameters<typeof createOrg>[0]>["products"]) {
  const { org } = await createOrg({ products: sub });
  orgs.push(org.id);
  return org.id;
}
const sub = (orgId: string) =>
  prisma.productSubscription.findUniqueOrThrow({ where: { organizationId_product: { organizationId: orgId, product: "QA_SENTINEL" } } });

describe("review quota and overages", () => {
  beforeEach(() => {
    process.env.STRIPE_METER_EVENT_QA_REVIEW = "qa_review";
    process.env.STRIPE_PRICE_QA_OVERAGE = "price_overage";
  });
  afterAll(() => deleteOrgs(...orgs));

  it("uses included reviews, then stops with an upgrade hint when overages are off", async () => {
    const id = await qaOrg([{ product: "QA_SENTINEL", planId: "starter", reviewQuota: 2, stripeSubscriptionId: "sub_1", billingInterval: "month" }]);
    expect(await claimReviewSlot(id)).toEqual({ ok: true, overage: false });
    expect(await claimReviewSlot(id)).toEqual({ ok: true, overage: false });
    const blocked = await claimReviewSlot(id);
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.code).toBe("quota");
    expect(!blocked.ok && blocked.reason).toMatch(/Turn on overages/);
    expect((await sub(id)).reviewsUsedThisPeriod).toBe(2);
  });

  it("bills overages up to the cap when opted in", async () => {
    const id = await qaOrg([{ product: "QA_SENTINEL", planId: "starter", reviewQuota: 1, stripeSubscriptionId: "sub_2", billingInterval: "month" }]);
    await prisma.productSubscription.updateMany({ where: { organizationId: id }, data: { allowOverage: true, overageCap: 2 } });
    expect(await claimReviewSlot(id)).toEqual({ ok: true, overage: false });
    expect(await claimReviewSlot(id)).toEqual({ ok: true, overage: true });
    expect(await claimReviewSlot(id)).toEqual({ ok: true, overage: true });
    const capped = await claimReviewSlot(id);
    expect(!capped.ok && capped.code).toBe("overage_cap");
    expect((await sub(id)).overageReviewsThisPeriod).toBe(2);
  });

  it("never lets a trial go into overage", async () => {
    const id = await qaOrg([{ product: "QA_SENTINEL", status: "TRIALING", reviewQuota: 1, trialEndsAt: new Date(Date.now() + 86_400_000) }]);
    await prisma.productSubscription.updateMany({ where: { organizationId: id }, data: { allowOverage: true } });
    await claimReviewSlot(id);
    const blocked = await claimReviewSlot(id);
    expect(!blocked.ok && blocked.reason).toMatch(/trial includes/i);
  });

  it("treats a null quota as unlimited and still counts usage", async () => {
    const id = await qaOrg([{ product: "QA_SENTINEL", planId: "enterprise", reviewQuota: null }]);
    for (let i = 0; i < 5; i++) expect((await claimReviewSlot(id)).ok).toBe(true);
    expect((await sub(id)).reviewsUsedThisPeriod).toBe(5);
  });

  it("is race-safe: concurrent claims never exceed the quota", async () => {
    const id = await qaOrg([{ product: "QA_SENTINEL", planId: "starter", reviewQuota: 3 }]);
    const results = await Promise.all(Array.from({ length: 8 }, () => claimReviewSlot(id)));
    expect(results.filter((r) => r.ok).length).toBe(3);
    expect((await sub(id)).reviewsUsedThisPeriod).toBe(3);
  });

  it("gives a slot back when a review fails", async () => {
    const id = await qaOrg([{ product: "QA_SENTINEL", planId: "starter", reviewQuota: 5 }]);
    await claimReviewSlot(id);
    await releaseReviewSlot(id, false);
    expect((await sub(id)).reviewsUsedThisPeriod).toBe(0);
    await releaseReviewSlot(id, false); // never goes negative
    expect((await sub(id)).reviewsUsedThisPeriod).toBe(0);
  });

  it("offers overages only on paid monthly plans with Stripe metering configured", () => {
    const paid = { status: "ACTIVE" as const, stripeSubscriptionId: "s", allowOverage: true, billingInterval: "month" };
    expect(overageAvailability(paid).available).toBe(true);
    expect(overageAvailability({ ...paid, billingInterval: "year" }).available).toBe(false);
    expect(overageAvailability({ ...paid, status: "TRIALING" }).available).toBe(false);
    expect(overageAvailability({ ...paid, stripeSubscriptionId: null }).available).toBe(false);
    delete process.env.STRIPE_PRICE_QA_OVERAGE;
    expect(overageAvailability(paid).available).toBe(false);
  });
});
