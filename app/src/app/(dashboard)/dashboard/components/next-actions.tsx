"use client";

import Link from "next/link";
import { useState } from "react";

import { Panel, PanelEmpty, PanelList, PanelRow } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";

export type NextAction = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  dueLabel: string;
  dueToday: boolean;
  highPriority: boolean;
};

const FILTERS = [
  { key: "all", label: "All", match: () => true },
  { key: "today", label: "Today", match: (a: NextAction) => a.dueToday },
  { key: "urgent", label: "Urgent", match: (a: NextAction) => a.highPriority },
] as const;

const VISIBLE = 5;

export function NextActions({ actions, total }: { actions: NextAction[]; total: number }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const matching = actions.filter(FILTERS.find((f) => f.key === filter)!.match);
  const visible = matching.slice(0, VISIBLE);

  return (
    <Panel
      eyebrow="Prioritised for you"
      title="Next best actions"
      action={
        <div role="group" aria-label="Filter actions" className="flex rounded-md border border-border bg-muted/70 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                filter === f.key && "bg-card text-foreground shadow-[var(--shadow-xs)]",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
      footer={`Showing ${visible.length} of ${filter === "all" ? total : matching.length} · sorted by due time`}
    >
      {visible.length === 0 ? (
        <PanelEmpty>Nothing here — you&apos;re all caught up.</PanelEmpty>
      ) : (
        <PanelList>
          {visible.map((a) => (
            <PanelRow
              key={a.id}
              tone={a.highPriority ? "primary" : "muted"}
              title={a.title}
              meta={`${a.clientName} · ${a.dueLabel}`}
              trailing={
                <Link href={`/clients/${a.clientId}`} className="font-semibold text-primary hover:underline">
                  Start
                </Link>
              }
            />
          ))}
        </PanelList>
      )}
    </Panel>
  );
}
