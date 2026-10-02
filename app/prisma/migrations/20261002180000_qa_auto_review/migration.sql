-- QA auto-review + usage-based overages
CREATE TYPE "AutoReviewJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'SKIPPED', 'FAILED');

ALTER TABLE "ProductSubscription"
  ADD COLUMN "allowOverage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "overageCap" INTEGER,
  ADD COLUMN "overageReviewsThisPeriod" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "TicketReview"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "isOverage" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AutoReviewConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sopId" TEXT,
    "samplePercent" INTEGER NOT NULL DEFAULT 20,
    "alwaysReviewBadCsat" BOOLEAN NOT NULL DEFAULT true,
    "includeTags" TEXT[],
    "excludeTags" TEXT[],
    "lastPolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutoReviewConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutoReviewJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AutoReviewJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "reviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "AutoReviewJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutoReviewConfig_organizationId_key" ON "AutoReviewConfig"("organizationId");
CREATE UNIQUE INDEX "AutoReviewJob_organizationId_ticketId_key" ON "AutoReviewJob"("organizationId", "ticketId");
CREATE INDEX "AutoReviewJob_status_createdAt_idx" ON "AutoReviewJob"("status", "createdAt");

ALTER TABLE "AutoReviewConfig" ADD CONSTRAINT "AutoReviewConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutoReviewJob" ADD CONSTRAINT "AutoReviewJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
