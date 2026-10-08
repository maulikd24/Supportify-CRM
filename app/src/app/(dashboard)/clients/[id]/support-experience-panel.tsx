"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelEmpty } from "@/components/dashboard/panel";
import { callAction } from "@/lib/actions/call-action";
import { scoreVariant } from "@/lib/qa/score";
import { formatDate } from "@/lib/utils/format";
import type { SupportHealth } from "@/lib/support-health/health";
import { linkTicketToClientAction, unlinkRequesterAction } from "./support-actions";

const STATUS: Record<SupportHealth["status"], { label: string; variant: "success" | "destructive" | "secondary" }> = {
  healthy: { label: "Healthy", variant: "success" },
  at_risk: { label: "At risk", variant: "destructive" },
  no_data: { label: "No reviewed tickets", variant: "secondary" },
};

/** QA Sentinel's view of this client: recent reviewed tickets, DSAT findings and who they're matched by. */
export function SupportExperiencePanel({ clientId, health, isAdmin }: { clientId: string; health: SupportHealth; isAdmin: boolean }) {
  const [ticketId, setTicketId] = useState("");
  const [pending, setPending] = useState(false);
  const status = STATUS[health.status];

  async function link(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await callAction(linkTicketToClientAction)(clientId, ticketId);
      setTicketId("");
      toast.success("Linked. Tickets from that customer now show here.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't link the ticket");
    } finally {
      setPending(false);
    }
  }

  async function unlink(requester: { email: string | null; phone: string | null }) {
    try {
      await callAction(unlinkRequesterAction)(clientId, requester);
      toast.success("Unlinked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't unlink");
    }
  }

  return (
    <Panel
      eyebrow="QA Sentinel"
      title="Support experience"
      action={<Badge variant={status.variant}>{status.label}</Badge>}
      description={health.averageScore != null ? `Recent tickets average ${Math.round(health.averageScore)} (last 90 days)` : undefined}
    >
      <div className="flex flex-col gap-3 border-t border-border p-5 text-sm">
        {health.reviews.length === 0 ? (
          <PanelEmpty>No reviewed support tickets from this client in the last 90 days.</PanelEmpty>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Recent reviewed tickets">
            {health.reviews.map((r) => (
              <li key={r.id} className="flex items-start gap-2">
                <Badge variant={scoreVariant(r.score)} className="mt-0.5 w-9 justify-center">{r.score ?? "–"}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">Ticket {r.ticketId}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
                  </p>
                  {r.subject && <p className="truncate text-xs text-muted-foreground" title={r.subject}>{r.subject}</p>}
                  {(r.autoFailed || r.openDispute) && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {r.autoFailed && <Badge variant="destructive">Auto-fail</Badge>}
                      {r.openDispute && <Badge variant="outline">Score disputed</Badge>}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {health.dsat?.whatWentWrong && (
          <div className="rounded-md bg-muted/60 p-3 text-xs">
            <p className="font-medium">Dissatisfaction analysis · {formatDate(health.dsat.createdAt)}</p>
            <p className="mt-1 text-muted-foreground">{health.dsat.whatWentWrong.slice(0, 400)}</p>
            {health.dsat.recoveryProbability && <p className="mt-1">Recovery chance: {health.dsat.recoveryProbability}</p>}
          </div>
        )}

        {health.requesters.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Matched helpdesk contacts</p>
            <ul className="flex flex-col gap-1">
              {health.requesters.map((r) => (
                <li key={`${r.email}|${r.phone}`} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block break-all text-foreground">{[r.email, r.phone].filter(Boolean).join(" · ")}</span>
                    {r.linkedBy === "manual" ? "Linked by an admin" : "Matched automatically"}
                  </span>
                  {isAdmin && (
                    <Button size="xs" variant="ghost" onClick={() => unlink(r)}>
                      Unlink
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isAdmin && (
          <form onSubmit={link} className="flex gap-2">
            <Input aria-label="Ticket ID to link" placeholder="Ticket ID to link" value={ticketId} onChange={(e) => setTicketId(e.target.value)} />
            <Button type="submit" variant="outline" disabled={pending || !ticketId.trim()}>
              {pending ? "Linking…" : "Link"}
            </Button>
          </form>
        )}
      </div>
    </Panel>
  );
}
