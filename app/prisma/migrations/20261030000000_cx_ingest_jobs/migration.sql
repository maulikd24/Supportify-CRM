-- CreateEnum
CREATE TYPE "CxIngestJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "CxIngestJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "CxIngestJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "listedUpdatedAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "CxIngestJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CxIngestJob_status_createdAt_idx" ON "CxIngestJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CxIngestJob_organizationId_status_idx" ON "CxIngestJob"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CxIngestJob_sourceId_externalId_key" ON "CxIngestJob"("sourceId", "externalId");

-- AddForeignKey
ALTER TABLE "CxIngestJob" ADD CONSTRAINT "CxIngestJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CxSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

