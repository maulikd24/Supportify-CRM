import { afterAll, describe, expect, it } from "vitest";

import { firstUsableProductHome, subscriptionState } from "@/lib/billing/status";
import { createOrg, deleteOrgs } from "../helpers";

const DAY = 86_400_000;
const sub = (over: Partial<Parameters<typeof subscriptionState>[0] & object>) => ({
  status: "TRIALING" as const,
  trialEndsAt: null,
  currentPeriodEnd: null,
  pastDueSince: null,
  ...over,
});

describe("billing status wording", () => {
  it("an ended trial says it ended (it used to keep saying TRIALING with a past date)", () => {
    const ended = new Date(Date.UTC(2026, 9, 9, 12));
    expect(subscriptionState(sub({ trialEndsAt: ended }), false)).toEqual({ badge: "Trial ended", tone: "destructive", line: "Trial ended 9 Oct 2026" });
    expect(subscriptionState(sub({ trialEndsAt: new Date(Date.UTC(2026, 9, 20, 12)) }), true)).toMatchObject({ badge: "Trial", line: "Trial ends 20 Oct 2026" });
  });

  it("active, failed payments (in and after the grace period), canceled and none", () => {
    expect(subscriptionState(sub({ status: "ACTIVE", currentPeriodEnd: new Date(Date.UTC(2026, 10, 1, 12)) }), true)).toEqual({ badge: "Active", tone: "success", line: "Renews 1 Nov 2026" });
    expect(subscriptionState(sub({ status: "PAST_DUE", pastDueSince: new Date(Date.UTC(2026, 9, 8, 12)) }), true)).toMatchObject({ tone: "warning", line: "Payment failed. Update your card by 15 Oct 2026" });
    expect(subscriptionState(sub({ status: "PAST_DUE", pastDueSince: new Date(Date.now() - 30 * DAY) }), false)).toMatchObject({ tone: "destructive" });
    expect(subscriptionState(sub({ status: "CANCELED" }), false).badge).toBe("Canceled");
    expect(subscriptionState(null, false).badge).toBe("Not subscribed");
  });
});

describe("Exit to app", () => {
  const orgs: string[] = [];
  afterAll(() => deleteOrgs(...orgs));

  it("goes to a product the org can open, and nowhere when every trial has ended", async () => {
    const expired = await createOrg({
      products: [
        { product: "CRM", status: "TRIALING", trialEndsAt: new Date(Date.now() - 2 * DAY) },
        { product: "QA_SENTINEL", status: "TRIALING", trialEndsAt: new Date(Date.now() - 2 * DAY) },
      ],
    });
    const crmOnly = await createOrg({
      products: [
        { product: "QA_SENTINEL", status: "TRIALING", trialEndsAt: new Date(Date.now() - 2 * DAY) },
        { product: "CRM", status: "ACTIVE", planId: "growth" },
      ],
    });
    orgs.push(expired.org.id, crmOnly.org.id);
    expect(await firstUsableProductHome(expired.org.id)).toBeNull();
    expect(await firstUsableProductHome(crmOnly.org.id)).toBe("/dashboard");
  });
});
