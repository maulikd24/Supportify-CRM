import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";

import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel } from "@/components/dashboard/panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { formatNumber } from "@/lib/utils/format";

export default async function CxOverviewPage() {
  const session = await requireProductAccess("CX_INTELLIGENCE");
  const organizationId = session.user.organizationId;

  const [sub, costSettings, teamCount, conversationCount] = await Promise.all([
    prisma.productSubscription.findUnique({
      where: { organizationId_product: { organizationId, product: "CX_INTELLIGENCE" } },
      select: { analysesUsedThisPeriod: true, analysisQuota: true },
    }),
    prisma.cxCostSettings.findUnique({ where: { organizationId }, select: { costPerContact: true } }),
    prisma.team.count({ where: { organizationId } }),
    prisma.conversation.count({ where: { organizationId } }),
  ]);
  const costsSet = Object.values((costSettings?.costPerContact ?? {}) as Record<string, number | null>).some((v) => v != null);

  const steps = [
    { done: costsSet, label: "Set what a support contact costs", hint: "So every problem can be priced.", href: "/cx/settings" },
    { done: teamCount > 0, label: "Add your teams and BPO partners", hint: "To compare them and route issues to the team that fixes them.", href: "/cx/settings" },
    { done: conversationCount > 0, label: "Connect your sources", hint: "Helpdesk tickets, surveys, reviews and calls. Coming in the next release.", href: null },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-[19px] font-extrabold">CX Intelligence</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every customer conversation, read and sorted into what customers contact you about, why, and what it costs, with
          early warnings when something starts breaking.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Conversations stored" value={formatNumber(conversationCount)} />
        <StatTile
          label="Analysed this period"
          value={formatNumber(sub?.analysesUsedThisPeriod ?? 0)}
          hint={sub?.analysisQuota != null ? `of ${formatNumber(sub.analysisQuota)} included` : "Unlimited"}
        />
        <StatTile label="Teams" value={formatNumber(teamCount)} />
      </div>

      <Panel eyebrow="Get started" title="Set up CX Intelligence">
        <ol className="flex flex-col divide-y divide-border border-t border-border">
          {steps.map((step) => (
            <li key={step.label} className="flex items-start gap-3 px-5 py-3">
              {step.done ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Done" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="To do" />
              )}
              <div className="min-w-0">
                {step.href ? (
                  <Link href={step.href} className="text-sm font-medium hover:underline">
                    {step.label}
                  </Link>
                ) : (
                  <p className="text-sm font-medium">{step.label}</p>
                )}
                <p className="text-xs text-muted-foreground">{step.hint}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
