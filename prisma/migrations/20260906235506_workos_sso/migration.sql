-- AlterEnum
ALTER TYPE "VerificationTokenPurpose" ADD VALUE 'SSO_LOGIN';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "ssoDomain" TEXT,
ADD COLUMN     "workosOrganizationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_workosOrganizationId_key" ON "Organization"("workosOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_ssoDomain_key" ON "Organization"("ssoDomain");

