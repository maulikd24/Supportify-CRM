import "dotenv/config";
import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/db/prisma";
import { DEFAULT_STAGE_DEFINITIONS } from "../src/lib/stage-engine/stages";

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const organization = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Demo Org", slug: "demo" },
  });
  const organizationId = organization.id;

  const admin = await prisma.user.upsert({
    where: { email: "admin@supportify.local" },
    update: {},
    create: {
      organizationId,
      orgRole: "OWNER",
      name: "Admin",
      email: "admin@supportify.local",
      passwordHash,
      role: "ADMIN",
      emailVerifiedAt: new Date(),
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@supportify.local" },
    update: {},
    create: {
      organizationId,
      orgRole: "ADMIN",
      name: "Manager Mia",
      email: "manager@supportify.local",
      passwordHash,
      role: "MANAGER",
      managerId: admin.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "rm@supportify.local" },
    update: {},
    create: {
      organizationId,
      orgRole: "MEMBER",
      name: "RM Raj",
      email: "rm@supportify.local",
      passwordHash,
      role: "RM",
      managerId: manager.id,
    },
  });

  for (const stage of DEFAULT_STAGE_DEFINITIONS) {
    await prisma.stage.upsert({
      where: { organizationId_name: { organizationId, name: stage.name } },
      update: { sequence: stage.sequence, slaHours: stage.slaHours, isTerminal: stage.isTerminal },
      create: { ...stage, organizationId },
    });
  }

  // Dev convenience: give the demo org an active plan on both products so local testing isn't paywalled.
  await prisma.productSubscription.upsert({
    where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } },
    update: {},
    create: { organizationId, product: "QA_SENTINEL", status: "ACTIVE", planId: "growth", reviewQuota: 500 },
  });
  await prisma.productSubscription.upsert({
    where: { organizationId_product: { organizationId, product: "CRM" } },
    update: {},
    create: { organizationId, product: "CRM", status: "ACTIVE", planId: "growth", seats: 20 },
  });

  console.log("Seeded org: demo");
  console.log("Seeded users: admin@supportify.local / manager@supportify.local / rm@supportify.local (password: password123)");
  console.log(`Seeded ${DEFAULT_STAGE_DEFINITIONS.length} onboarding stages`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
