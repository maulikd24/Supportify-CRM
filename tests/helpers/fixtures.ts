import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { provisionOrganization } from "@/lib/auth/provision-organization";
import { encryptJson } from "@/lib/security/crypto";
import { generateApiKey } from "@/lib/security/api-keys";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import type { TestUser } from "./session";

export type Tenant = Awaited<ReturnType<typeof createTenant>>;

function toTestUser(u: {
  id: string;
  name: string;
  email: string;
  role: TestUser["role"];
  organizationId: string;
  orgRole: TestUser["orgRole"];
}): TestUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role, organizationId: u.organizationId, orgRole: u.orgRole };
}

/**
 * A fully-populated tenant: one row of every tenant-owned resource a server
 * action or API route can target by id. Isolation tests point Org A's users at
 * these ids and assert nothing about them changes.
 */
export async function createTenant(label: string) {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;

  const owner = await provisionOrganization({
    orgName: `Org ${tag}`,
    ownerName: `Owner ${tag}`,
    ownerEmail: `owner-${tag}@example.test`,
    passwordHash: "x",
    products: ["QA_SENTINEL", "CRM"],
    emailVerifiedAt: new Date(),
  });
  const organizationId = owner.organizationId;

  const rm = await prisma.user.create({
    data: { organizationId, name: `RM ${tag}`, email: `rm-${tag}@example.test`, passwordHash: "x", role: "RM" },
  });

  const stages = await prisma.stage.findMany({ where: { organizationId }, orderBy: { sequence: "asc" } });

  const client = await prisma.client.create({
    data: {
      organizationId,
      clientCode: await generateClientCode(), // same global sequence the app uses
      name: `Client ${tag}`,
      mobile: `+1555${Math.floor(Math.random() * 1e7)}`,
      email: `client-${tag}@example.test`,
      currentStageId: stages[0].id,
      assignedToId: rm.id,
    },
  });

  const [document, task, journey, template, customField, sop, notification] = await Promise.all([
    prisma.document.create({ data: { organizationId, clientId: client.id, documentType: "ID proof" } }),
    prisma.task.create({
      data: { organizationId, clientId: client.id, assignedToId: rm.id, title: "Call back", dueAt: new Date(Date.now() + 86_400_000) },
    }),
    prisma.journey.create({
      data: {
        organizationId,
        name: "Welcome",
        createdById: owner.id,
        definition: { nodes: [{ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "client_created" } }], edges: [] },
      },
    }),
    prisma.messageTemplate.create({
      data: { organizationId, channel: "whatsapp", provider: "meta_cloud", name: "hello", body: "Hi {{name}}", approved: true },
    }),
    prisma.customFieldDefinition.create({ data: { organizationId, key: "tier", label: "Tier" } }),
    prisma.sopDocument.create({ data: { organizationId, name: `SOP ${tag}`, content: "Be kind." } }),
    prisma.notification.create({ data: { organizationId, userId: owner.id, type: "new_assignment", payload: {} } }),
  ]);

  const review = await prisma.ticketReview.create({
    data: { organizationId, ticketId: "1001", overallScore: 80, primarySopId: sop.id },
  });
  const [dsat, calibration, integration, webhook, apiKey] = await Promise.all([
    prisma.dsatAnalysis.create({ data: { organizationId, ticketId: "1001" } }),
    prisma.calibrationSession.create({ data: { organizationId, reviewId: review.id, createdById: owner.id } }),
    prisma.integrationConfig.create({ data: { organizationId, provider: "freshdesk", mode: "mock", isEnabled: true } }),
    prisma.webhookEndpoint.create({
      data: { organizationId, url: "https://example.test/hook", encryptedSecret: encryptJson("whsec_x"), events: ["client.created"] },
    }),
    (async () => {
      const key = generateApiKey();
      const row = await prisma.apiKey.create({
        data: { organizationId, name: "ci", keyPrefix: key.keyPrefix, hashedKey: key.hashedKey, createdById: owner.id },
      });
      return { raw: key.raw, id: row.id };
    })(),
  ]);
  await prisma.zendeskConnection.create({
    data: {
      organizationId,
      subdomain: `zd-${tag}`,
      email: `zd-${tag}@example.test`,
      encryptedToken: encryptJson({ subdomain: `zd-${tag}`, email: `zd-${tag}@example.test`, apiToken: "t" }),
      isValid: true,
    },
  });

  return {
    organizationId,
    admin: toTestUser(owner), // orgRole OWNER + CRM role ADMIN
    rm: toTestUser(rm),
    ids: {
      client: client.id,
      stage: stages[0].id,
      laterStage: stages[1].id,
      document: document.id,
      task: task.id,
      journey: journey.id,
      template: template.id,
      customField: customField.id,
      sop: sop.id,
      review: review.id,
      dsat: dsat.id,
      calibration: calibration.id,
      notification: notification.id,
      integration: integration.id,
      integrationWebhookToken: integration.webhookToken,
      webhook: webhook.id,
      apiKey: apiKey.id,
      rmUser: rm.id,
    },
    orgName: `Org ${tag}`,
    clientName: client.name,
    clientMobile: client.mobile,
    clientEmail: client.email!,
    apiKey: apiKey.raw,
  };
}

