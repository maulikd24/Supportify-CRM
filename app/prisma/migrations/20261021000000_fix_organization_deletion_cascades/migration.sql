-- Deleting an Organization failed for any org with CRM history: several
-- relations were RESTRICT, which Postgres checks row-by-row in the middle of
-- the org cascade, and StageHistory / JourneyRunStep / CalibrationEntry have no
-- organizationId of their own for the cascade to reach.
--
-- * Rows that cascade with their org: RESTRICT -> NO ACTION, DEFERRABLE
--   INITIALLY DEFERRED. A deferred check runs at COMMIT, after every cascade
--   path from the org has finished (a plain NO ACTION check can still fire
--   between two internal cascade statements). Deleting a single client or user
--   that still has history stays blocked, exactly as before — it just fails at
--   commit instead of immediately.
-- * StageHistory -> Client and JourneyRunStep -> JourneyRun: CASCADE, since the
--   parent is these rows' only path to deletion.
-- * AuditLog -> User: realigns the database with schema.prisma (ON DELETE SET
--   NULL), which had drifted from the migration history.


-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ApiKey" DROP CONSTRAINT "ApiKey_createdById_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "CalibrationEntry" DROP CONSTRAINT "CalibrationEntry_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "CalibrationSession" DROP CONSTRAINT "CalibrationSession_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_currentStageId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Exception" DROP CONSTRAINT "Exception_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Exception" DROP CONSTRAINT "Exception_stageId_fkey";

-- DropForeignKey
ALTER TABLE "Journey" DROP CONSTRAINT "Journey_createdById_fkey";

-- DropForeignKey
ALTER TABLE "JourneyRun" DROP CONSTRAINT "JourneyRun_clientId_fkey";

-- DropForeignKey
ALTER TABLE "JourneyRun" DROP CONSTRAINT "JourneyRun_journeyId_fkey";

-- DropForeignKey
ALTER TABLE "JourneyRunStep" DROP CONSTRAINT "JourneyRunStep_runId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "StageHistory" DROP CONSTRAINT "StageHistory_changedById_fkey";

-- DropForeignKey
ALTER TABLE "StageHistory" DROP CONSTRAINT "StageHistory_clientId_fkey";

-- DropForeignKey
ALTER TABLE "StageHistory" DROP CONSTRAINT "StageHistory_toStageId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_clientId_fkey";

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_currentStageId_fkey" FOREIGN KEY ("currentStageId") REFERENCES "Stage"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "Stage"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyRun" ADD CONSTRAINT "JourneyRun_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyRun" ADD CONSTRAINT "JourneyRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyRunStep" ADD CONSTRAINT "JourneyRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "JourneyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationSession" ADD CONSTRAINT "CalibrationSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationEntry" ADD CONSTRAINT "CalibrationEntry_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Prisma's schema language can't express DEFERRABLE (and ignores it when
-- diffing), so it lives only here. If a later migration drops and re-adds any
-- of these foreign keys, re-apply DEFERRABLE INITIALLY DEFERRED to it —
-- tests/security/delete-organization.test.ts fails if this is lost.
ALTER TABLE "ApiKey" ALTER CONSTRAINT "ApiKey_createdById_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Client" ALTER CONSTRAINT "Client_currentStageId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StageHistory" ALTER CONSTRAINT "StageHistory_toStageId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StageHistory" ALTER CONSTRAINT "StageHistory_changedById_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Document" ALTER CONSTRAINT "Document_clientId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Exception" ALTER CONSTRAINT "Exception_clientId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Exception" ALTER CONSTRAINT "Exception_stageId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Task" ALTER CONSTRAINT "Task_clientId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Task" ALTER CONSTRAINT "Task_assignedToId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Activity" ALTER CONSTRAINT "Activity_clientId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Journey" ALTER CONSTRAINT "Journey_createdById_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "JourneyRun" ALTER CONSTRAINT "JourneyRun_journeyId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "JourneyRun" ALTER CONSTRAINT "JourneyRun_clientId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Message" ALTER CONSTRAINT "Message_clientId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Notification" ALTER CONSTRAINT "Notification_userId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CalibrationSession" ALTER CONSTRAINT "CalibrationSession_createdById_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CalibrationEntry" ALTER CONSTRAINT "CalibrationEntry_reviewerId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CoachingSession" ALTER CONSTRAINT "CoachingSession_coachId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ReviewDispute" ALTER CONSTRAINT "ReviewDispute_raisedById_fkey" DEFERRABLE INITIALLY DEFERRED;
