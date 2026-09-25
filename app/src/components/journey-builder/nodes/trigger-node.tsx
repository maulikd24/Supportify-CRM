import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";

import type { TriggerNodeData } from "@/lib/journeys/types";

const LABELS: Record<TriggerNodeData["triggerType"], string> = {
  client_created: "Client Created",
  stage_changed: "Stage Changed",
  field_updated: "Field Updated",
  webhook_received: "Webhook Received",
  manual_enrollment: "Manual Enrollment",
};

export function TriggerNode({ data, selected }: NodeProps & { data: TriggerNodeData }) {
  return (
    <div
      className={`rounded-lg border-2 bg-card px-3 py-2 shadow-sm min-w-40 ${selected ? "border-primary" : "border-amber-400"}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
        <Zap className="size-3.5" />
        TRIGGER
      </div>
      <p className="text-sm mt-1">{LABELS[data.triggerType] ?? data.triggerType}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
