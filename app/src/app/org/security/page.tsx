import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel, PanelLink } from "@/components/dashboard/panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { SESSION_LIMIT_OPTIONS, enterpriseControlsAvailable, sessionLimitLabel } from "@/lib/security/policy";
import { SecurityForm, SignOutAllButton } from "./security-form";

export default async function SecurityPage() {
  const session = await requireOrg(["OWNER", "ADMIN"]);
  const organizationId = session.user.organizationId;

  const [org, eligible, members, with2fa] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { require2fa: true, requireSso: true, sessionMaxHours: true, workosOrganizationId: true, ssoDomain: true },
    }),
    enterpriseControlsAvailable(organizationId),
    prisma.user.count({ where: { organizationId, isActive: true } }),
    prisma.user.count({ where: { organizationId, isActive: true, twoFactorEnabled: true } }),
  ]);
  const ssoConfigured = Boolean(org.workosOrganizationId);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {!eligible && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/8 px-5 py-4">
          <div className="text-[13px]">
            <p className="font-semibold">Security policies and audit-log export are available on Scale and Enterprise.</p>
            <p className="text-muted-foreground">Your audit log and personal 2FA keep working on every plan.</p>
          </div>
          <Link href="/billing" className="text-[11px] font-bold text-primary hover:underline">
            See plans ›
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Members with 2FA" value={`${with2fa}/${members}`} tone={with2fa === members ? "success" : "warning"} />
        <StatTile label="Single sign-on" value={ssoConfigured ? "On" : "Off"} hint={org.ssoDomain ?? "Not set up"} />
        <StatTile label="Session length" value={org.sessionMaxHours ? sessionLimitLabel(org.sessionMaxHours) : "30 days"} />
      </div>

      <Panel
        eyebrow="Policies"
        title="Sign-in requirements"
        action={<PanelLink href="/org/sso">Single sign-on</PanelLink>}
        bodyClassName="px-5 pb-5"
      >
        <SecurityForm
          initial={{ require2fa: org.require2fa, requireSso: org.requireSso, sessionMaxHours: org.sessionMaxHours }}
          sessionOptions={SESSION_LIMIT_OPTIONS.map((hours) => ({ hours, label: sessionLimitLabel(hours) }))}
          ssoConfigured={ssoConfigured}
          eligible={eligible}
        />
      </Panel>

      <Panel
        tone="destructive"
        eyebrow="Sessions"
        title="Sign out all devices"
        description="Ends every active session in your organization immediately."
        action={<SignOutAllButton />}
      />

      <p className="text-[11px] text-muted-foreground">
        Every change here is recorded in the <Link href="/org/audit-log" className="font-bold text-primary hover:underline">audit log</Link>.
      </p>
    </div>
  );
}
