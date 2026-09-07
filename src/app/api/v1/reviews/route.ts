import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey, requireApiProductAccess, unauthorized } from "@/lib/api/auth";

const MAX_PAGE_SIZE = 100;

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return unauthorized();
  const gate = await requireApiProductAccess(auth.organizationId, "QA_SENTINEL");
  if (gate) return gate;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 25, MAX_PAGE_SIZE);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const agentEmail = url.searchParams.get("agent") ?? undefined;

  const reviews = await prisma.ticketReview.findMany({
    where: { organizationId: auth.organizationId, ...(agentEmail ? { agentEmail } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = reviews.length > limit;
  const page = reviews.slice(0, limit);

  return NextResponse.json({
    data: page.map(serializeReview),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

function serializeReview(review: {
  id: string;
  ticketId: string;
  ticketSubject: string | null;
  agentName: string | null;
  agentEmail: string | null;
  overallScore: number | null;
  sentiment: string | null;
  summary: string | null;
  createdAt: Date;
}) {
  return {
    id: review.id,
    ticketId: review.ticketId,
    ticketSubject: review.ticketSubject,
    agentName: review.agentName,
    agentEmail: review.agentEmail,
    overallScore: review.overallScore,
    sentiment: review.sentiment,
    summary: review.summary,
    createdAt: review.createdAt.toISOString(),
  };
}
