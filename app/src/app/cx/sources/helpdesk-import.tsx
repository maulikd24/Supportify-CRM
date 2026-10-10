"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callAction } from "@/lib/actions/call-action";
import { BACKFILL_DAYS } from "@/lib/cx/settings-shared";
import { pauseSourceAction, removeSourceAction, startHelpdeskImportAction } from "./actions";

type Source = {
  id: string;
  label: string;
  status: string;
  lastError: string | null;
  lastSyncedLabel: string | null;
  backfillFromLabel: string | null;
  conversations: number;
  queued: number;
  failed: number;
};

const DAYS_LABEL: Record<number, string> = { 30: "Last 30 days", 90: "Last 90 days", 180: "Last 6 months", 365: "Last 12 months" };

export function HelpdeskImport({
  helpdeskName,
  source,
  canEdit,
  trial,
}: {
  helpdeskName: string;
  source: Source | null;
  canEdit: boolean;
  trial: boolean;
}) {
  const router = useRouter();
  const [days, setDays] = useState<number>(trial ? 30 : 90);
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await fn();
      toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  if (!source || source.status === "paused") {
    return (
      <div className="flex flex-col gap-3 border-t border-border p-5 text-sm">
        {source?.status === "paused" && (
          <p className="text-muted-foreground">
            Importing is paused{source.lastError ? `: ${source.lastError}` : ""}. {source.conversations.toLocaleString("en-IN")} conversations
            imported so far are kept.
          </p>
        )}
        <p>
          Import every solved {helpdeskName} ticket{source ? "" : ", starting with your history"}, then keep importing new ones as they are
          solved. Personal details are removed before anything is stored.
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {!source && (
              <Select value={String(days)} onValueChange={(v) => v && setDays(Number(v))}>
                <SelectTrigger className="w-44" aria-label="How far back to import">
                  <SelectValue>{(v: string) => DAYS_LABEL[Number(v)]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {BACKFILL_DAYS.filter((d) => !trial || d <= 30).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {DAYS_LABEL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button disabled={pending} onClick={() => run(() => callAction(startHelpdeskImportAction)(days), source ? "Importing again" : "Import started")}>
              {source ? "Resume importing" : "Start importing"}
            </Button>
            {trial && !source && <span className="text-xs text-muted-foreground">Trials import the last 30 days.</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border p-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{source.label}</span>
        <Badge variant={source.status === "error" ? "destructive" : "success"}>{source.status === "error" ? "Needs attention" : "Importing"}</Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Conversations imported</dt><dd>{source.conversations.toLocaleString("en-IN")}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Waiting to import</dt><dd>{source.queued.toLocaleString("en-IN")}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">History from</dt><dd>{source.backfillFromLabel ?? "–"}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Last checked</dt><dd>{source.lastSyncedLabel ?? "Not yet"}</dd></div>
        {source.failed > 0 && (
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Couldn&apos;t import</dt><dd>{source.failed.toLocaleString("en-IN")}</dd></div>
        )}
      </dl>
      {source.lastError && <p className="text-xs text-destructive">{source.lastError}</p>}
      {canEdit && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => callAction(pauseSourceAction)(source.id), "Importing paused")}>
            Pause
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              confirm("Stop importing from this helpdesk? Conversations already imported are kept.") &&
              run(() => callAction(removeSourceAction)(source.id), "Source removed")
            }
          >
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
