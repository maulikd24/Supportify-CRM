"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callAction } from "@/lib/actions/call-action";
import { addTeamMappingAction, createTeamAction, deleteTeamAction, removeTeamMappingAction } from "./actions";

type Kind = "OWNER" | "SUPPORT" | "BPO";
type MatchType = "email" | "domain" | "group";
type Team = {
  id: string;
  name: string;
  kind: Kind;
  benchmarkTeamName: string | null;
  mappings: { id: string; matchType: string; value: string }[];
};

const KIND_LABEL: Record<Kind, string> = { OWNER: "Fixes issues", SUPPORT: "In-house support", BPO: "BPO partner" };
const KIND_HINT: Record<Kind, string> = {
  OWNER: "A team that owns topics and fixes their root cause (product, logistics, billing…).",
  SUPPORT: "Your own support agents.",
  BPO: "An outsourced support partner, benchmarked against an in-house team.",
};
const MATCH_LABEL: Record<MatchType, string> = { email: "Agent email", domain: "Email domain", group: "Helpdesk group" };

async function run(action: () => Promise<unknown>, success: string) {
  try {
    await action();
    toast.success(success);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Something went wrong");
    return false;
  }
}

function MappingForm({ teamId }: { teamId: string }) {
  const [matchType, setMatchType] = useState<MatchType>("domain");
  const [value, setValue] = useState("");
  async function add(event: FormEvent) {
    event.preventDefault();
    if (await run(() => callAction(addTeamMappingAction)({ teamId, matchType, value }), "Agents mapped")) setValue("");
  }
  return (
    <form onSubmit={add} className="mt-2 flex flex-wrap gap-2">
      <Select value={matchType} onValueChange={(v) => v && setMatchType(v as MatchType)}>
        <SelectTrigger className="w-40" aria-label="Match agents by">
          <SelectValue>{(v: string) => MATCH_LABEL[v as MatchType]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(MATCH_LABEL) as MatchType[]).map((m) => (
            <SelectItem key={m} value={m}>
              {MATCH_LABEL[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        aria-label="Agent email, domain or group"
        className="min-w-40 flex-1"
        placeholder={matchType === "email" ? "agent@company.com" : matchType === "domain" ? "bpo-partner.com" : "Tier 2"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" disabled={!value.trim()}>
        Add
      </Button>
    </form>
  );
}

export function TeamsPanel({ teams, canEdit }: { teams: Team[]; canEdit: boolean }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("SUPPORT");
  const [benchmarkTeamId, setBenchmarkTeamId] = useState("");
  const supportTeams = teams.filter((t) => t.kind === "SUPPORT");

  async function create(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () => callAction(createTeamAction)({ name, kind, benchmarkTeamId: kind === "BPO" ? benchmarkTeamId || null : null }),
      "Team added",
    );
    if (ok) {
      setName("");
      setBenchmarkTeamId("");
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border p-5">
      {teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
      {teams.map((team) => (
        <div key={team.id} className="rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              {team.name}
              <Badge variant="secondary">{KIND_LABEL[team.kind]}</Badge>
              {team.benchmarkTeamName && <span className="text-xs text-muted-foreground">compared with {team.benchmarkTeamName}</span>}
            </p>
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => run(() => callAction(deleteTeamAction)(team.id), "Team removed")}>
                Remove
              </Button>
            )}
          </div>
          {team.kind !== "OWNER" && (
            <div className="mt-2 text-xs text-muted-foreground">
              {team.mappings.length === 0 ? (
                <p>No agents mapped yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {team.mappings.map((m) => (
                    <li key={m.id} className="flex items-center gap-1 rounded-full border px-2 py-0.5">
                      <span>
                        {MATCH_LABEL[m.matchType as MatchType]}: {m.value}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Remove ${m.value}`}
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => run(() => callAction(removeTeamMappingAction)(m.id), "Mapping removed")}
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && <MappingForm teamId={team.id} />}
            </div>
          )}
        </div>
      ))}

      {canEdit && (
        <form onSubmit={create} className="flex flex-col gap-2 rounded-md border border-dashed p-4">
          <p className="text-sm font-medium">Add a team</p>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Team name" className="min-w-40 flex-1" placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
            <Select value={kind} onValueChange={(v) => v && setKind(v as Kind)}>
              <SelectTrigger className="w-44" aria-label="Team type">
                <SelectValue>{(v: string) => KIND_LABEL[v as Kind]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {kind === "BPO" && supportTeams.length > 0 && (
              <Select value={benchmarkTeamId} onValueChange={(v) => setBenchmarkTeamId((v as string) ?? "")}>
                <SelectTrigger className="w-48" aria-label="Benchmark against">
                  <SelectValue placeholder="Compare with…">
                    {(v: string) => supportTeams.find((t) => t.id === v)?.name ?? "Compare with…"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {supportTeams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Add team
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
        </form>
      )}
    </div>
  );
}
