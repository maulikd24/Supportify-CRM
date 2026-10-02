ALTER TABLE "ProductSubscription"
  ADD COLUMN "billingInterval" TEXT,
  ADD COLUMN "usagePeriodStart" TIMESTAMP(3);

-- Existing paid subscriptions are monthly.
UPDATE "ProductSubscription" SET "billingInterval" = 'month'
  WHERE "stripeSubscriptionId" IS NOT NULL AND "billingInterval" IS NULL;
