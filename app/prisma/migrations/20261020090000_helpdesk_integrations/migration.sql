-- Generalise the Zendesk-only connection into one connection per org for any helpdesk.
-- Existing Zendesk connections keep working: their encrypted JSON already matches the
-- Zendesk adapter's credentials ({ subdomain, email, apiToken }).
ALTER TABLE "ZendeskConnection" RENAME TO "HelpdeskConnection";
ALTER TABLE "HelpdeskConnection" RENAME CONSTRAINT "ZendeskConnection_pkey" TO "HelpdeskConnection_pkey";
ALTER TABLE "HelpdeskConnection" RENAME CONSTRAINT "ZendeskConnection_organizationId_fkey" TO "HelpdeskConnection_organizationId_fkey";
ALTER INDEX "ZendeskConnection_organizationId_key" RENAME TO "HelpdeskConnection_organizationId_key";

ALTER TABLE "HelpdeskConnection" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'zendesk';
ALTER TABLE "HelpdeskConnection" ADD COLUMN "accountLabel" TEXT;
UPDATE "HelpdeskConnection" SET "accountLabel" = "subdomain" || '.zendesk.com';
ALTER TABLE "HelpdeskConnection" ALTER COLUMN "accountLabel" SET NOT NULL;
ALTER TABLE "HelpdeskConnection" RENAME COLUMN "encryptedToken" TO "encryptedCredentials";
ALTER TABLE "HelpdeskConnection" DROP COLUMN "subdomain";
ALTER TABLE "HelpdeskConnection" DROP COLUMN "email";

-- Ticket ids are only unique within one helpdesk.
ALTER TABLE "TicketReview" ADD COLUMN "helpdesk" TEXT NOT NULL DEFAULT 'zendesk';
ALTER TABLE "AutoReviewJob" ADD COLUMN "helpdesk" TEXT NOT NULL DEFAULT 'zendesk';
DROP INDEX "AutoReviewJob_organizationId_ticketId_key";
CREATE UNIQUE INDEX "AutoReviewJob_organizationId_helpdesk_ticketId_key" ON "AutoReviewJob"("organizationId", "helpdesk", "ticketId");
