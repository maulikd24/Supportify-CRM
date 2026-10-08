-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "supportRiskNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TicketReview" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "clientLinkedBy" TEXT,
ADD COLUMN     "requesterEmail" TEXT,
ADD COLUMN     "requesterName" TEXT,
ADD COLUMN     "requesterPhone" TEXT;

-- CreateTable
CREATE TABLE "RequesterLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "clientId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequesterLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequesterLink_organizationId_kind_value_key" ON "RequesterLink"("organizationId", "kind", "value");

-- CreateIndex
CREATE INDEX "TicketReview_organizationId_clientId_createdAt_idx" ON "TicketReview"("organizationId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketReview_organizationId_requesterEmail_idx" ON "TicketReview"("organizationId", "requesterEmail");

-- CreateIndex
CREATE INDEX "TicketReview_organizationId_requesterPhone_idx" ON "TicketReview"("organizationId", "requesterPhone");

-- AddForeignKey
ALTER TABLE "TicketReview" ADD CONSTRAINT "TicketReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequesterLink" ADD CONSTRAINT "RequesterLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

