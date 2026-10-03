-- CreateEnum
CREATE TYPE "CoachingStatus" AS ENUM ('ASSIGNED', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UPHELD', 'ADJUSTED');

-- CreateTable
CREATE TABLE "CoachingSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentEmail" TEXT NOT NULL,
    "agentName" TEXT,
    "reviewId" TEXT,
    "coachId" TEXT NOT NULL,
    "focusAreas" JSONB,
    "notes" TEXT NOT NULL,
    "agentResponse" TEXT,
    "outcome" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "CoachingStatus" NOT NULL DEFAULT 'ASSIGNED',
    "acknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDispute" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "criterionKey" TEXT,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "originalScore" INTEGER,
    "adjustedScore" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachingSession_organizationId_status_idx" ON "CoachingSession"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CoachingSession_organizationId_agentEmail_idx" ON "CoachingSession"("organizationId", "agentEmail");

-- CreateIndex
CREATE INDEX "ReviewDispute_organizationId_status_idx" ON "ReviewDispute"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ReviewDispute_reviewId_idx" ON "ReviewDispute"("reviewId");

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "TicketReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDispute" ADD CONSTRAINT "ReviewDispute_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDispute" ADD CONSTRAINT "ReviewDispute_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "TicketReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDispute" ADD CONSTRAINT "ReviewDispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDispute" ADD CONSTRAINT "ReviewDispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

