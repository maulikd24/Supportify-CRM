import { prisma } from "@/lib/db/prisma";
import { executeAction } from "@/lib/journeys/nodes/action";
import { evaluateCondition } from "@/lib/journeys/nodes/condition";
import { computeScheduledFor, hasTimedOut } from "@/lib/journeys/nodes/wait";
import type {
  JourneyGraph,
  JourneyNode,
  ActionNodeData,
  ConditionNodeData,
  WaitNodeData,
} from "@/lib/journeys/types";

function findNode(graph: JourneyGraph, nodeId: string): JourneyNode {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`Journey graph missing node ${nodeId}`);
  return node;
}

function firstOutgoing(graph: JourneyGraph, nodeId: string) {
  return graph.edges.find((e) => e.source === nodeId);
}

async function completeRun(runId: string) {
  await prisma.journeyRun.update({
    where: { id: runId },
    data: { status: "COMPLETED", currentNodeId: null },
  });
}

async function failRun(runId: string, nodeId: string, reason: string) {
  await prisma.journeyRun.update({ where: { id: runId }, data: { status: "FAILED" } });
  await prisma.journeyRunStep.create({
    data: { runId, nodeId, nodeType: "system", status: "failed", result: { error: reason } },
  });
}

/**
 * Advances a journey run one segment at a time (through action/condition nodes)
 * until it hits a wait node (pauses, to be resumed by the scheduler poller) or
 * runs off the end of the graph (completes).
 */
export async function advanceRun(runId: string): Promise<void> {
  const run = await prisma.journeyRun.findUnique({
    where: { id: runId },
    include: {
      journey: true,
      client: {
        include: { currentStage: true },
      },
    },
  });
  if (!run) return;
  if (run.status !== "RUNNING" && run.status !== "WAITING") return;

  const graph = run.journey.definition as unknown as JourneyGraph;
  const context = { ...(run.context as Record<string, unknown>) };
  const client = run.client;

  let currentNodeId = run.currentNodeId;

  if (currentNodeId === null) {
    const triggerNode = graph.nodes.find((n) => n.type === "trigger");
    if (!triggerNode) return failRun(runId, "root", "Journey has no trigger node");
    const next = firstOutgoing(graph, triggerNode.id);
    if (!next) return completeRun(runId);
    currentNodeId = next.target;
  } else {
    const resumeNode = findNode(graph, currentNodeId);
    if (resumeNode.type === "wait") {
      const data = resumeNode.data as WaitNodeData;
      if (data.waitType === "wait_until_condition" && data.condition) {
        const waitStartedAt = new Date(String(context._waitStartedAt ?? run.updatedAt));
        const now = new Date();
        const conditionMet = evaluateCondition(data.condition, client, context);
        const timedOut = hasTimedOut(data, waitStartedAt, now);

        if (!conditionMet && !timedOut) {
          const scheduledFor = computeScheduledFor(data, now);
          await prisma.journeyRunStep.updateMany({
            where: { runId, nodeId: resumeNode.id, status: "pending" },
            data: { scheduledFor },
          });
          return;
        }
      }

      await prisma.journeyRunStep.updateMany({
        where: { runId, nodeId: resumeNode.id, status: "pending" },
        data: { status: "success", executedAt: new Date() },
      });
      delete context._waitStartedAt;

      const next = firstOutgoing(graph, resumeNode.id);
      if (!next) return completeRun(runId);
      currentNodeId = next.target;
    }
  }

  while (true) {
    const node = findNode(graph, currentNodeId);

    if (node.type === "action") {
      const { success, result } = await executeAction(node.data as ActionNodeData, client, run.id);
      await prisma.journeyRunStep.create({
        data: {
          runId,
          nodeId: node.id,
          nodeType: "action",
          status: success ? "success" : "failed",
          result: result ? (result as object) : undefined,
          executedAt: new Date(),
        },
      });
      if (!success) return failRun(runId, node.id, "Action failed");

      const next = firstOutgoing(graph, node.id);
      if (!next) return completeRun(runId);
      currentNodeId = next.target;
      continue;
    }

    if (node.type === "condition") {
      const passed = evaluateCondition(node.data as ConditionNodeData, client, context);
      await prisma.journeyRunStep.create({
        data: {
          runId,
          nodeId: node.id,
          nodeType: "condition",
          status: "success",
          result: { passed },
          executedAt: new Date(),
        },
      });
      const edge = graph.edges.find(
        (e) => e.source === node.id && e.sourceHandle === (passed ? "true" : "false"),
      );
      if (!edge) return failRun(runId, node.id, `No ${passed ? "true" : "false"} branch connected`);
      currentNodeId = edge.target;
      continue;
    }

    if (node.type === "wait") {
      const now = new Date();
      const data = node.data as WaitNodeData;
      const scheduledFor = computeScheduledFor(data, now);

      await prisma.journeyRunStep.create({
        data: { runId, nodeId: node.id, nodeType: "wait", status: "pending", scheduledFor },
      });
      await prisma.journeyRun.update({
        where: { id: runId },
        data: {
          currentNodeId: node.id,
          status: "WAITING",
          context: { ...context, _waitStartedAt: now.toISOString() },
        },
      });
      return;
    }

    // trigger node reached mid-graph (shouldn't normally happen) — just pass through
    const next = firstOutgoing(graph, node.id);
    if (!next) return completeRun(runId);
    currentNodeId = next.target;
  }
}
