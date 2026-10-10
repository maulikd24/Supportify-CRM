-- CreateEnum
CREATE TYPE "TopicIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "TopicIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "status" "TopicIssueStatus" NOT NULL DEFAULT 'OPEN',
    "ownerTeamId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TopicIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TopicIssue_organizationId_status_idx" ON "TopicIssue"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TopicIssue_topicId_idx" ON "TopicIssue"("topicId");

-- AddForeignKey
ALTER TABLE "TopicIssue" ADD CONSTRAINT "TopicIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicIssue" ADD CONSTRAINT "TopicIssue_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicIssue" ADD CONSTRAINT "TopicIssue_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

