"use client";

import { useEffect, useState } from "react";
import type { Node } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ActionNodeData,
  ConditionNodeData,
  TriggerNodeData,
  WaitNodeData,
} from "@/lib/journeys/types";

type UserOption = { id: string; name: string };

const TRIGGER_OPTIONS: { value: TriggerNodeData["triggerType"]; label: string }[] = [
  { value: "client_created", label: "Client Created" },
  { value: "stage_changed", label: "Stage Changed" },
  { value: "field_updated", label: "Field Updated" },
  { value: "webhook_received", label: "Webhook Received" },
  { value: "manual_enrollment", label: "Manual Enrollment" },
];

const ACTION_OPTIONS: { value: ActionNodeData["actionType"]; label: string }[] = [
  { value: "create_task", label: "Create Task" },
  { value: "update_client_status", label: "Update Client Status" },
  { value: "reassign_client", label: "Reassign Client" },
  { value: "add_note", label: "Add Note" },
  { value: "notify_manager", label: "Notify Manager" },
  { value: "send_message", label: "Send Message (WhatsApp/SMS)" },
  { value: "send_email", label: "Send Email" },
  { value: "create_freshdesk_ticket", label: "Create Freshdesk Ticket" },
  { value: "initiate_exotel_call", label: "Initiate Exotel Call" },
  { value: "sync_clevertap_profile", label: "Sync Clevertap Profile" },
  { value: "call_integration_action", label: "Call Integration" },
];

const CLIENT_STATUSES = ["ON_HOLD", "NOT_PROCEEDING"];

const CONDITION_FIELD_SUGGESTIONS = [
  "currentStage.name",
  "status",
  "priority",
  "clientType",
  "leadSource",
  "dealValue",
  "customFields.<key>",
];

const CONDITION_OPERATORS: { value: ConditionNodeData["operator"]; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "before", label: "before (date)" },
  { value: "after", label: "after (date)" },
  { value: "exists", label: "exists" },
  { value: "not_exists", label: "not exists" },
];

function labelFor<T extends string>(options: { value: T; label: string }[], value: T) {
  return options.find((o) => o.value === value)?.label ?? value;
}

function ConditionFields({
  field,
  operator,
  value,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  datalistId,
}: {
  field: string;
  operator: ConditionNodeData["operator"];
  value: unknown;
  onFieldChange: (v: string) => void;
  onOperatorChange: (v: ConditionNodeData["operator"]) => void;
  onValueChange: (v: string) => void;
  datalistId: string;
}) {
  const isDateOperator = operator === "before" || operator === "after";

  return (
    <>
      <Field>
        <FieldLabel>Field</FieldLabel>
        <Input
          value={field ?? ""}
          onChange={(e) => onFieldChange(e.target.value)}
          placeholder="status, currentStage.name..."
          list={datalistId}
        />
        <datalist id={datalistId}>
          {CONDITION_FIELD_SUGGESTIONS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </Field>
      <Field>
        <FieldLabel>Operator</FieldLabel>
        <Select value={operator} onValueChange={(v) => v && onOperatorChange(v as ConditionNodeData["operator"])}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string) => labelFor(CONDITION_OPERATORS, v as ConditionNodeData["operator"])}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CONDITION_OPERATORS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>Value</FieldLabel>
        <Input
          type={isDateOperator ? "date" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onValueChange(e.target.value)}
        />
      </Field>
    </>
  );
}

type TemplateOption = { id: string; name: string; channel: string };

