-- CreateEnum
CREATE TYPE "Product" AS ENUM ('QA_SENTINEL', 'CRM');

-- CreateEnum
CREATE TYPE "VerificationTokenPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- DropIndex
DROP INDEX "Organization_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "planId",
DROP COLUMN "stripeSubscriptionId",
DROP COLUMN "subscriptionStatus",
DROP COLUMN "trialEndsAt";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProductSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "product" "Product" NOT NULL,
    "planId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "seats" INTEGER,
    "reviewQuota" INTEGER,
    "reviewsUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "VerificationTokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductSubscription_stripeSubscriptionId_key" ON "ProductSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSubscription_organizationId_product_key" ON "ProductSubscription"("organizationId", "product");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_purpose_idx" ON "VerificationToken"("userId", "purpose");

-- AddForeignKey
ALTER TABLE "ProductSubscription" ADD CONSTRAINT "ProductSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

