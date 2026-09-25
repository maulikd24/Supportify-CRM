import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";

import type { WaitNodeData } from "@/lib/journeys/types";

export function WaitNode({ data, selected }: NodeProps & { data: WaitNodeData }) {
  const summary =
    data.waitType === "wait_duration"
      ? `Wait ${data.durationMinutes ?? 60} min`
      : `Poll until condition (every ${data.durationMinutes ?? 15} min)`;

  return (
    <div
      className={`rounded-lg border-2 bg-card px-3 py-2 shadow-sm min-w-40 ${selected ? "border-primary" : "border-orange-400"}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 text-xs font-medium text-orange-600">
        <Clock className="size-3.5" />
        WAIT
      </div>
      <p className="text-sm mt-1">{summary}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
