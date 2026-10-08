import { prisma } from "@/lib/db/prisma";
import { getProductAccess } from "@/lib/billing/access";
import { routeAlerts } from "@/lib/alerts/route";
import { LOW_SCORE } from "@/lib/qa/score";

/**
 * A client's support experience from QA Sentinel: their recent reviewed tickets, any DSAT
 * analysis and open score disputes, summarised as a health signal. Only for orgs on both
 * products (callers also check the user may see the client).
 */

const RECENT_REVIEWS = 3;
const WINDOW_DAYS = 90;

export type SupportHealthStatus = "healthy" | "at_risk" | "no_data";

/** Average of the most recent reviewed tickets (up to 3, last 90 days); below LOW_SCORE is at risk. */
export function supportStatus(scores: number[]): { status: SupportHealthStatus; averageScore: number | null } {
  if (scores.length === 0) return { status: "no_data", averageScore: null };
  const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { status: averageScore < LOW_SCORE ? "at_risk" : "healthy", averageScore };
}

export async function supportHealthAvailable(organizationId: string): Promise<boolean> {
  const [crm, qa] = await Promise.all([getProductAccess(organizationId, "CRM"), getProductAccess(organizationId, "QA_SENTINEL")]);
  return crm.allowed && qa.allowed;
}

export type SupportHealth = {
  status: SupportHealthStatus;
  averageScore: number | null;
  reviews: { id: string; ticketId: string; subject: string | null; score: number | null; autoFailed: boolean; openDispute: boolean; createdAt: Date }[];
  dsat: { whatWentWrong: string | null; recoveryProbability: string | null; createdAt: Date } | null;
  requesters: { email: string | null; phone: string | null; linkedBy: string | null }[];
};

export async function getSupportHealth(organizationId: string, clientId: string, now = new Date()): Promise<SupportHealth> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [recent, requesters] = await Promise.all([
    prisma.ticketReview.findMany({
      where: { organizationId, clientId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: RECENT_REVIEWS,
      select: {
        id: true,
        ticketId: true,
        ticketSubject: true,
        overallScore: true,
        autoFailed: true,
        createdAt: true,
        disputes: { where: { status: "OPEN" }, select: { id: true }, take: 1 },
      },
    }),
    prisma.ticketReview.findMany({
      where: { organizationId, clientId },
      distinct: ["requesterEmail", "requesterPhone"],
      select: { requesterEmail: true, requesterPhone: true, clientLinkedBy: true },
      take: 10,
    }),
  ]);

  // DSAT analyses are stored per ticket; take the latest one on this client's linked tickets.
  const linkedTickets = await prisma.ticketReview.findMany({
    where: { organizationId, clientId, createdAt: { gte: since } },
    select: { ticketId: true },
    take: 200,
  });
  const dsat = linkedTickets.length
    ? await prisma.dsatAnalysis.findFirst({
        where: { organizationId, ticketId: { in: linkedTickets.map((t) => t.ticketId) }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { whatWentWrong: true, recoveryProbability: true, createdAt: true },
      })
    : null;

  const { status, averageScore } = supportStatus(recent.flatMap((r) => (r.overallScore == null ? [] : [r.overallScore])));
  return {
    status,
    averageScore,
    reviews: recent.map((r) => ({
      id: r.id,
      ticketId: r.ticketId,
      subject: r.ticketSubject,
      score: r.overallScore,
      autoFailed: r.autoFailed,
      openDispute: r.disputes.length > 0,
      createdAt: r.createdAt,
    })),
    dsat,
    requesters: requesters
      .filter((r) => r.requesterEmail || r.requesterPhone)
      .map((r) => ({ email: r.requesterEmail, phone: r.requesterPhone, linkedBy: r.clientLinkedBy })),
  };
}

/**
 * After a client's linked reviews change: if a high-priority client's support quality has
 * dropped below target, tell their RM's manager (or the admins) and team channels, once per
 * drop. The claim is a conditional update, so concurrent reviews alert once; recovering
 * clears it, which re-arms the alert for the next drop. Never throws.
 */
export async function evaluateSupportRisk(organizationId: string, clientId: string): Promise<void> {
  try {
    if (!(await supportHealthAvailable(organizationId))) return;
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: {
        id: true,
        name: true,
        priority: true,
        supportRiskNotifiedAt: true,
        currentStage: { select: { name: true } },
        assignedTo: { select: { name: true, managerId: true } },
      },
    });
    if (!client) return;
    const { status, averageScore } = await getSupportHealth(organizationId, clientId);

    if (status !== "at_risk") {
      if (client.supportRiskNotifiedAt) {
        await prisma.client.updateMany({ where: { id: clientId, supportRiskNotifiedAt: { not: null } }, data: { supportRiskNotifiedAt: null } });
      }
      return;
    }
    if (client.priority !== "HIGH" || averageScore == null) return;

    const { count } = await prisma.client.updateMany({
      where: { id: clientId, supportRiskNotifiedAt: null },
      data: { supportRiskNotifiedAt: new Date() },
    });
    if (count === 0) return;

    const recipients = client.assignedTo?.managerId
      ? [client.assignedTo.managerId]
      : (
          await prisma.user.findMany({
            where: { organizationId, role: "ADMIN", isActive: true, orgRole: { not: "AGENT" } },
            select: { id: true },
          })
        ).map((u) => u.id);
    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        organizationId,
        userId,
        type: "client_support_risk",
        payload: { clientId, clientName: client.name, averageScore: Math.round(averageScore), assignedToName: client.assignedTo?.name ?? null },
      })),
    });
    await routeAlerts([
      {
        organizationId,
        type: "client_support_risk",
        clientId,
        clientName: client.name,
        stage: client.currentStage.name,
        averageScore,
        assignedToName: client.assignedTo?.name ?? null,
      },
    ]);
  } catch (error) {
    console.error("Support risk check failed", { organizationId, clientId, error });
  }
}
