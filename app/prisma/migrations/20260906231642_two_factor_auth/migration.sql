-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorRecoveryCodes" JSONB,
ADD COLUMN     "twoFactorSecret" TEXT;

