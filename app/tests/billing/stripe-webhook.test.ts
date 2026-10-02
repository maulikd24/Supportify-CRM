import Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";

const realStripe = new Stripe("sk_test_dummy");
const retrieve = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => ({ webhooks: realStripe.webhooks, subscriptions: { retrieve } }) }));

import { POST } from "@/app/api/webhooks/stripe/route";
import { createOrg, deleteOrgs, prisma } from "../helpers";

const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

function subscription(orgId: string, product: string, status: string, planId: string, periodEnd: number, interval = "month") {
  return {
    id: `sub_${orgId}_${product}`,
    object: "subscription",
    status,
    metadata: { organizationId: orgId, product, planId },
    items: { data: [{ id: "si_1", quantity: 1, price: { id: "price_plan", recurring: { interval, usage_type: "licensed" } }, current_period_end: periodEnd }] },
  };
}

async function send(type: string, object: unknown, secret = SECRET) {
  const payload = JSON.stringify({ id: `evt_${Math.random()}`, object: "event", type, data: { object } });
  const header = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  return POST(new Request("http://test/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header }, body: payload }));
}

const T1 = 1_790_000_000;
const T2 = T1 + 30 * 86_400;
const orgs: string[] = [];
afterAll(() => deleteOrgs(...orgs));

describe("Stripe webhook", () => {
  it("rejects a bad signature", async () => {
    const res = await send("customer.subscription.updated", {}, "whsec_wrong");
    expect(res.status).toBe(400);
  });

  it("converts a trial to paid with the plan's limits, and only resets usage on a new period", async () => {
    const { org } = await createOrg({ products: [{ product: "QA_SENTINEL", status: "TRIALING", reviewQuota: 50, trialEndsAt: new Date(Date.now() + 86_400_000) }] });
    orgs.push(org.id);
    const row = () => prisma.productSubscription.findUniqueOrThrow({ where: { organizationId_product: { organizationId: org.id, product: "QA_SENTINEL" } } });
    await prisma.productSubscription.updateMany({ where: { organizationId: org.id }, data: { reviewsUsedThisPeriod: 30 } });

    expect((await send("customer.subscription.updated", subscription(org.id, "QA_SENTINEL", "active", "growth", T1))).status).toBe(200);
    let r = await row();
    expect([r.status, r.planId, r.reviewQuota, r.reviewsUsedThisPeriod, r.trialEndsAt, r.billingInterval]).toEqual(["ACTIVE", "growth", 500, 0, null, "month"]);

    await prisma.productSubscription.updateMany({ where: { organizationId: org.id }, data: { reviewsUsedThisPeriod: 40 } });
    await send("customer.subscription.updated", subscription(org.id, "QA_SENTINEL", "active", "growth", T1));
    expect((await row()).reviewsUsedThisPeriod).toBe(40);

    await send("customer.subscription.updated", subscription(org.id, "QA_SENTINEL", "active", "growth", T2));
    expect((await row()).reviewsUsedThisPeriod).toBe(0);

    await send("customer.subscription.updated", subscription(org.id, "QA_SENTINEL", "past_due", "growth", T2));
    r = await row();
    expect(r.status).toBe("PAST_DUE");
    expect(r.pastDueSince).not.toBeNull();

    await send("customer.subscription.updated", subscription(org.id, "QA_SENTINEL", "active", "growth", T2));
    expect((await row()).pastDueSince).toBeNull();

    const audit = await prisma.auditLog.findMany({ where: { organizationId: org.id, action: "billing.subscription_updated" } });
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(audit.every((a) => a.userId === null)).toBe(true);
  });

  it("records the annual interval and keeps admin-set Enterprise limits", async () => {
    const { org } = await createOrg({ products: [{ product: "CRM", planId: "enterprise", seats: 75 }] });
    orgs.push(org.id);
    await send("customer.subscription.updated", subscription(org.id, "CRM", "active", "enterprise", T1, "year"));
    const r = await prisma.productSubscription.findFirstOrThrow({ where: { organizationId: org.id, product: "CRM" } });
    expect(r.seats).toBe(75);
    expect(r.billingInterval).toBe("year");
  });

  it("marks a failed payment past due and starts the grace period", async () => {
    const { org } = await createOrg({ products: [{ product: "CRM", planId: "growth", seats: 20, stripeSubscriptionId: "sub_fail" }] });
    orgs.push(org.id);
    retrieve.mockResolvedValueOnce(subscription(org.id, "CRM", "past_due", "growth", T1));
    await send("invoice.payment_failed", { id: "in_1", object: "invoice", parent: { subscription_details: { subscription: "sub_fail" } } });
    const r = await prisma.productSubscription.findFirstOrThrow({ where: { organizationId: org.id, product: "CRM" } });
    expect(r.status).toBe("PAST_DUE");
    expect(r.pastDueSince).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { organizationId: org.id, action: "billing.payment_failed" } })).toBe(1);
  });
});
