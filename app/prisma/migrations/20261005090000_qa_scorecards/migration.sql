CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "criteria" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Scorecard_organizationId_idx" ON "Scorecard"("organizationId");
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketReview"
  ADD COLUMN "scorecardId" TEXT,
  ADD COLUMN "scorecardSnapshot" JSONB,
  ADD COLUMN "autoFailed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoFailReasons" JSONB;

ALTER TABLE "AutoReviewConfig" ADD COLUMN "scorecardId" TEXT;
