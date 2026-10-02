import { afterAll, describe, expect, it, vi } from "vitest";

const stripeUpdate = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: vi.fn(async () => ({ items: { data: [{ id: "si_1", quantity: 1 }] } })),
      update: stripeUpdate,
    },
  }),
}));

import { assertSeatAvailable, countBillableSeats, remainingSeats, syncCrmSeatQuantity } from "@/lib/billing/seats";
import { getProductAccess } from "@/lib/billing/access";
import { resetMonthlyUsageForAnnualPlans } from "@/lib/billing/usage-reset";
import { createOrg, createUser, deleteOrgs, prisma } from "../helpers";

const orgs: string[] = [];
afterAll(() => deleteOrgs(...orgs));

describe("CRM seats", () => {
  it("counts only active users and enforces the cap", async () => {
    const { org } = await createOrg({ products: [{ product: "CRM", planId: "starter", seats: 3, stripeSubscriptionId: "sub_seats" }] });
    orgs.push(org.id);
    await createUser(org.id);
    await createUser(org.id, { role: "RM", orgRole: "MEMBER" });
    await createUser(org.id, { role: "RM", orgRole: "MEMBER", isActive: false });
    expect(await countBillableSeats(org.id)).toBe(2);
    expect(await remainingSeats(org.id)).toBe(1);
    await expect(assertSeatAvailable(org.id)).resolves.toBeUndefined();
    await createUser(org.id, { role: "RM", orgRole: "MEMBER" });
    await expect(assertSeatAvailable(org.id)).rejects.toThrow(/no free seats/);
  });

  it("syncs the Stripe quantity to the active-seat count with proration", async () => {
    const { org } = await createOrg({ products: [{ product: "CRM", planId: "growth", seats: 20, stripeSubscriptionId: "sub_sync" }] });
    orgs.push(org.id);
    await createUser(org.id);
    await createUser(org.id, { role: "RM", orgRole: "MEMBER" });
    await syncCrmSeatQuantity(org.id);
    expect(stripeUpdate).toHaveBeenCalledWith("sub_sync", { items: [{ id: "si_1", quantity: 2 }], proration_behavior: "create_prorations" });
  });
});

describe("product access", () => {
  it("allows live trials and blocks expired ones", async () => {
    const { org } = await createOrg({ products: [{ product: "CRM", status: "TRIALING", trialEndsAt: new Date(Date.now() + 86_400_000) }, { product: "QA_SENTINEL", status: "TRIALING", trialEndsAt: new Date(Date.now() - 1000) }] });
    orgs.push(org.id);
    expect((await getProductAccess(org.id, "CRM")).allowed).toBe(true);
    expect((await getProductAccess(org.id, "QA_SENTINEL")).allowed).toBe(false);
  });

  it("keeps access for 7 days after a failed payment", async () => {
    const { org } = await createOrg({ products: [{ product: "CRM", status: "PAST_DUE" }] });
    orgs.push(org.id);
    await prisma.productSubscription.updateMany({ where: { organizationId: org.id }, data: { pastDueSince: new Date(Date.now() - 2 * 86_400_000) } });
    expect((await getProductAccess(org.id, "CRM")).allowed).toBe(true);
    await prisma.productSubscription.updateMany({ where: { organizationId: org.id }, data: { pastDueSince: new Date(Date.now() - 8 * 86_400_000) } });
    expect((await getProductAccess(org.id, "CRM")).allowed).toBe(false);
  });

  it("resets annual plans' monthly quota after a month, and leaves monthly plans alone", async () => {
    const { org } = await createOrg({ products: [{ product: "QA_SENTINEL", planId: "growth", billingInterval: "year" }, { product: "CRM", planId: "growth", billingInterval: "month" }] });
    orgs.push(org.id);
    const old = new Date(Date.now() - 40 * 86_400_000);
    await prisma.productSubscription.updateMany({ where: { organizationId: org.id }, data: { reviewsUsedThisPeriod: 99, usagePeriodStart: old } });
    await resetMonthlyUsageForAnnualPlans();
    const rows = await prisma.productSubscription.findMany({ where: { organizationId: org.id } });
    expect(rows.find((r) => r.product === "QA_SENTINEL")!.reviewsUsedThisPeriod).toBe(0);
    expect(rows.find((r) => r.product === "CRM")!.reviewsUsedThisPeriod).toBe(99);
  });
});
