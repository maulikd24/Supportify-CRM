import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey, requireApiProductAccess, unauthorized } from "@/lib/api/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return unauthorized();
  const gate = await requireApiProductAccess(auth.organizationId, "QA_SENTINEL");
  if (gate) return gate;

  const { id } = await params;
  const review = await prisma.ticketReview.findUnique({ where: { id, organizationId: auth.organizationId } });
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  return NextResponse.json({
    data: {
      id: review.id,
      ticketId: review.ticketId,
      ticketSubject: review.ticketSubject,
      agentName: review.agentName,
      agentEmail: review.agentEmail,
      overallScore: review.overallScore,
      sentiment: review.sentiment,
      summary: review.summary,
      strengths: review.strengths,
      improvements: review.improvements,
      sopViolations: review.sopViolations,
      createdAt: review.createdAt.toISOString(),
    },
  });
}
