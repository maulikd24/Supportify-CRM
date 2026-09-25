-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- DropForeignKey
ALTER TABLE "DealerIntroduction" DROP CONSTRAINT "DealerIntroduction_clientId_fkey";

-- DropForeignKey
ALTER TABLE "DealerIntroduction" DROP CONSTRAINT "DealerIntroduction_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "FundingRecord" DROP CONSTRAINT "FundingRecord_clientId_fkey";

-- DropForeignKey
ALTER TABLE "FundingRecord" DROP CONSTRAINT "FundingRecord_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "KycRecord" DROP CONSTRAINT "KycRecord_clientId_fkey";

-- DropForeignKey
ALTER TABLE "KycRecord" DROP CONSTRAINT "KycRecord_organizationId_fkey";

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "existingBroker",
DROP COLUMN "expectedInvestment",
DROP COLUMN "productInterest",
DROP COLUMN "tradingExperience",
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "dealValue" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Stage" ADD COLUMN     "isTerminal" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "DealerIntroduction";

-- DropTable
DROP TABLE "FundingRecord";

-- DropTable
DROP TABLE "KycRecord";

-- DropEnum
DROP TYPE "DealerIntroStatus";

-- DropEnum
DROP TYPE "FundingStatus";

-- DropEnum
DROP TYPE "KycStatus";

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_organizationId_sortOrder_idx" ON "CustomFieldDefinition"("organizationId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_organizationId_key_key" ON "CustomFieldDefinition"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

