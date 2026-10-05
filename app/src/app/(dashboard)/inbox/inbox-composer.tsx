"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callAction } from "@/lib/actions/call-action";
import { sendInboxReplyAction } from "./actions";

export type ComposerTemplate = { id: string; name: string; variables: string[] };

/**
 * Reply box for one conversation. WhatsApp allows free text only inside the 24-hour window
 * after the client's last message; outside it (and whenever the user prefers) an approved
 * template is sent instead. The server enforces the same rule.
 */
export function InboxComposer({
  clientId,
  channel,
  freeTextAllowed,
  templates,
}: {
  clientId: string;
  channel: "whatsapp" | "sms";
  freeTextAllowed: boolean;
  templates: ComposerTemplate[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"text" | "template">(freeTextAllowed ? "text" : "template");
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const template = templates.find((t) => t.id === templateId);

  async function send() {
    setPending(true);
    try {
      if (mode === "text") {
        await callAction(sendInboxReplyAction)(clientId, { kind: "text", channel, text });
        setText("");
      } else {
        if (!templateId) throw new Error("Choose a template");
        await callAction(sendInboxReplyAction)(clientId, { kind: "template", channel, templateId, variables });
        setTemplateId("");
        setVariables({});
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border p-4">
      {!freeTextAllowed && channel === "whatsapp" && (
        <p className="text-xs text-muted-foreground">
          The 24-hour WhatsApp window is closed, so only approved templates can be sent until the client writes again.
        </p>
      )}
      {freeTextAllowed && (
        <div className="flex gap-2 text-xs">
          <Button size="sm" variant={mode === "text" ? "secondary" : "ghost"} onClick={() => setMode("text")}>
            Message
          </Button>
          <Button size="sm" variant={mode === "template" ? "secondary" : "ghost"} onClick={() => setMode("template")}>
            Template
          </Button>
        </div>
      )}

      {mode === "text" ? (
        <Textarea
          aria-label="Reply"
          placeholder={`Reply on ${channel === "whatsapp" ? "WhatsApp" : "SMS"}…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
        />
      ) : (
        <FieldGroup>
          <Field>
            <FieldLabel>Template</FieldLabel>
            <Select value={templateId} onValueChange={(v) => v && setTemplateId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an approved template">
                  {(v: string) => templates.find((t) => t.id === v)?.name ?? "Select an approved template"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.length === 0 && (
              <p className="text-xs text-muted-foreground">No approved {channel} templates yet. Add one in Settings &gt; Templates.</p>
            )}
          </Field>
          {template?.variables.map((name) => (
            <Field key={name}>
              <FieldLabel htmlFor={`inbox-var-${name}`}>{name}</FieldLabel>
              <Input
                id={`inbox-var-${name}`}
                value={variables[name] ?? ""}
                onChange={(e) => setVariables((v) => ({ ...v, [name]: e.target.value }))}
              />
            </Field>
          ))}
        </FieldGroup>
      )}

      <div className="flex justify-end">
        <Button onClick={send} disabled={pending || (mode === "text" ? !text.trim() : !templateId)}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
