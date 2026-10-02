import { afterEach, describe, expect, it } from "vitest";

import { annualBillingAvailable, limitsForPlan, planById, stripePriceIdFor, trialLimitsFor } from "@/lib/billing/plans";

describe("plan catalogue", () => {
  afterEach(() => {
    delete process.env.STRIPE_PRICE_QA_STARTER;
    delete process.env.STRIPE_PRICE_QA_STARTER_ANNUAL;
  });

  it("writes each self-serve plan's limits", () => {
    expect(limitsForPlan("QA_SENTINEL", "starter")).toEqual({ reviewQuota: 100 });
    expect(limitsForPlan("QA_SENTINEL", "growth")).toEqual({ reviewQuota: 500 });
    expect(limitsForPlan("QA_SENTINEL", "scale")).toEqual({ reviewQuota: 2000 });
    expect(limitsForPlan("CRM", "starter")).toEqual({ seats: 5 });
    expect(limitsForPlan("CRM", "growth")).toEqual({ seats: 20 });
    expect(limitsForPlan("CRM", "scale")).toEqual({ seats: 50 });
  });

  it("leaves contact-sales and unknown plans to admin-set limits", () => {
    expect(limitsForPlan("QA_SENTINEL", "enterprise")).toEqual({});
    expect(limitsForPlan("CRM", "nope")).toEqual({});
    expect(limitsForPlan("CRM", null)).toEqual({});
  });

  it("caps trials at 50 reviews / 3 seats", () => {
    expect(trialLimitsFor("QA_SENTINEL")).toEqual({ reviewQuota: 50 });
    expect(trialLimitsFor("CRM")).toEqual({ seats: 3 });
  });

  it("annual prices are 10x monthly", () => {
    expect(planById("QA_SENTINEL", "scale")?.annualPriceLabel).toBe("$3,990/yr");
    expect(planById("CRM", "growth")?.annualPriceLabel).toBe("$490/seat/yr");
  });

  it("resolves Stripe prices per interval and only offers annual when every plan has one", () => {
    process.env.STRIPE_PRICE_QA_STARTER = "price_m";
    process.env.STRIPE_PRICE_QA_STARTER_ANNUAL = "price_y";
    const starter = planById("QA_SENTINEL", "starter")!;
    expect(stripePriceIdFor(starter, "month")).toBe("price_m");
    expect(stripePriceIdFor(starter, "year")).toBe("price_y");
    expect(annualBillingAvailable("QA_SENTINEL")).toBe(false); // growth/scale annual not set
  });
});