export function NodeConfigPanel({
  node,
  users,
  templates,
  onChange,
  onDelete,
  onClose,
}: {
  node: Node;
  users: UserOption[];
  templates: TemplateOption[];
  onChange: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const data = node.data as Record<string, unknown>;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [node.id]);

  function update(patch: Record<string, unknown>) {
    onChange({ ...data, ...patch });
  }

  return (
    <div className="w-80 shrink-0 border-l bg-card p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Configure Node</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {node.type === "trigger" && (
        <FieldGroup>
          <Field>
            <FieldLabel>Trigger</FieldLabel>
            <Select
              value={(data as unknown as TriggerNodeData).triggerType}
              onValueChange={(v) => v && update({ triggerType: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => labelFor(TRIGGER_OPTIONS, v as TriggerNodeData["triggerType"])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      )}

      {node.type === "action" && (
        <ActionConfigFields
          data={data as unknown as ActionNodeData}
          users={users}
          templates={templates}
          onUpdate={update}
        />
      )}

      {node.type === "condition" && (
        <FieldGroup>
          <ConditionFields
            field={(data as unknown as ConditionNodeData).field}
            operator={(data as unknown as ConditionNodeData).operator}
            value={(data as unknown as ConditionNodeData).value}
            onFieldChange={(v) => update({ field: v })}
            onOperatorChange={(v) => update({ operator: v })}
            onValueChange={(v) => update({ value: v })}
            datalistId="condition-field-suggestions"
          />
        </FieldGroup>
      )}

      {node.type === "wait" && (
        <FieldGroup>
          <Field>
            <FieldLabel>Wait Type</FieldLabel>
            <Select
              value={(data as unknown as WaitNodeData).waitType}
              onValueChange={(v) => v && update({ waitType: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wait_duration">Wait Duration</SelectItem>
                <SelectItem value="wait_until_condition">Wait Until Condition</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>
              {(data as unknown as WaitNodeData).waitType === "wait_until_condition"
                ? "Poll interval (minutes)"
                : "Duration (minutes)"}
            </FieldLabel>
            <Input
              type="number"
              min={1}
              value={(data as unknown as WaitNodeData).durationMinutes ?? 60}
              onChange={(e) => update({ durationMinutes: Number(e.target.value) })}
            />
          </Field>
          {(data as unknown as WaitNodeData).waitType === "wait_until_condition" && (
            <ConditionFields
              field={(data as unknown as WaitNodeData).condition?.field ?? ""}
              operator={(data as unknown as WaitNodeData).condition?.operator ?? "equals"}
              value={(data as unknown as WaitNodeData).condition?.value}
              onFieldChange={(v) =>
                update({
                  condition: {
                    conditionType: "branch_on_field",
                    field: v,
                    operator: (data as unknown as WaitNodeData).condition?.operator ?? "equals",
                    value: (data as unknown as WaitNodeData).condition?.value,
                  },
                })
              }
              onOperatorChange={(v) =>
                update({
                  condition: {
                    conditionType: "branch_on_field",
                    field: (data as unknown as WaitNodeData).condition?.field ?? "",
                    operator: v,
                    value: (data as unknown as WaitNodeData).condition?.value,
                  },
                })
              }
              onValueChange={(v) =>
                update({
                  condition: {
                    conditionType: "branch_on_field",
                    field: (data as unknown as WaitNodeData).condition?.field ?? "",
                    operator: (data as unknown as WaitNodeData).condition?.operator ?? "equals",
                    value: v,
                  },
                })
              }
              datalistId="wait-condition-field-suggestions"
            />
          )}
          {(data as unknown as WaitNodeData).waitType === "wait_until_condition" && (
            <Field>
              <FieldLabel>Timeout (minutes)</FieldLabel>
              <Input
                type="number"
                min={1}
                value={(data as unknown as WaitNodeData).timeoutMinutes ?? 1440}
                onChange={(e) => update({ timeoutMinutes: Number(e.target.value) })}
              />
            </Field>
          )}
        </FieldGroup>
      )}

      {node.type !== "trigger" && !confirmingDelete && (
        <Button variant="destructive" size="sm" onClick={() => setConfirmingDelete(true)} className="mt-auto">
          Delete Node
        </Button>
      )}
      {node.type !== "trigger" && confirmingDelete && (
        <div className="mt-auto flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <p className="text-xs">Delete this node?</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" className="flex-1" onClick={onDelete}>
              Confirm
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionConfigFields({
  data,
  users,
  templates,
  onUpdate,
}: {
  data: ActionNodeData;
  users: UserOption[];
  templates: TemplateOption[];
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const config = data.config ?? {};

  function updateConfig(patch: Record<string, unknown>) {
    onUpdate({ config: { ...config, ...patch } });
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Action</FieldLabel>
        <Select value={data.actionType} onValueChange={(v) => v && onUpdate({ actionType: v, config: {} })}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string) => labelFor(ACTION_OPTIONS, v as ActionNodeData["actionType"])}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {data.actionType === "create_task" && (
        <>
          <Field>
            <FieldLabel>Task title</FieldLabel>
            <Input
              value={String(config.title ?? "")}
              onChange={(e) => updateConfig({ title: e.target.value })}
              placeholder="Follow up call"
            />
          </Field>
          <Field>
            <FieldLabel>Due in (minutes)</FieldLabel>
            <Input
              type="number"
              min={1}
              value={Number(config.dueInMinutes ?? 1440)}
              onChange={(e) => updateConfig({ dueInMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field>
            <FieldLabel>Assign to (optional — defaults to client owner)</FieldLabel>
            <Select
              value={String(config.assignedToId ?? "")}
              onValueChange={(v) => updateConfig({ assignedToId: v ?? undefined })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Client owner">
                  {(v: string) => users.find((u) => u.id === v)?.name ?? "Client owner"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}

      {data.actionType === "update_client_status" && (
        <>
          <Field>
            <FieldLabel>New status</FieldLabel>
            <Select value={String(config.status ?? "")} onValueChange={(v) => v && updateConfig({ status: v })}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CLIENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Reason</FieldLabel>
            <Input
              value={String(config.reason ?? "")}
              onChange={(e) => updateConfig({ reason: e.target.value })}
              placeholder="Automated by journey"
            />
          </Field>
        </>
      )}

      {data.actionType === "reassign_client" && (
        <Field>
          <FieldLabel>Reassign to</FieldLabel>
          <Select
            value={String(config.assignedToId ?? "")}
            onValueChange={(v) => v && updateConfig({ assignedToId: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select user">
                {(v: string) => users.find((u) => u.id === v)?.name ?? "Select user"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {data.actionType === "add_note" && (
        <Field>
          <FieldLabel>Note</FieldLabel>
          <Textarea
            value={String(config.note ?? "")}
            onChange={(e) => updateConfig({ note: e.target.value })}
            rows={3}
          />
        </Field>
      )}

      {data.actionType === "notify_manager" && (
        <Field>
          <FieldLabel>Message (optional)</FieldLabel>
          <Textarea
            value={String(config.message ?? "")}
            onChange={(e) => updateConfig({ message: e.target.value })}
            rows={2}
          />
        </Field>
      )}

      {data.actionType === "send_message" && (
        <>
          <Field>
            <FieldLabel>Channel</FieldLabel>
            <Select
              value={String(config.channel ?? "whatsapp")}
              onValueChange={(v) => v && updateConfig({ channel: v, templateId: undefined })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => (v === "whatsapp" ? "WhatsApp" : "SMS")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Template</FieldLabel>
            {(() => {
              const channel = String(config.channel ?? "whatsapp");
              const channelTemplates = templates.filter((t) => t.channel === channel);
              return (
                <>
                  <Select
                    value={String(config.templateId ?? "")}
                    onValueChange={(v) => v && updateConfig({ templateId: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select an approved template">
                        {(v: string) => channelTemplates.find((t) => t.id === v)?.name ?? "Select an approved template"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {channelTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {channelTemplates.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No approved {channel} templates — add one in Settings &gt; Templates.
                    </p>
                  )}
                </>
              );
            })()}
          </Field>
        </>
      )}

      {data.actionType === "send_email" && (
        <>
          <Field>
            <FieldLabel>Subject</FieldLabel>
            <Input
              value={String(config.subject ?? "")}
              onChange={(e) => updateConfig({ subject: e.target.value })}
              placeholder="An update on your account, {{name}}"
            />
          </Field>
          <Field>
            <FieldLabel>Body</FieldLabel>
            <Textarea
              value={String(config.body ?? "")}
              onChange={(e) => updateConfig({ body: e.target.value })}
              rows={4}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Supports <code>{"{{name}}"}</code> and <code>{"{{clientCode}}"}</code>. Sends to the client&apos;s email
            on file.
          </p>
        </>
      )}

      {data.actionType === "create_freshdesk_ticket" && (
        <>
          <Field>
            <FieldLabel>Subject</FieldLabel>
            <Input
              value={String(config.subject ?? "")}
              onChange={(e) => updateConfig({ subject: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              value={String(config.description ?? "")}
              onChange={(e) => updateConfig({ description: e.target.value })}
              rows={3}
            />
          </Field>
          <Field>
            <FieldLabel>Priority</FieldLabel>
            <Select
              value={String(config.priority ?? "1")}
              onValueChange={(v) => v && updateConfig({ priority: Number(v) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) =>
                    ({ "1": "Low", "2": "Medium", "3": "High", "4": "Urgent" })[v] ?? "Low"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Low</SelectItem>
                <SelectItem value="2">Medium</SelectItem>
                <SelectItem value="3">High</SelectItem>
                <SelectItem value="4">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      )}

      {(data.actionType === "initiate_exotel_call" || data.actionType === "sync_clevertap_profile") && (
        <p className="text-xs text-muted-foreground">No configuration needed.</p>
      )}

      {data.actionType === "call_integration_action" && (
        <>
          <Field>
            <FieldLabel>Provider</FieldLabel>
            <Input
              value={String(config.provider ?? "")}
              onChange={(e) => updateConfig({ provider: e.target.value })}
              placeholder="freshdesk, exotel, clevertap"
            />
          </Field>
          <Field>
            <FieldLabel>Action</FieldLabel>
            <Input
              value={String(config.action ?? "")}
              onChange={(e) => updateConfig({ action: e.target.value })}
              placeholder="createTicket, initiateCall..."
            />
          </Field>
        </>
      )}
    </FieldGroup>
  );
}
