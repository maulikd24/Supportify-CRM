import Link from "next/link";
import { Plus } from "lucide-react";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelList } from "@/components/dashboard/panel";
import { DEFAULT_SCORECARD, customScorecardsAvailable, parseCriteria, type ScorecardCriterion } from "@/lib/qa/scorecard";
import { ScorecardEditorDialog, ScorecardRowActions } from "./scorecard-editor";

function CriteriaSummary({ criteria }: { criteria: ScorecardCriterion[] }) {
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {criteria.map((c) => (
        <li key={c.key}>
          <Badge variant={c.autoFailBelow != null ? "destructive" : "outline"} title={c.description || undefined}>
            {c.label} · {Math.round((c.weight / total) * 100)}%{c.autoFailBelow != null ? ` · fail <${c.autoFailBelow}` : ""}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export default async function ScorecardsPage() {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  const canEdit = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";

  const [available, rows] = await Promise.all([
    customScorecardsAvailable(organizationId),
    prisma.scorecard.findMany({ where: { organizationId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  const scorecards = rows.map((s) => ({ ...s, criteria: parseCriteria(s.criteria) ?? DEFAULT_SCORECARD.criteria }));
  const hasDefault = available && scorecards.some((s) => s.isDefault);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        eyebrow="Quality"
        title="Scorecards"
        description="Choose what a good ticket looks like: your own criteria, weights and critical (auto-fail) items. Changes apply to new reviews; past reviews keep the scorecard they were scored with."
        action={
          available && canEdit ? (
            <ScorecardEditorDialog
              starter={DEFAULT_SCORECARD.criteria}
              trigger={
                <Button size="sm">
                  <Plus /> New scorecard
                </Button>
              }
            />
          ) : undefined
        }
      >
        {!available && (
          <div className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-4">
            <p className="max-w-prose text-[13px]">
              Custom scorecards are included on <strong>Growth</strong> and above. Your reviews use the Standard scorecard below.
              {scorecards.length > 0 && " Your saved scorecards are kept and switch back on when you upgrade."}
            </p>
            {canEdit && (
              <Button size="sm" render={<Link href="/billing/QA_SENTINEL" />}>
                Upgrade
              </Button>
            )}
          </div>
        )}
        <PanelList>
          {scorecards.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-semibold">
                  {s.name}
                  {available && s.isDefault && <Badge variant="secondary">Default</Badge>}
                </p>
                <CriteriaSummary criteria={s.criteria} />
              </div>
              {canEdit && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  {available && (
                    <>
                      <ScorecardEditorDialog
                        scorecard={{ id: s.id, name: s.name, criteria: s.criteria }}
                        starter={DEFAULT_SCORECARD.criteria}
                        trigger={<Button size="sm" variant="outline">Edit</Button>}
                      />
                      <ScorecardRowActions id={s.id} name={s.name} isDefault={s.isDefault} />
                    </>
                  )}
                  {!available && <ScorecardRowActions id={s.id} name={s.name} isDefault />}
                </div>
              )}
            </li>
          ))}
          <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13px] font-semibold">
                {DEFAULT_SCORECARD.name}
                <Badge variant="outline">Built-in</Badge>
                {!hasDefault && <Badge variant="secondary">Default</Badge>}
              </p>
              <CriteriaSummary criteria={DEFAULT_SCORECARD.criteria} />
            </div>
          </li>
        </PanelList>
      </Panel>
    </div>
  );
}
