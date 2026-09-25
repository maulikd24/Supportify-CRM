import type { WaitNodeData } from "@/lib/journeys/types";

/** Computes when the poller should next check this wait node. */
export function computeScheduledFor(data: WaitNodeData, waitStartedAt: Date): Date {
  const minutes = data.durationMinutes ?? (data.waitType === "wait_until_condition" ? 15 : 60);
  return new Date(waitStartedAt.getTime() + minutes * 60 * 1000);
}

/** For wait_until_condition, whether the timeout has elapsed and the run should proceed regardless. */
export function hasTimedOut(data: WaitNodeData, waitStartedAt: Date, now: Date): boolean {
  if (data.waitType !== "wait_until_condition" || !data.timeoutMinutes) return false;
  return now.getTime() - waitStartedAt.getTime() >= data.timeoutMinutes * 60 * 1000;
}
