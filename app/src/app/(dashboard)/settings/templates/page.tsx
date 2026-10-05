import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewTemplateDialog } from "./new-template-dialog";
import { TemplateRowActions } from "./template-row-actions";
import { Panel } from "@/components/dashboard/panel";
import { TableEmpty } from "@/components/page/table-empty";
import { aiDraftQuota } from "@/lib/billing/plans";
import { draftingConfigured } from "@/lib/drafting/claude";
import { formatNumber } from "@/lib/utils/format";
import { AiDraftingPanel } from "./ai-drafting-panel";

export default async function TemplatesSettingsPage() {
  const session = await requireRole(["ADMIN"]);

  const organizationId = session.user.organizationId;
  const [templates, org, sub] = await Promise.all([
    prisma.messageTemplate.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { aiDraftingEnabled: true, aiDraftTone: true, aiDraftAvoid: true },
    }),
    prisma.productSubscription.findUnique({
      where: { organizationId_product: { organizationId, product: "CRM" } },
      select: { status: true, planId: true, seats: true, aiDraftsUsedThisPeriod: true, usagePeriodStart: true, createdAt: true },
    }),
  ]);
  const quota = sub ? aiDraftQuota(sub) : null;
  const periodCost = sub
    ? ((
        await prisma.aiDraft.aggregate({
          where: { organizationId, createdAt: { gte: sub.usagePeriodStart ?? sub.createdAt } },
          _sum: { costUsd: true },
        })
      )._sum.costUsd ?? 0)
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <Panel eyebrow="Messaging" title="Message Templates" action={<><NewTemplateDialog /></>}>
        <div className="overflow-x-auto border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Body</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell className="text-sm capitalize">{template.channel}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{template.body}</TableCell>
                  <TableCell>
                    <Badge variant={template.approved ? "default" : "outline"}>
                      {template.approved ? "Approved" : "Draft"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <TemplateRowActions templateId={template.id} approved={template.approved} />
                  </TableCell>
                </TableRow>
              ))}
              {templates.length === 0 && (
                <TableEmpty colSpan={5}>No templates yet. WhatsApp requires pre-approved templates registered with your provider
                    — mark them approved here once registered.</TableEmpty>
              )}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel
        eyebrow="Inbox"
        title="AI drafting"
        description={
          sub
            ? `${formatNumber(sub.aiDraftsUsedThisPeriod)} of ${quota == null ? "unlimited" : formatNumber(quota)} drafts used this period · about $${periodCost.toFixed(2)} in AI cost`
            : undefined
        }
      >
        <AiDraftingPanel
          configured={draftingConfigured()}
          settings={{ enabled: org.aiDraftingEnabled, tone: org.aiDraftTone ?? "", avoid: org.aiDraftAvoid ?? "" }}
        />
      </Panel>
    </div>
  );
}
