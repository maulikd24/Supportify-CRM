"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { getStripe } from "@/lib/billing/stripe";

/** Opens the Stripe Customer Portal, which manages every product subscription under the org's one Stripe Customer. */
export async function manageBillingAction() {
  const session = await requireOrg(["OWNER", "ADMIN"]);

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId } });
  if (!org.stripeCustomerId) {
    throw new Error("No billing account yet — subscribe to a plan first.");
  }

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const portalSession = await getStripe().billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${appUrl}/billing`,
  });

  redirect(portalSession.url);
}
