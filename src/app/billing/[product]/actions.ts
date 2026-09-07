"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { getStripe } from "@/lib/billing/stripe";
import { planById, stripePriceIdFor, PRODUCT_LABELS } from "@/lib/billing/plans";
import type { Product } from "@/generated/prisma/client";

function parseProduct(value: string): Product {
  if (value === "QA_SENTINEL" || value === "CRM") return value;
  throw new Error(`Unknown product: ${value}`);
}

export async function startCheckoutAction(productParam: string, planId: string) {
  const session = await requireOrg(["OWNER", "ADMIN"]);
  const product = parseProduct(productParam);

  const plan = planById(product, planId);
  if (!plan) throw new Error("Unknown plan");
  if (plan.contactSales) throw new Error("This plan requires talking to sales — no self-serve checkout.");

  // Check user-actionable gates before system-configuration gates: verifying
  // email is something the customer can fix themselves right now.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { emailVerifiedAt: true } });
  if (!user.emailVerifiedAt) {
    throw new Error("Verify your email address before subscribing — check your inbox, or resend from your account page.");
  }

  const priceId = stripePriceIdFor(plan);
  if (!priceId) {
    throw new Error(
      `${PRODUCT_LABELS[product]} ${plan.name} isn't configured yet — set ${plan.stripePriceEnvVar} in the environment.`,
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
  const checkoutSession = await getStripe().checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/billing/${product}?checkout=success`,
    cancel_url: `${appUrl}/billing/${product}?checkout=canceled`,
    subscription_data: {
      metadata: { organizationId: org.id, product, planId },
    },
    metadata: { organizationId: org.id, product, planId },
  });

  if (!checkoutSession.url) throw new Error("Stripe did not return a checkout URL");
  redirect(checkoutSession.url);
}
