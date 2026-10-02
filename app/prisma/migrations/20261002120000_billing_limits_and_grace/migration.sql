-- Grace period: remember when a subscription first went past due.
ALTER TABLE "ProductSubscription" ADD COLUMN "pastDueSince" TIMESTAMP(3);

-- Backfill limits that were never written (NULL meant "unlimited").
-- Self-serve paid plans get their plan's limits; enterprise/admin-set rows are untouched.
UPDATE "ProductSubscription" SET "reviewQuota" = 100
  WHERE "product" = 'QA_SENTINEL' AND "planId" = 'starter' AND "reviewQuota" IS NULL;
UPDATE "ProductSubscription" SET "reviewQuota" = 500
  WHERE "product" = 'QA_SENTINEL' AND "planId" = 'growth' AND "reviewQuota" IS NULL;
UPDATE "ProductSubscription" SET "seats" = 5
  WHERE "product" = 'CRM' AND "planId" = 'starter' AND "seats" IS NULL;
UPDATE "ProductSubscription" SET "seats" = 20
  WHERE "product" = 'CRM' AND "planId" = 'growth' AND "seats" IS NULL;

-- Trials without a plan get the trial limits (50 reviews / 3 seats).
UPDATE "ProductSubscription" SET "reviewQuota" = 50
  WHERE "product" = 'QA_SENTINEL' AND "status" = 'TRIALING' AND "planId" IS NULL AND "reviewQuota" IS NULL;
UPDATE "ProductSubscription" SET "seats" = 3
  WHERE "product" = 'CRM' AND "status" = 'TRIALING' AND "planId" IS NULL AND "seats" IS NULL;

-- Rows already PAST_DUE start their grace period now.
UPDATE "ProductSubscription" SET "pastDueSince" = CURRENT_TIMESTAMP
  WHERE "status" = 'PAST_DUE' AND "pastDueSince" IS NULL;
