import { z } from "zod";

const triggerNodeDataSchema = z.object({
  triggerType: z.enum([
    "client_created",
    "stage_changed",
    "field_updated",
    "webhook_received",
    "manual_enrollment",
  ]),
  config: z.record(z.string(), z.unknown()).optional(),
});

const actionNodeDataSchema = z.object({
  actionType: z.enum([
    "send_message",
    "send_email",
    "create_task",
    "update_client_status",
    "reassign_client",
    "notify_manager",
    "add_note",
    "create_freshdesk_ticket",
    "initiate_exotel_call",
    "sync_clevertap_profile",
    "call_integration_action",
  ]),
  config: z.record(z.string(), z.unknown()),
});

const conditionNodeDataSchema = z.object({
  conditionType: z.literal("branch_on_field"),
  field: z.string().min(1),
  operator: z.enum([
    "equals",
    "not_equals",
    "exists",
    "not_exists",
    "contains",
    "greater_than",
    "less_than",
    "before",
    "after",
  ]),
  value: z.unknown().optional(),
});

const waitNodeDataSchema = z.object({
  waitType: z.enum(["wait_duration", "wait_until_condition"]),
  durationMinutes: z.number().positive().optional(),
  condition: conditionNodeDataSchema.optional(),
  timeoutMinutes: z.number().positive().optional(),
});

const journeyNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["trigger", "action", "condition", "wait"]),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  data: z.union([
    triggerNodeDataSchema,
    actionNodeDataSchema,
    conditionNodeDataSchema,
    waitNodeDataSchema,
  ]),
});

const journeyEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.enum(["true", "false"]).nullable().optional(),
});

export const journeyGraphSchema = z.object({
  nodes: z.array(journeyNodeSchema).min(1),
  edges: z.array(journeyEdgeSchema),
});

export type ValidatedJourneyGraph = z.infer<typeof journeyGraphSchema>;

export function validateJourneyGraph(graph: unknown): ValidatedJourneyGraph {
  const parsed = journeyGraphSchema.parse(graph);

  const triggerNodes = parsed.nodes.filter((n) => n.type === "trigger");
  if (triggerNodes.length !== 1) {
    throw new Error("Journey must have exactly one trigger node");
  }

  const nodeIds = new Set(parsed.nodes.map((n) => n.id));
  for (const edge of parsed.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`Edge references unknown node: ${edge.source} -> ${edge.target}`);
    }
  }

  const reachable = new Set<string>();
  const queue = [triggerNodes[0].id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of parsed.edges.filter((e) => e.source === current)) {
      queue.push(edge.target);
    }
  }
  const orphans = parsed.nodes.filter((n) => !reachable.has(n.id));
  if (orphans.length > 0) {
    throw new Error(`Journey has unreachable node(s): ${orphans.map((n) => n.id).join(", ")}`);
  }

  for (const node of parsed.nodes) {
    if (node.type === "condition") {
      const outgoing = parsed.edges.filter((e) => e.source === node.id);
      const hasTrue = outgoing.some((e) => e.sourceHandle === "true");
      const hasFalse = outgoing.some((e) => e.sourceHandle === "false");
      if (!hasTrue || !hasFalse) {
        throw new Error(`Condition node ${node.id} must have both true and false branches connected`);
      }
    }
  }

  return parsed;
}
