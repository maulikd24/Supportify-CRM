-- Background jobs now claim their work atomically and remember what they have
-- already alerted about, so they can run every few minutes without duplicate
-- or repeated notifications (previously "already notified" meant "has an
-- unread notification", so reading one re-armed it for the next run).

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "disengagedNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "slaBreachNotifiedAt" TIMESTAMP(3);

-- Backfill from existing notifications, so clients already alerted are not
-- alerted again on the first run after deploy.
UPDATE "Client" c
SET "slaBreachNotifiedAt" = n.last_sent
FROM (
  SELECT payload->>'clientId' AS client_id, MAX("createdAt") AS last_sent
  FROM "Notification"
  WHERE type = 'stage_sla_breach'
  GROUP BY 1
) n
WHERE n.client_id = c.id;

UPDATE "Client" c
SET "disengagedNotifiedAt" = n.last_sent
FROM (
  SELECT payload->>'clientId' AS client_id, MAX("createdAt") AS last_sent
  FROM "Notification"
  WHERE type = 'client_disengaged'
  GROUP BY 1
) n
WHERE n.client_id = c.id;
