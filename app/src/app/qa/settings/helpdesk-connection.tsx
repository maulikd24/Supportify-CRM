"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callAction } from "@/lib/actions/call-action";
import { cn } from "@/lib/utils";
import type { HelpdeskProviderOption } from "@/lib/qa/helpdesks";
import { connectHelpdeskAction, disconnectHelpdeskAction, retestHelpdeskConnectionAction } from "./actions";

export function HelpdeskConnection({
  providers,
  connection,
  canEdit,
}: {
  providers: HelpdeskProviderOption[];
  connection: { provider: string; accountLabel: string; isValid: boolean; lastCheckedLabel: string | null } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [choosing, setChoosing] = useState(connection === null);
  const [selected, setSelected] = useState<HelpdeskProviderOption | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const current = connection ? providers.find((p) => p.id === connection.provider) : undefined;

  function pick(provider: HelpdeskProviderOption) {
    setSelected(provider);
    setValues(Object.fromEntries(provider.fields.filter((f) => f.type === "select").map((f) => [f.key, f.options?.[0]?.value ?? ""])));
  }

  async function run(kind: string, fn: () => Promise<unknown>, success: string) {
    setPending(kind);
    try {
      await fn();
      toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
      return false;
    } finally {
      setPending(null);
    }
  }

  async function connect() {
    if (!selected) return;
    if (connection && connection.provider !== selected.id && !confirm(`Switch from ${current?.name ?? connection.provider} to ${selected.name}? Queued auto-reviews for the old helpdesk are skipped.`)) return;
    const ok = await run("connect", () => callAction(connectHelpdeskAction)(selected.id, values), `${selected.name} connected`);
    if (ok) {
      setSelected(null);
      setChoosing(false);
      setValues({});
    }
  }

  if (connection && !choosing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
            {current?.name ?? connection.provider}
            <Badge variant={connection.isValid ? "success" : "destructive"}>{connection.isValid ? "Connected" : "Needs attention"}</Badge>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {connection.accountLabel}
            {connection.lastCheckedLabel && ` · checked ${connection.lastCheckedLabel}`}
          </p>
          {!connection.isValid && <p className="mt-1 text-xs text-destructive">The last check failed. Re-test, or reconnect with new credentials.</p>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => run("test", () => callAction(retestHelpdeskConnectionAction)(), "Connection verified")}>
              {pending === "test" ? "Testing..." : "Re-test"}
            </Button>
            <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => setChoosing(true)}>
              Change helpdesk
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending !== null}
              onClick={() => confirm(`Disconnect ${current?.name ?? "the helpdesk"}? Reviews and auto-review stop until you connect again.`) && run("disconnect", () => callAction(disconnectHelpdeskAction)(), "Helpdesk disconnected")}
            >
              Disconnect
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!canEdit) return <p className="text-[13px] text-muted-foreground">No helpdesk is connected yet. Ask an organization owner or admin to connect one.</p>;

  if (!selected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p)}
              className={cn(
                "flex min-h-14 items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-[13px] font-semibold transition-colors hover:border-primary/50 hover:bg-primary/5",
                connection?.provider === p.id && "border-primary/60",
              )}
            >
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 font-heading text-xs font-bold text-primary">
                {p.name.charAt(0)}
              </span>
              <span className="min-w-0 leading-tight">
                {p.name}
                {connection?.provider === p.id && <span className="block text-[11px] font-normal text-muted-foreground">Current</span>}
              </span>
            </button>
          ))}
        </div>
        {connection && (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setChoosing(false)}>
            <ArrowLeft /> Keep {current?.name ?? "the current helpdesk"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      <div>
        <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={() => setSelected(null)}>
          <ArrowLeft /> All helpdesks
        </Button>
        <p className="mt-1 text-[13px] font-semibold">Connect {selected.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {selected.setupHelp}{" "}
          <a href={selected.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
            Guide <ExternalLink className="size-3" />
          </a>
        </p>
      </div>
      <FieldGroup>
        {selected.fields.map((f) => (
          <Field key={f.key}>
            <FieldLabel htmlFor={`hd-${f.key}`}>
              {f.label}
              {f.optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
            </FieldLabel>
            {f.type === "select" ? (
              <Select value={values[f.key] ?? ""} onValueChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v as string }))}>
                <SelectTrigger id={`hd-${f.key}`} className="w-full">
                  <SelectValue>{(v: string) => f.options?.find((o) => o.value === v)?.label ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {f.options?.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`hd-${f.key}`}
                type={f.type}
                autoComplete={f.type === "password" ? "new-password" : "off"}
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                required={!f.optional}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            )}
            {f.help && <FieldDescription>{f.help}</FieldDescription>}
          </Field>
        ))}
      </FieldGroup>
      <p className="text-xs text-muted-foreground">We test the credentials before saving them, and store them encrypted. QA Sentinel only reads tickets; it never changes them.</p>
      <Button type="submit" className="self-start" disabled={pending !== null}>
        {pending === "connect" ? "Testing connection..." : `Connect ${selected.name}`}
      </Button>
    </form>
  );
}
