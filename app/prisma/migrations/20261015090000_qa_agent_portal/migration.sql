-- AlterEnum
ALTER TYPE "OrgRole" ADD VALUE 'AGENT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "helpdeskEmail" TEXT;

