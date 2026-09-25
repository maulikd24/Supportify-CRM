import type { Client } from "@/generated/prisma/client";
import type { ConditionNodeData } from "@/lib/journeys/types";

type ClientWithRelations = Client & {
  currentStage?: { name: string } | null;
};

const CUSTOM_FIELD_PREFIX = "customFields.";

function getField(client: ClientWithRelations, context: Record<string, unknown>, field: string): unknown {
  if (field === "currentStage.name") return client.currentStage?.name;

  if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
    const key = field.slice(CUSTOM_FIELD_PREFIX.length);
    const customFields = (client.customFields as Record<string, unknown> | null) ?? {};
    return customFields[key];
  }

  if (field.startsWith("context.")) {
    return context[field.slice("context.".length)];
  }
  const clientRecord = client as unknown as Record<string, unknown>;
  return clientRecord[field];
}

export function evaluateCondition(
  data: ConditionNodeData,
  client: ClientWithRelations,
  context: Record<string, unknown>,
): boolean {
  const fieldValue = getField(client, context, data.field);

  try {
    switch (data.operator) {
      case "exists":
        return fieldValue !== undefined && fieldValue !== null && fieldValue !== "";
      case "not_exists":
        return fieldValue === undefined || fieldValue === null || fieldValue === "";
      case "equals":
        return fieldValue === data.value;
      case "not_equals":
        return fieldValue !== data.value;
      case "contains":
        return String(fieldValue ?? "").includes(String(data.value ?? ""));
      case "greater_than": {
        const a = Number(fieldValue);
        const b = Number(data.value);
        if (Number.isNaN(a) || Number.isNaN(b)) return false;
        return a > b;
      }
      case "less_than": {
        const a = Number(fieldValue);
        const b = Number(data.value);
        if (Number.isNaN(a) || Number.isNaN(b)) return false;
        return a < b;
      }
      case "before": {
        const a = new Date(String(fieldValue ?? "")).getTime();
        const b = new Date(String(data.value ?? "")).getTime();
        if (Number.isNaN(a) || Number.isNaN(b)) return false;
        return a < b;
      }
      case "after": {
        const a = new Date(String(fieldValue ?? "")).getTime();
        const b = new Date(String(data.value ?? "")).getTime();
        if (Number.isNaN(a) || Number.isNaN(b)) return false;
        return a > b;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}
