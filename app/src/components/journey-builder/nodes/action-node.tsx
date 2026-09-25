import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bolt } from "lucide-react";

import type { ActionNodeData } from "@/lib/journeys/types";

const LABELS: Record<ActionNodeData["actionType"], string> = {
  send_message: "Send Message",
  send_email: "Send Email",
  create_task: "Create Task",
  update_client_status: "Update Client Status",
  reassign_client: "Reassign Client",
  notify_manager: "Notify Manager",
  add_note: "Add Note",
  create_freshdesk_ticket: "Create Freshdesk Ticket",
  initiate_exotel_call: "Initiate Exotel Call",
  sync_clevertap_profile: "Sync Clevertap Profile",
  call_integration_action: "Call Integration",
};

export function ActionNode({ data, selected }: NodeProps & { data: ActionNodeData }) {
  return (
    <div
      className={`rounded-lg border-2 bg-card px-3 py-2 shadow-sm min-w-40 ${selected ? "border-primary" : "border-blue-400"}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600">
        <Bolt className="size-3.5" />
        ACTION
      </div>
      <p className="text-sm mt-1">{LABELS[data.actionType] ?? data.actionType}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
