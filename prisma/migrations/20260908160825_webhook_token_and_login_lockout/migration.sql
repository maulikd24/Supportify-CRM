-- AlterTable
ALTER TABLE "IntegrationConfig" ADD COLUMN     "webhookToken" TEXT;
UPDATE "IntegrationConfig" SET "webhookToken" = md5(random()::text || clock_timestamp()::text) WHERE "webhookToken" IS NULL;
ALTER TABLE "IntegrationConfig" ALTER COLUMN "webhookToken" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_webhookToken_key" ON "IntegrationConfig"("webhookToken");
