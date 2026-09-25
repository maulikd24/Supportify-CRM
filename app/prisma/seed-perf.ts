/**
 * Generates large-scale synthetic data for local performance/load testing.
 * NOT part of the default seed (`prisma/seed.ts`) — run manually via `npm run seed:perf`.
 * Reads client count from PERF_SEED_CLIENTS (default 1000); activities/tasks scale with it.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";

const CLIENT_COUNT = Number(process.env.PERF_SEED_CLIENTS ?? 1000);
const CONCURRENCY = 20;

const FIRST_NAMES = ["Aarav", "Vivaan", "Aditya", "Diya", "Ananya", "Ishaan", "Kabir", "Meera", "Riya", "Sai"];
const LAST_NAMES = ["Sharma", "Verma", "Patel", "Iyer", "Nair", "Reddy", "Gupta", "Singh", "Das", "Menon"];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomMobile(): string {
  return `9${Math.floor(100000000 + Math.random() * 900000000)}`;
}

async function main() {
  const [stages, users, lastClient] = await Promise.all([
    prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } }),
    prisma.user.findMany({ where: { isActive: true, role: "RM" } }),
    prisma.client.findFirst({ orderBy: { createdAt: "desc" }, select: { clientCode: true } }),
  ]);

  if (stages.length === 0 || users.length === 0) {
    throw new Error("Run the default seed first (npm run db:seed or prisma migrate dev) so stages/RMs exist.");
  }

  const organizationId = users[0].organizationId;
  const startNumber = lastClient ? (parseInt(lastClient.clientCode.replace("CL-", ""), 10) || 0) + 1 : 1;

  console.log(`Generating ${CLIENT_COUNT} synthetic clients starting at CL-${String(startNumber).padStart(5, "0")}...`);

  let created = 0;
  for (let batchStart = 0; batchStart < CLIENT_COUNT; batchStart += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, CLIENT_COUNT - batchStart) }, (_, i) => {
      const index = batchStart + i;
      const clientCode = `CL-${String(startNumber + index).padStart(5, "0")}`;
      const stage = randomFrom(stages);
      const assignedTo = randomFrom(users);
      const name = `${randomFrom(FIRST_NAMES)} ${randomFrom(LAST_NAMES)}`;

      return prisma.client.create({
        data: {
          organizationId,
          clientCode,
          name,
          mobile: randomMobile(),
          email: `${clientCode.toLowerCase()}@perf-test.local`,
          priority: randomFrom(["LOW", "MEDIUM", "HIGH"] as const),
          currentStageId: stage.id,
          assignedToId: assignedTo.id,
          activities: {
            create: Array.from({ length: 10 }, (_, a) => ({
              organizationId,
              type: "NOTE" as const,
              userId: assignedTo.id,
              payload: { message: `Synthetic activity ${a + 1}` },
            })),
          },
          tasks: {
            create: Array.from({ length: 5 }, (_, t) => ({
              organizationId,
              title: `Synthetic task ${t + 1}`,
              assignedToId: assignedTo.id,
              dueAt: new Date(Date.now() + t * 24 * 60 * 60 * 1000),
              source: "perf-seed",
            })),
          },
        },
      });
    });

    await Promise.all(batch);
    created += batch.length;
    console.log(`  ${created}/${CLIENT_COUNT} clients created`);
  }

  console.log(`Done. Created ${created} clients with ~${created * 10} activities and ~${created * 5} tasks.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
