import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

import type { ConditionNodeData } from "@/lib/journeys/types";

export function ConditionNode({ data, selected }: NodeProps & { data: ConditionNodeData }) {
  return (
    <div
      className={`rounded-lg border-2 bg-card px-3 py-2 shadow-sm min-w-44 ${selected ? "border-primary" : "border-violet-400"}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 text-xs font-medium text-violet-600">
        <GitBranch className="size-3.5" />
        CONDITION
      </div>
      <p className="text-sm mt-1">
        {data.field} {data.operator.replace(/_/g, " ")} {data.value != null ? String(data.value) : ""}
      </p>
      <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
        <span>False</span>
        <span>True</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: "25%" }} />
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: "75%" }} />
    </div>
  );
}
