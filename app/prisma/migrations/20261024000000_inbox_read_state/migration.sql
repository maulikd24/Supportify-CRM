-- WhatsApp/SMS Inbox: unread state for inbound messages.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "readAt" TIMESTAMP(3);

-- Start the Inbox clean: inbound messages older than 7 days count as read, so the
-- first view isn't buried under old history. Recent replies stay unread.
UPDATE "Message"
SET "readAt" = "createdAt"
WHERE "direction" = 'INBOUND' AND "createdAt" < (now() AT TIME ZONE 'UTC') - interval '7 days';

-- CreateIndex
CREATE INDEX "Message_organizationId_direction_readAt_idx" ON "Message"("organizationId", "direction", "readAt");
