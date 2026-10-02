import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { prisma } from "@/lib/db/prisma";
import { getStripe } from "@/lib/billing/stripe";
import { limitsForPlan } from "@/lib/billing/plans";
import type { Product, SubscriptionStatus } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit/record";

function isProduct(value: unknown): value is Product {
  return value === "QA_SENTINEL" || value === "CRM";
}

async function upsertSubscriptionFromStripe(subscription: Stripe.Subscription) {
  const organizationId = subscription.metadata.organizationId;
  const product = subscription.metadata.product;
  const planId = subscription.metadata.planId;
  if (!organizationId || !isProduct(product)) {
    console.error("Stripe subscription missing organizationId/product metadata", subscription.id);
    return;
  }

  const status: SubscriptionStatus =
    subscription.status === "active"
      ? "ACTIVE"
      : subscription.status === "past_due"
        ? "PAST_DUE"
        : subscription.status === "trialing"
          ? "TRIALING"
          : "CANCELED";

  // The plan's licensed item; QA subscriptions may also carry a metered overage item.
  const item =
    subscription.items.data.find((i) => i.price.recurring?.usage_type !== "metered") ?? subscription.items.data[0];
  const currentPeriodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;

  const existing = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product } },
    select: { currentPeriodEnd: true, pastDueSince: true },
  });

  // Usage resets only when Stripe starts a new billing period (or a trial converts),
  // not on every subscription.updated event (seat changes, card updates, …).
  const newPeriod =
    currentPeriodEnd != null && (existing?.currentPeriodEnd == null || currentPeriodEnd > existing.currentPeriodEnd);

  const interval = item?.price.recurring?.interval;

  const data = {
    status,
    billingInterval: interval === "year" || interval === "month" ? interval : undefined,
    planId: planId ?? undefined,
    stripeSubscriptionId: subscription.id,
    stripePriceId: item?.price.id,
    currentPeriodEnd,
    // Self-serve plans carry their limits; contact-sales plans keep what staff set in /admin.
    ...limitsForPlan(product, planId),
    pastDueSince: status === "PAST_DUE" ? (existing?.pastDueSince ?? new Date()) : null,
    // A converted trial is no longer bound by its trial end date.
    ...(status === "ACTIVE" ? { trialEndsAt: null } : {}),
  };

  const previous = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product } },
    select: { status: true, planId: true, billingInterval: true },
  });

  await prisma.productSubscription.upsert({
    where: { organizationId_product: { organizationId, product } },
    update: {
      ...data,
      ...(newPeriod ? { reviewsUsedThisPeriod: 0, overageReviewsThisPeriod: 0, usagePeriodStart: new Date() } : {}),
    },
    create: { organizationId, product, ...data, planId, usagePeriodStart: new Date() },
  });

  const current = { status, planId: planId ?? previous?.planId ?? null, billingInterval: data.billingInterval ?? previous?.billingInterval ?? null };
  if (!previous || previous.status !== current.status || previous.planId !== current.planId || previous.billingInterval !== current.billingInterval) {
    await recordAudit({
      organizationId,
      entity: "ProductSubscription",
      entityId: product,
      action: "billing.subscription_updated",
      oldValue: previous ?? null,
      newValue: current,
    });
  }
}

async function markCanceled(subscription: Stripe.Subscription) {
  const organizationId = subscription.metadata.organizationId;
  const product = subscription.metadata.product;
  if (!organizationId || !isProduct(product)) return;

  await prisma.productSubscription.updateMany({
    where: { organizationId, product },
    data: { status: "CANCELED" },
  });
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const subscription = await getStripe().subscriptions.retrieve(session.subscription as string);
        await upsertSubscriptionFromStripe(subscription);
      }
      break;
    }
    case "customer.subscription.updated": {
      await upsertSubscriptionFromStripe(event.data.object as Stripe.Subscription);
      break;
    }
    case "customer.subscription.deleted": {
      await markCanceled(event.data.object as Stripe.Subscription);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoice.parent?.subscription_details?.subscription;
      if (subscriptionId) {
        const subscription = await getStripe().subscriptions.retrieve(subscriptionId as string);
        const organizationId = subscription.metadata.organizationId;
        const product = subscription.metadata.product;
        if (organizationId && isProduct(product)) {
          // Start the grace period on the first failure only.
          await prisma.productSubscription.updateMany({
            where: { organizationId, product, pastDueSince: null },
            data: { status: "PAST_DUE", pastDueSince: new Date() },
          });
          await prisma.productSubscription.updateMany({
            where: { organizationId, product, pastDueSince: { not: null } },
            data: { status: "PAST_DUE" },
          });
          await recordAudit({ organizationId, entity: "ProductSubscription", entityId: product, action: "billing.payment_failed" });
        }
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
