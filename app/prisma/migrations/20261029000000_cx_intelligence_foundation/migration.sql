-- CreateEnum
CREATE TYPE "CxSourceType" AS ENUM ('HELPDESK', 'SURVEY', 'REVIEW', 'CALL', 'BOT');

-- CreateEnum
CREATE TYPE "CxAnalysisStatus" AS ENUM ('PENDING', 'QUEUED', 'DONE', 'FAILED', 'SKIPPED_QUOTA');

-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'MERGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TeamKind" AS ENUM ('OWNER', 'SUPPORT', 'BPO');

-- AlterEnum
ALTER TYPE "Product" ADD VALUE 'CX_INTELLIGENCE';

-- AlterTable
ALTER TABLE "ProductSubscription" ADD COLUMN     "analysesUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "analysisQuota" INTEGER,
ADD COLUMN     "overageAnalysesThisPeriod" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CxSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "CxSourceType" NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "encryptedCredentials" TEXT,
    "webhookToken" TEXT NOT NULL,
    "cursor" TEXT,
    "backfillFrom" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CxSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceType" "CxSourceType" NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "channel" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "firstReplyAt" TIMESTAMP(3),
    "solvedAt" TIMESTAMP(3),
    "handleTimeSec" INTEGER,
    "replyCount" INTEGER,
    "reopenCount" INTEGER,
    "customerKey" TEXT,
    "clientId" TEXT,
    "agentEmail" TEXT,
    "agentName" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "teamId" TEXT,
    "subject" TEXT,
    "turns" JSONB NOT NULL,
    "textHash" TEXT NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "redactionVersion" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION,
    "ratingScale" TEXT,
    "tags" TEXT[],
    "language" TEXT,
    "metadata" JSONB,
    "analysisStatus" "CxAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationAnalysis" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "taxonomyVersionId" TEXT,
    "summary" TEXT,
    "rootCause" TEXT,
    "sentiment" DOUBLE PRECISION,
    "sentimentStart" DOUBLE PRECISION,
    "sentimentEnd" DOUBLE PRECISION,
    "churnRisk" DOUBLE PRECISION,
    "escalationRisk" DOUBLE PRECISION,
    "predictedCsat" DOUBLE PRECISION,
    "customerEffort" DOUBLE PRECISION,
    "deflectable" BOOLEAN NOT NULL DEFAULT false,
    "deflectableReason" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "qualityFlags" TEXT[],
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "status" "TopicStatus" NOT NULL DEFAULT 'ACTIVE',
    "mergedIntoId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'discovered',
    "ownerTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTopic" (
    "conversationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "evidence" TEXT,

    CONSTRAINT "ConversationTopic_pkey" PRIMARY KEY ("conversationId","topicId")
);

-- CreateTable
CREATE TABLE "TaxonomyVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxonomyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TeamKind" NOT NULL,
    "benchmarkTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTeamMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTeamMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CxCostSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "costPerContact" JSONB NOT NULL DEFAULT '{}',
    "agentHourlyCost" DOUBLE PRECISION,
    "averageOrderValue" DOUBLE PRECISION,
    "customerLifetimeVal" DOUBLE PRECISION,
    "churnPropensity" DOUBLE PRECISION,
    "deflectionRate" DOUBLE PRECISION,
    "retentionMonths" INTEGER NOT NULL DEFAULT 13,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CxCostSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CxSource_webhookToken_key" ON "CxSource"("webhookToken");

-- CreateIndex
CREATE UNIQUE INDEX "CxSource_organizationId_provider_key" ON "CxSource"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_startedAt_idx" ON "Conversation"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_analysisStatus_idx" ON "Conversation"("organizationId", "analysisStatus");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_customerKey_idx" ON "Conversation"("organizationId", "customerKey");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_organizationId_provider_externalId_key" ON "Conversation"("organizationId", "provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAnalysis_conversationId_key" ON "ConversationAnalysis"("conversationId");

-- CreateIndex
CREATE INDEX "Topic_organizationId_status_idx" ON "Topic"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_organizationId_key_key" ON "Topic"("organizationId", "key");

-- CreateIndex
CREATE INDEX "ConversationTopic_organizationId_topicId_startedAt_idx" ON "ConversationTopic"("organizationId", "topicId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyVersion_organizationId_version_key" ON "TaxonomyVersion"("organizationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_name_key" ON "Team"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTeamMapping_organizationId_matchType_value_key" ON "AgentTeamMapping"("organizationId", "matchType", "value");

-- CreateIndex
CREATE UNIQUE INDEX "CxCostSettings_organizationId_key" ON "CxCostSettings"("organizationId");

-- AddForeignKey
ALTER TABLE "CxSource" ADD CONSTRAINT "CxSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CxSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAnalysis" ADD CONSTRAINT "ConversationAnalysis_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTopic" ADD CONSTRAINT "ConversationTopic_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTopic" ADD CONSTRAINT "ConversationTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyVersion" ADD CONSTRAINT "TaxonomyVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_benchmarkTeamId_fkey" FOREIGN KEY ("benchmarkTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTeamMapping" ADD CONSTRAINT "AgentTeamMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTeamMapping" ADD CONSTRAINT "AgentTeamMapping_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CxCostSettings" ADD CONSTRAINT "CxCostSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

