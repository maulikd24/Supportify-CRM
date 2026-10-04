-- Client codes become per-organization: a per-org counter replaces the global
-- "read the last code and add 1" sequence, which collided under concurrent
-- creates and let every tenant infer the platform-wide client count.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "clientCodeSeq" INTEGER NOT NULL DEFAULT 0;

-- Continue each org from its own highest existing CL-<n> code, so no existing code repeats.
UPDATE "Organization" o
SET "clientCodeSeq" = s.max_seq
FROM (
  SELECT "organizationId", MAX(CAST(SUBSTRING("clientCode" FROM 4) AS INTEGER)) AS max_seq
  FROM "Client"
  WHERE "clientCode" ~ '^CL-[0-9]{1,9}$'
  GROUP BY "organizationId"
) s
WHERE s."organizationId" = o.id;

-- DropIndex
DROP INDEX "Client_clientCode_key";

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_clientCode_key" ON "Client"("organizationId", "clientCode");
