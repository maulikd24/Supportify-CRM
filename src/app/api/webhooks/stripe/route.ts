import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { prisma } from "@/lib/db/prisma";
import { getStripe } from "@/lib/billing/stripe";
import type { Product } from "@/generated/prisma/client";

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

  const status =
    subscription.status === "active"
      ? "ACTIVE"
      : subscription.status === "past_due"
        ? "PAST_DUE"
        : subscription.status === "trialing"
          ? "TRIALING"
          : "CANCELED";

  const item = subscription.items.data[0];
  const currentPeriodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;

  await prisma.productSubscription.upsert({
    where: { organizationId_product: { organizationId, product } },
    update: {
      status,
      planId: planId ?? undefined,
      stripeSubscriptionId: subscription.id,
      stripePriceId: item?.price.id,
      currentPeriodEnd,
      // A renewal (new billing period) resets usage; approximate by resetting whenever this webhook fires with an ACTIVE status.
      reviewsUsedThisPeriod: status === "ACTIVE" ? 0 : undefined,
    },
    create: {
      organizationId,
      product,
      status,
      planId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: item?.price.id,
      currentPeriodEnd,
    },
  });
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
          await prisma.productSubscription.updateMany({
            where: { organizationId, product },
            data: { status: "PAST_DUE" },
          });
        }
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
