-- CreateIndex
CREATE INDEX "Client_assignedToId_status_idx" ON "Client"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "Client_assignedToId_currentStageId_idx" ON "Client"("assignedToId", "currentStageId");

-- CreateIndex
CREATE INDEX "Client_currentStageId_createdAt_idx" ON "Client"("currentStageId", "createdAt");

-- CreateIndex
CREATE INDEX "Client_status_createdAt_idx" ON "Client"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Client_assignedToId_createdAt_idx" ON "Client"("assignedToId", "createdAt");
