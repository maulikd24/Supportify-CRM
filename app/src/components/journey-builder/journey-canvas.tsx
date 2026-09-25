"use client";

import { useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Save, Play, Pause } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TriggerNode } from "./nodes/trigger-node";
import { ActionNode } from "./nodes/action-node";
import { ConditionNode } from "./nodes/condition-node";
import { WaitNode } from "./nodes/wait-node";
import { NodeConfigPanel } from "./node-config-panel";
import { saveJourneyGraphAction, setJourneyActiveAction } from "@/app/(dashboard)/journeys/actions";
import type { JourneyGraph } from "@/lib/journeys/types";

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  wait: WaitNode,
};

let idCounter = 1;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

export function JourneyCanvas({
  journeyId,
  initialGraph,
  isActive,
  canEdit,
  users,
  templates,
}: {
  journeyId: string;
  initialGraph: JourneyGraph;
  isActive: boolean;
  canEdit: boolean;
  users: { id: string; name: string }[];
  templates: { id: string; name: string; channel: string }[];
}) {
  const [nodes, setNodes] = useState<Node[]>(initialGraph.nodes as unknown as Node[]);
  const [edges, setEdges] = useState<Edge[]>(initialGraph.edges as unknown as Edge[]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState(isActive);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );
  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [],
  );

  function addNode(type: "action" | "condition" | "wait") {
    const id = nextId(type);
    const defaults: Record<string, unknown> =
      type === "action"
        ? { actionType: "add_note", config: { note: "" } }
        : type === "condition"
          ? { conditionType: "branch_on_field", field: "status", operator: "equals", value: "" }
          : { waitType: "wait_duration", durationMinutes: 60 };

    setNodes((nds) => [
      ...nds,
      {
        id,
        type,
        position: { x: 250 + nds.length * 30, y: 150 + nds.length * 40 },
        data: defaults,
      },
    ]);
  }

  function updateSelectedNodeData(data: Record<string, unknown>) {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.map((n) => (n.id === selectedNodeId ? { ...n, data } : n)));
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const graph: JourneyGraph = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type as JourneyGraph["nodes"][number]["type"],
          position: n.position,
          data: n.data as unknown as JourneyGraph["nodes"][number]["data"],
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: (e.sourceHandle as "true" | "false" | null) ?? null,
        })),
      };
      await saveJourneyGraphAction(journeyId, graph);
      toast.success("Journey saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save journey");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    const next = !active;
    setActive(next);
    try {
      await setJourneyActiveAction(journeyId, next);
      toast.success(next ? "Journey activated" : "Journey deactivated");
    } catch (error) {
      setActive(!next);
      toast.error(error instanceof Error ? error.message : "Failed to update journey");
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div className="flex h-[calc(100vh-6rem)] rounded-lg border overflow-hidden">
      <div className="flex flex-col gap-2 border-r bg-card p-3 w-48 shrink-0">
        <p className="text-xs font-medium text-muted-foreground mb-1">Add Node</p>
        <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => addNode("action")}>
          <Plus className="size-3.5" />
          Action
        </Button>
        <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => addNode("condition")}>
          <Plus className="size-3.5" />
          Condition
        </Button>
        <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => addNode("wait")}>
          <Plus className="size-3.5" />
          Wait
        </Button>

        <div className="mt-auto flex flex-col gap-2">
          <Badge variant={active ? "default" : "outline"} className="self-start">
            {active ? "Active" : "Inactive"}
          </Badge>
          <Button size="sm" variant="secondary" onClick={handleToggleActive}>
            {active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {active ? "Deactivate" : "Activate"}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canEdit || saving}>
            <Save className="size-3.5" />
            {saving ? "Saving..." : "Save"}
          </Button>
          {!canEdit && (
            <p className="text-[11px] text-muted-foreground">
              Clients are currently enrolled — deactivate to edit.
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          elementsSelectable={canEdit}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      {selectedNode && canEdit && (
        <NodeConfigPanel
          node={selectedNode}
          users={users}
          templates={templates}
          onChange={updateSelectedNodeData}
          onDelete={deleteSelectedNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}