/** Full snapshot of every row a tenant owns — compared before/after an attack to prove nothing changed. */
export async function snapshotTenant(organizationId: string) {
  const where = { organizationId };
  const [org, users, clients, documents, tasks, activities, journeys, journeyRuns, templates, messages, customFields,
    stages, sops, reviews, dsats, calibrations, notifications, integrations, webhooks, apiKeys, subscriptions, auditLogs] =
    await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId } }),
      prisma.user.findMany({ where, orderBy: { id: "asc" } }),
      prisma.client.findMany({ where, orderBy: { id: "asc" } }),
      prisma.document.findMany({ where, orderBy: { id: "asc" } }),
      prisma.task.findMany({ where, orderBy: { id: "asc" } }),
      prisma.activity.findMany({ where, orderBy: { id: "asc" } }),
      prisma.journey.findMany({ where, orderBy: { id: "asc" } }),
      prisma.journeyRun.findMany({ where, orderBy: { id: "asc" } }),
      prisma.messageTemplate.findMany({ where, orderBy: { id: "asc" } }),
      prisma.message.findMany({ where, orderBy: { id: "asc" } }),
      prisma.customFieldDefinition.findMany({ where, orderBy: { id: "asc" } }),
      prisma.stage.findMany({ where, orderBy: { id: "asc" } }),
      prisma.sopDocument.findMany({ where, orderBy: { id: "asc" } }),
      prisma.ticketReview.findMany({ where, orderBy: { id: "asc" } }),
      prisma.dsatAnalysis.findMany({ where, orderBy: { id: "asc" } }),
      prisma.calibrationSession.findMany({ where, include: { entries: true }, orderBy: { id: "asc" } }),
      prisma.notification.findMany({ where, orderBy: { id: "asc" } }),
      prisma.integrationConfig.findMany({ where, orderBy: { id: "asc" } }),
      prisma.webhookEndpoint.findMany({ where, orderBy: { id: "asc" } }),
      prisma.apiKey.findMany({ where, orderBy: { id: "asc" } }),
      prisma.productSubscription.findMany({ where, orderBy: { id: "asc" } }),
      prisma.auditLog.findMany({ where, orderBy: { id: "asc" } }),
    ]);
  // lastUsedAt is a best-effort "seen" marker, not tenant data — exclude it.
  const stableKeys = apiKeys.map((key) => ({ ...key, lastUsedAt: undefined }));
  return { org, users, clients, documents, tasks, activities, journeys, journeyRuns, templates, messages, customFields,
    stages, sops, reviews, dsats, calibrations, notifications, integrations, webhooks, apiKeys: stableKeys, subscriptions, auditLogs };
}
