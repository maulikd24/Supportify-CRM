import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function QaOverviewPage() {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const [organization, subscription, reviewCount, avgScore, dsatCount, hasZendesk, sopCount] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
    prisma.productSubscription.findUnique({ where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } } }),
    prisma.ticketReview.count({ where: { organizationId } }),
    prisma.ticketReview.aggregate({ where: { organizationId }, _avg: { overallScore: true } }),
    prisma.dsatAnalysis.count({ where: { organizationId } }),
    prisma.zendeskConnection.findUnique({ where: { organizationId } }).then((c) => c?.isValid ?? false),
    prisma.sopDocument.count({ where: { organizationId } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Welcome back, {organization.name}</h1>
        <p className="text-sm text-muted-foreground">
          {subscription?.status === "TRIALING" && subscription.trialEndsAt
            ? `Trial active until ${subscription.trialEndsAt.toLocaleDateString()}`
            : `Subscription: ${(subscription?.status ?? "none").toLowerCase()}`}
          {subscription?.reviewQuota != null && (
            <> · {subscription.reviewsUsedThisPeriod}/{subscription.reviewQuota} reviews used this period</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Reviews run" value={reviewCount} />
        <StatCard label="Avg. score" value={avgScore._avg.overallScore ? Math.round(avgScore._avg.overallScore) : "—"} />
        <StatCard label="DSAT cases" value={dsatCount} />
        <StatCard label="SOPs" value={sopCount} />
      </div>

      {!hasZendesk && (
        <Card>
          <CardHeader>
            <CardTitle>Connect Zendesk to get started</CardTitle>
            <CardDescription>
              Reviews need a Zendesk connection to pull ticket conversations.{" "}
              <Link href="/qa/settings" className="underline">
                Go to Settings
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
