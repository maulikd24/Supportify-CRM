"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { getStripe } from "@/lib/billing/stripe";
import { planById, stripePriceIdFor, PRODUCT_LABELS, TRIAL_DAYS, trialLimitsFor, qaOverageConfig, type BillingInterval } from "@/lib/billing/plans";
import { DEFAULT_STAGE_DEFINITIONS } from "@/lib/stage-engine/stages";
import { countBillableSeats } from "@/lib/billing/seats";
import type { Product } from "@/generated/prisma/client";
import { UserError, withUserErrors } from "@/lib/actions/user-error";

function parseProduct(value: string): Product {
  if (value === "QA_SENTINEL" || value === "CRM") return value;
  throw new UserError(`Unknown product: ${value}`);
}

/**
 * Starts the same free trial signup gives, for a product the org picked not to
 * trial at signup. Only once per product: any existing subscription row (even a
 * lapsed trial) means the trial has already been used.
 */
export const startTrialAction = withUserErrors(async function startTrialAction(productParam: string) {
  const session = await requireOrg(["OWNER", "ADMIN"]);
  const product = parseProduct(productParam);
  const organizationId = session.user.organizationId;

  const existing = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product } },
  });
  if (existing) throw new UserError(`Your organization has already used its ${PRODUCT_LABELS[product]} trial.`);

  await prisma.productSubscription.create({
    data: {
      organizationId,
      product,
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      ...trialLimitsFor(product),
    },
  });

  // CRM needs a pipeline to be usable — seed the default stages if the org has none.
  if (product === "CRM" && (await prisma.stage.count({ where: { organizationId } })) === 0) {
    await prisma.stage.createMany({
      data: DEFAULT_STAGE_DEFINITIONS.map((stage) => ({ ...stage, organizationId })),
    });
  }

  redirect(product === "CRM" ? "/dashboard" : "/qa");
});

export const startCheckoutAction = withUserErrors(async function startCheckoutAction(
  productParam: string,
  planId: string,
  interval: BillingInterval = "month",
) {
  const session = await requireOrg(["OWNER", "ADMIN"]);
  const product = parseProduct(productParam);

  const plan = planById(product, planId);
  if (!plan) throw new UserError("Unknown plan");
  if (plan.contactSales) throw new UserError("This plan requires talking to sales — no self-serve checkout.");

  // Check user-actionable gates before system-configuration gates: verifying
  // email is something the customer can fix themselves right now.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { emailVerifiedAt: true } });
  if (!user.emailVerifiedAt) {
    throw new UserError("Verify your email address before subscribing — check your inbox, or resend from your account page.");
  }

  if (interval !== "month" && interval !== "year") throw new UserError("Unknown billing interval");
  const priceId = stripePriceIdFor(plan, interval);
  if (!priceId) {
    console.error("Checkout blocked: missing Stripe price", {
      product,
      planId,
      interval,
      envVar: interval === "year" ? plan.stripeAnnualPriceEnvVar : plan.stripePriceEnvVar,
    });
    throw new UserError(
      `${PRODUCT_LABELS[product]} ${plan.name}${interval === "year" ? " (annual)" : ""} isn't available for online checkout yet. Contact us at sales@supportify.co.in to subscribe.`,
    );
  }

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId } });

  let stripeCustomerId = org.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await getStripe().customers.create({
      name: org.name,
      email: session.user.email,
      metadata: { organizationId: org.id },
    });
    stripeCustomerId = customer.id;
    await prisma.organization.update({ where: { id: org.id }, data: { stripeCustomerId } });
  }

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const overage = qaOverageConfig();
  const checkoutSession = await getStripe().checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    // CRM is priced per seat: bill every active user. QA Sentinel is a flat plan.
    line_items: [
      { price: priceId, quantity: product === "CRM" ? Math.max(1, await countBillableSeats(org.id)) : 1 },
      // QA: attach the metered overage price up front (billed only if the org opts into overages).
      // Monthly plans only: Stripe can't mix a yearly price with a monthly metered one.
      ...(product === "QA_SENTINEL" && overage && interval === "month" ? [{ price: overage.priceId }] : []),
    ],
    success_url: `${appUrl}/billing/${product}?checkout=success`,
    cancel_url: `${appUrl}/billing/${product}?checkout=canceled`,
    subscription_data: {
      metadata: { organizationId: org.id, product, planId, interval },
    },
    metadata: { organizationId: org.id, product, planId, interval },
  });

  if (!checkoutSession.url) throw new UserError("Stripe did not return a checkout URL");
  redirect(checkoutSession.url);
});
