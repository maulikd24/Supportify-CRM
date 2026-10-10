import Link from "next/link";

import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel, PanelEmpty } from "@/components/dashboard/panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { formatNumber } from "@/lib/utils/format";
import { getCostSettings } from "@/lib/cx/settings";
import { COST_CHANNELS } from "@/lib/cx/settings-shared";
import { HIGH_CHURN_RISK, REPEAT_WITHIN_DAYS, impactFor, periodChange, type ImpactFigures } from "@/lib/cx/impact";
import { utcDayStart } from "@/lib/cx/insights";
import { CHANNEL_LABEL, formatChange, formatMoney, formatShare } from "@/lib/cx/format";

const DAYS = 30;
const DAY_MS = 86_400_000;

export default async function CxAuditPage() {
  const session = await requireProductAccess("CX_INTELLIGENCE");
  const organizationId = session.user.organizationId;
  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const end = new Date(utcDayStart().getTime() + DAY_MS);
  const from = new Date(end.getTime() - DAYS * DAY_MS);
  const previousFrom = new Date(from.getTime() - DAYS * DAY_MS);

  const settings = await getCostSettings(organizationId);
  const [impact, previous, topics] = await Promise.all([
    impactFor(organizationId, settings, from, end),
    impactFor(organizationId, settings, previousFrom, from),
    prisma.topic.findMany({ where: { organizationId }, select: { id: true, name: true, parent: { select: { name: true } } } }),
  ]);
  const names = new Map(topics.map((t) => [t.id, t.parent ? `${t.parent.name} › ${t.name}` : t.name]));
  const money = (v: number | null) => (v == null ? "–" : formatMoney(v, settings.currency));
  const vs = (key: keyof ImpactFigures) => formatChange(periodChange(impact.totals[key], previous.totals[key]));
  const hint = (detail: string, key: keyof ImpactFigures) => {
    const change = vs(key);
    return change ? `${detail} · ${change} vs previous ${DAYS} days` : detail;
  };
  const t = impact.totals;
  const contactCosts = [
    settings.costPerContact.default != null && `${formatMoney(settings.costPerContact.default, settings.currency)} by default`,
    ...COST_CHANNELS.filter((c) => settings.costPerContact[c] != null).map((c) => `${formatMoney(settings.costPerContact[c]!, settings.currency)} per ${CHANNEL_LABEL[c].toLowerCase()} contact`),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-[19px] font-extrabold">$ impact</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          What the reasons customers contact you cost a year, projected from the last {DAYS} days with your own cost inputs. Each
          conversation counts once, under its main topic.
        </p>
      </div>

      {impact.missing.length > 0 && (
        <Panel eyebrow="Inputs needed" title="Some figures need your costs" tone="destructive">
          <ul className="flex flex-col gap-1 border-t border-border px-5 py-3 text-sm">
            {impact.missing.map((m) => (
              <li key={m.input}>
                <span className="font-medium">{m.input}</span> <span className="text-muted-foreground">for {m.unlocks}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            {isAdmin ? (
              <Link href="/cx/settings" className="font-medium text-primary hover:underline">
                Set costs in Settings
              </Link>
            ) : (
              "Ask an admin to set these in CX Settings."
            )}
          </p>
        </Panel>
      )}

      {impact.conversations === 0 ? (
        <Panel eyebrow="$ impact" title="Nothing to price yet">
          <PanelEmpty>Figures appear once conversations from the last {DAYS} days have been imported and analysed.</PanelEmpty>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile label="Cost of contacts" value={money(t.contactCost)} hint={hint(`${formatNumber(impact.conversations)} conversations`, "contactCost")} />
            <StatTile label="Repeat contacts" value={money(t.repeatCost)} hint={hint(`${formatNumber(t.repeats)} came back within ${REPEAT_WITHIN_DAYS} days`, "repeatCost")} />
            <StatTile
              label="Extra handle time"
              value={money(t.extraHandleCost)}
              hint={t.extraHandleHours == null ? "Your helpdesk doesn't report handle time" : hint(`${formatNumber(Math.round(t.extraHandleHours))} hours above average`, "extraHandleCost")}
            />
            <StatTile label="Automation opportunity" value={money(t.automationSavings)} tone="success" hint={hint(`${formatNumber(t.deflectable)} could have been self-served`, "automationSavings")} />
            <StatTile label="Churn exposure" value={money(t.churnExposure)} tone="warning" hint={hint(`${formatNumber(t.highRisk)} customers at high risk`, "churnExposure")} />
          </div>

          <Panel eyebrow="Breakdown" title="By topic" description="Per year. Total is contacts, extra handle time and churn exposure; repeat contacts are part of the contact cost.">
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 font-medium">Topic</th>
                    <th className="px-2 py-2 text-right font-medium">Conversations</th>
                    <th className="px-2 py-2 text-right font-medium">Contacts</th>
                    <th className="px-2 py-2 text-right font-medium">Repeats</th>
                    <th className="px-2 py-2 text-right font-medium">Handle time</th>
                    <th className="px-2 py-2 text-right font-medium">Automation</th>
                    <th className="px-2 py-2 text-right font-medium">Churn</th>
                    <th className="px-5 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.byTopic.map((row) => (
                    <tr key={row.topicId ?? "none"} className="border-t border-border">
                      <td className="max-w-72 truncate px-5 py-2">
                        {row.topicId ? (
                          <Link href={`/cx/topics/${row.topicId}`} className="hover:underline">
                            {names.get(row.topicId) ?? "Removed topic"}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Not sorted into a topic yet</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.topicId ? (
                          <Link href={`/cx/conversations?topic=${row.topicId}`} className="hover:underline">
                            {formatNumber(row.conversations)}
                          </Link>
                        ) : (
                          formatNumber(row.conversations)
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(row.contactCost)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(row.repeatCost)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(row.extraHandleCost)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(row.automationSavings)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(row.churnExposure)}</td>
                      <td className="px-5 py-2 text-right font-medium tabular-nums">{money(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel eyebrow="How it's worked out" title="Assumptions">
            <ul className="flex flex-col gap-2 border-t border-border px-5 py-4 text-sm">
              <li>
                <span className="font-medium">Cost of contacts</span>: conversations × cost per contact on their channel
                {contactCosts.length > 0 && <span className="text-muted-foreground"> ({contactCosts.join(", ")})</span>}.
                {impact.unpricedChannels.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    {impact.unpricedChannels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ")} conversations have no cost set and count as zero.
                  </span>
                )}
              </li>
              <li>
                <span className="font-medium">Repeat contacts</span>: the same customer got in touch again within {REPEAT_WITHIN_DAYS} days; the
                repeat is priced like any other contact.
              </li>
              <li>
                <span className="font-medium">Extra handle time</span>: hours a topic takes above your average handle time ×
                {settings.agentHourlyCost != null ? ` ${formatMoney(settings.agentHourlyCost, settings.currency)} an hour` : " agent hourly cost (not set)"}.
              </li>
              <li>
                <span className="font-medium">Automation opportunity</span>:{" "}
                <Link href="/cx/conversations?flag=deflectable" className="text-primary hover:underline">
                  conversations self-service could have answered
                </Link>{" "}
                × their contact cost × {settings.deflectionRate != null ? `${formatShare(settings.deflectionRate)} deflection rate` : "deflection rate (not set)"}.
              </li>
              <li>
                <span className="font-medium">Churn exposure</span>:{" "}
                <Link href="/cx/conversations?flag=at_risk" className="text-primary hover:underline">
                  customers at high churn risk
                </Link>{" "}
                (risk of {Math.round(HIGH_CHURN_RISK * 100)}% or more) ×{" "}
                {settings.churnPropensity != null ? `${formatShare(settings.churnPropensity)} expected to leave` : "churn propensity (not set)"} ×{" "}
                {settings.customerLifetimeVal != null ? `${formatMoney(settings.customerLifetimeVal, settings.currency)} lifetime value` : "lifetime value (not set)"}.
              </li>
              <li className="text-muted-foreground">Yearly figures are the last {DAYS} days × 365 / {DAYS}.</li>
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
