-- Collapse the 8-stage onboarding pipeline to 5 stages.
-- Retire-then-reuse ordering keeps every intermediate "sequence" value unique
-- (Stage.sequence has a UNIQUE constraint) without needing a temporary offset block.
-- Old stage rows are never deleted (isActive = false instead) so StageHistory/AuditLog
-- and any other historical references keep working; the 5 surviving stages keep their
-- original ids so Client.currentStageId needs no remapping for clients already on them.

-- 1. Retire "RM Reaches Out" -- frees sequence 2 for reuse below.
UPDATE "Stage" SET "isActive" = false, sequence = 101 WHERE name = 'RM Reaches Out';

-- 2. Rename survivors in place.
UPDATE "Stage" SET name = 'New Lead' WHERE name = 'Lead Created';
UPDATE "Stage" SET name = 'Submitted for KYC', sequence = 2 WHERE name = 'Documents Submitted for KYC';

-- 3. Retire "Documents Collected" -- frees sequence 3.
UPDATE "Stage" SET "isActive" = false, sequence = 102 WHERE name = 'Documents Collected';

UPDATE "Stage" SET name = 'KYC completed', sequence = 3 WHERE name = 'KYC Completed';
UPDATE "Stage" SET name = 'Pushed for funds', sequence = 4 WHERE name = 'Funds Added';
UPDATE "Stage" SET name = 'Introduction with Dealer', sequence = 5, "slaHours" = 48 WHERE name = 'Introduced with Dealer';

-- 4. Retire "Completed" last.
UPDATE "Stage" SET "isActive" = false, sequence = 103 WHERE name = 'Completed';

-- 5. Remap clients off the two folded-into-"New Lead" stages, resetting their SLA clock
--    so they don't instantly show as overdue under New Lead's 4-hour SLA.
UPDATE "Client" SET
  "currentStageId" = (SELECT id FROM "Stage" WHERE name = 'New Lead'),
  "stageEnteredAt" = now()
WHERE "currentStageId" IN (
  SELECT id FROM "Stage" WHERE name IN ('RM Reaches Out', 'Documents Collected')
);

-- 6. Remap clients off the retired terminal stage onto the new terminal stage, and
--    defensively (re)assert completion status/timestamp.
UPDATE "Client" SET
  "currentStageId" = (SELECT id FROM "Stage" WHERE name = 'Introduction with Dealer'),
  "stageEnteredAt" = now(),
  status = 'COMPLETED',
  "completedAt" = COALESCE("completedAt", now())
WHERE "currentStageId" = (SELECT id FROM "Stage" WHERE name = 'Completed');
