-- Audit trail: optional actor + request context
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "AuditLog"
  ADD COLUMN "actorEmail" TEXT,
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT;
CREATE INDEX "AuditLog_organizationId_action_idx" ON "AuditLog"("organizationId", "action");

-- Organization security policies
ALTER TABLE "Organization"
  ADD COLUMN "require2fa" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireSso" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sessionMaxHours" INTEGER,
  ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);

-- Per-user session revocation
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
