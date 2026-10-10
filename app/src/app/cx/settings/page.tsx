import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel } from "@/components/dashboard/panel";
import { getCostSettings } from "@/lib/cx/settings";
import { CostSettingsForm } from "./cost-settings-form";
import { TeamsPanel } from "./teams-panel";

export default async function CxSettingsPage() {
  const session = await requireProductAccess("CX_INTELLIGENCE");
  const organizationId = session.user.organizationId;
  const canEdit = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";

  const [settings, teams] = await Promise.all([
    getCostSettings(organizationId),
    prisma.team.findMany({
      where: { organizationId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      include: {
        benchmarkTeam: { select: { name: true } },
        agentMappings: { orderBy: { createdAt: "asc" }, select: { id: true, matchType: true, value: true } },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        eyebrow="CX Intelligence"
        title="Costs and retention"
        description="Used to put a price on each problem: what it costs to handle, and what it risks in lost customers."
      >
        <CostSettingsForm settings={settings} canEdit={canEdit} />
      </Panel>

      <Panel
        eyebrow="CX Intelligence"
        title="Teams"
        description="Group agents into in-house teams and BPO partners to compare them, and name the teams that fix each kind of issue."
      >
        <TeamsPanel
          canEdit={canEdit}
          teams={teams.map((t) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            benchmarkTeamName: t.benchmarkTeam?.name ?? null,
            mappings: t.agentMappings,
          }))}
        />
      </Panel>

      <Panel eyebrow="Privacy" title="What's redacted">
        <p className="border-t border-border p-5 text-sm text-muted-foreground">
          Before a conversation is stored or analysed, emails, phone numbers, payment cards, bank account numbers (IBAN),
          government ids (Aadhaar, PAN, SSN-style), IP addresses and secrets in links are replaced with placeholders such
          as [EMAIL_1]. Only the redacted text is kept. Customer names and street addresses are not redacted yet.
        </p>
      </Panel>
    </div>
  );
}
