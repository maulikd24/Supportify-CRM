import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { POST } from "@/app/api/webhooks/stripe/route";
import { createTenant, type Tenant } from "../helpers/fixtures";

const stripe = new Stripe("sk_test_harness");
let org: Tenant;
let seq = 0;

/** Delivers a correctly signed Stripe event to the real route handler. */
async function deliver(type: string, object: object, id = `evt_${Date.now()}_${seq++}`) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  const res = await POST(
    new Request("https://app.test/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature }, body: payload }),
  );
  return { id, status: res.status, body: await res.json() };
}

const subscription = (planId: string) => ({
  id: `sub_${org.organizationId}`,
  object: "subscription",
  status: "active",
  metadata: { organizationId: org.organizationId, product: "QA_SENTINEL", planId },
  items: { data: [{ price: { id: "price_x" }, current_period_end: Math.floor(Date.now() / 1000) + 86_400 }] },
});
const invoice = (billingReason: string) => ({
  id: `in_${seq++}`,
  object: "invoice",
  billing_reason: billingReason,
  parent: { subscription_details: { subscription: `sub_${org.organizationId}` } },
});

async function qaSub() {
  return prisma.productSubscription.findUniqueOrThrow({
    where: { organizationId_product: { organizationId: org.organizationId, product: "QA_SENTINEL" } },
  });
}

beforeEach(async () => {
  org = await createTenant("S");
  await deliver("customer.subscription.updated", subscription("starter"));
  await prisma.productSubscription.update({ where: { id: (await qaSub()).id }, data: { reviewsUsedThisPeriod: 40 } });
});

describe("Stripe webhook (audit P0 #4)", () => {
  it("rejects an unsigned/forged event", async () => {
    const res = await POST(new Request("https://app.test/x", { method: "POST", headers: { "stripe-signature": "t=1,v1=bad" }, body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("sets the paid plan's quota instead of leaving it unlimited", async () => {
    expect((await qaSub()).reviewQuota).toBe(100); // starter
    await deliver("customer.subscription.updated", subscription("growth"));
    expect((await qaSub()).reviewQuota).toBe(500);
  });

  it("does NOT reset usage on a non-renewal subscription update", async () => {
    await deliver("customer.subscription.updated", subscription("starter"));
    expect((await qaSub()).reviewsUsedThisPeriod).toBe(40);
  });

  it("resets usage only on a renewal invoice", async () => {
    await deliver("invoice.paid", invoice("subscription_create"));
    expect((await qaSub()).reviewsUsedThisPeriod).toBe(40);
    await deliver("invoice.paid", invoice("subscription_cycle"));
    expect((await qaSub()).reviewsUsedThisPeriod).toBe(0);
  });

  it("ignores a redelivered event instead of applying it twice", async () => {
    const first = await deliver("invoice.paid", invoice("subscription_cycle"));
    expect((await qaSub()).reviewsUsedThisPeriod).toBe(0);

    await prisma.productSubscription.update({ where: { id: (await qaSub()).id }, data: { reviewsUsedThisPeriod: 7 } });
    const replay = await deliver("invoice.paid", invoice("subscription_cycle"), first.id);

    expect(replay.body).toMatchObject({ duplicate: true });
    expect((await qaSub()).reviewsUsedThisPeriod).toBe(7);
  });
});
