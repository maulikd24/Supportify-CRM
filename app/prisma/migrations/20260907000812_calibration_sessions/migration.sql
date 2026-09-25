-- CreateEnum
CREATE TYPE "CalibrationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "CalibrationSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "CalibrationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CalibrationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "overallScore" INTEGER,
    "criteriaScores" JSONB,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalibrationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalibrationSession_organizationId_createdAt_idx" ON "CalibrationSession"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalibrationEntry_sessionId_reviewerId_key" ON "CalibrationEntry"("sessionId", "reviewerId");

-- AddForeignKey
ALTER TABLE "CalibrationSession" ADD CONSTRAINT "CalibrationSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationSession" ADD CONSTRAINT "CalibrationSession_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "TicketReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationSession" ADD CONSTRAINT "CalibrationSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationEntry" ADD CONSTRAINT "CalibrationEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CalibrationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationEntry" ADD CONSTRAINT "CalibrationEntry_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

