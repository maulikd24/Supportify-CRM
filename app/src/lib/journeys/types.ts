export type TriggerType =
  | "client_created"
  | "stage_changed"
  | "field_updated"
  | "webhook_received"
  | "manual_enrollment";

export type ActionType =
  | "send_message"
  | "send_email"
  | "create_task"
  | "update_client_status"
  | "reassign_client"
  | "notify_manager"
  | "add_note"
  | "create_freshdesk_ticket"
  | "initiate_exotel_call"
  | "sync_clevertap_profile"
  | "call_integration_action";

export type ConditionType = "branch_on_field";

export type WaitType = "wait_duration" | "wait_until_condition";

export type JourneyNodeType = "trigger" | "action" | "condition" | "wait";

export interface TriggerNodeData {
  triggerType: TriggerType;
  config?: Record<string, unknown>;
}

export interface ActionNodeData {
  actionType: ActionType;
  config: Record<string, unknown>;
}

export interface ConditionNodeData {
  conditionType: ConditionType;
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "exists"
    | "not_exists"
    | "contains"
    | "greater_than"
    | "less_than"
    | "before"
    | "after";
  value?: unknown;
}

export interface WaitNodeData {
  waitType: WaitType;
  /** For wait_duration: how long to wait. For wait_until_condition: poll interval. */
  durationMinutes?: number;
  /** wait_until_condition only: the condition polled on each tick. */
  condition?: ConditionNodeData;
  /** wait_until_condition only: give up waiting and proceed after this many minutes total. */
  timeoutMinutes?: number;
}

export interface JourneyNode {
  id: string;
  type: JourneyNodeType;
  position?: { x: number; y: number };
  data: TriggerNodeData | ActionNodeData | ConditionNodeData | WaitNodeData;
}

export interface JourneyEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: "true" | "false" | null;
}

export interface JourneyGraph {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
}
