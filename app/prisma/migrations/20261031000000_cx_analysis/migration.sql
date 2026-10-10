-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "classifyBatchId" TEXT;

-- AlterTable
ALTER TABLE "ConversationAnalysis" ADD COLUMN     "proposedTopic" TEXT;

-- AlterTable
ALTER TABLE "TaxonomyVersion" ADD COLUMN     "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "CxClassifyBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "anthropicBatchId" TEXT NOT NULL,
    "taxonomyVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "requestCount" INTEGER NOT NULL,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedAt" TIMESTAMP(3),

    CONSTRAINT "CxClassifyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CxMetricBucket" (
    "organizationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL DEFAULT '',
    "conversations" INTEGER NOT NULL,
    "sentimentSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sentimentCount" INTEGER NOT NULL DEFAULT 0,
    "negativeCount" INTEGER NOT NULL DEFAULT 0,
    "ratingSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "predictedCsatSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "predictedCsatCount" INTEGER NOT NULL DEFAULT 0,
    "highRiskCount" INTEGER NOT NULL DEFAULT 0,
    "deflectableCount" INTEGER NOT NULL DEFAULT 0,
    "handleTimeSum" INTEGER NOT NULL DEFAULT 0,
    "handleTimeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CxMetricBucket_pkey" PRIMARY KEY ("organizationId","day","dimension","dimensionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CxClassifyBatch_anthropicBatchId_key" ON "CxClassifyBatch"("anthropicBatchId");

-- CreateIndex
CREATE INDEX "CxClassifyBatch_status_createdAt_idx" ON "CxClassifyBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_classifyBatchId_idx" ON "Conversation"("classifyBatchId");

-- AddForeignKey
ALTER TABLE "CxClassifyBatch" ADD CONSTRAINT "CxClassifyBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CxMetricBucket" ADD CONSTRAINT "CxMetricBucket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

