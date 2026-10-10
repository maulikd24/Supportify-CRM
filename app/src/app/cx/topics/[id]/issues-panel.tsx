"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Panel, PanelEmpty } from "@/components/dashboard/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callAction } from "@/lib/actions/call-action";
import { createIssueAction, setIssueStatusAction } from "../actions";

type Status = "OPEN" | "IN_PROGRESS" | "RESOLVED";
type Issue = { id: string; title: string; note: string | null; status: Status; teamName: string | null; createdLabel: string; resolvedLabel: string | null };

const STATUS_LABEL: Record<Status, string> = { OPEN: "Open", IN_PROGRESS: "In progress", RESOLVED: "Resolved" };
const NEXT: Record<Status, { status: Status; label: string } | null> = {
  OPEN: { status: "IN_PROGRESS", label: "Start" },
  IN_PROGRESS: { status: "RESOLVED", label: "Resolve" },
  RESOLVED: { status: "OPEN", label: "Reopen" },
};

export function IssuesPanel({
  topicId,
  issues,
  teams,
  defaultTeamId,
  canEdit,
}: {
  topicId: string;
  issues: Issue[];
  teams: { id: string; name: string }[];
  defaultTeamId: string | null;
  canEdit: boolean;
}) {
  const [title, setTitle] = useState("");
  const [ownerTeamId, setOwnerTeamId] = useState(defaultTeamId ?? "");
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await fn();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (await run(() => callAction(createIssueAction)({ topicId, title, ownerTeamId: ownerTeamId || null }), "Issue added")) setTitle("");
  }

  return (
    <Panel eyebrow="Fixes" title="Issues" description="The problems behind this topic, tracked until they're fixed.">
      {issues.length === 0 ? (
        <PanelEmpty>No issues tracked yet.</PanelEmpty>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {issues.map((issue) => {
            const next = NEXT[issue.status];
            return (
              <li key={issue.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className={issue.status === "RESOLVED" ? "text-muted-foreground line-through" : "font-medium"}>{issue.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {issue.teamName ?? "No team"} · added {issue.createdLabel}
                    {issue.resolvedLabel && ` · resolved ${issue.resolvedLabel}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={issue.status === "RESOLVED" ? "success" : issue.status === "IN_PROGRESS" ? "secondary" : "outline"}>{STATUS_LABEL[issue.status]}</Badge>
                  {canEdit && next && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => callAction(setIssueStatusAction)({ issueId: issue.id, status: next.status }), STATUS_LABEL[next.status])}
                    >
                      {next.label}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={add} className="flex flex-wrap gap-2 border-t border-border p-4">
          <Input aria-label="Issue" className="min-w-48 flex-1" placeholder="e.g. Courier misses evening slots" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
          {teams.length > 0 && (
            <select aria-label="Team that fixes it" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={ownerTeamId} onChange={(e) => setOwnerTeamId(e.target.value)}>
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <Button type="submit" size="sm" disabled={pending || !title.trim()}>
            Add issue
          </Button>
        </form>
      )}
    </Panel>
  );
}
