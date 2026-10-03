import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/**
 * Boots a throwaway, real Postgres (no Docker needed) and applies the actual
 * migration history to it — the suite never touches the DATABASE_URL in .env.
 * Set TEST_DATABASE_URL to run against an existing empty database instead (CI).
 */
export default async function setup(project: TestProject) {
  if (process.env.TEST_DATABASE_URL) {
    migrate(process.env.TEST_DATABASE_URL);
    project.provide("databaseUrl", process.env.TEST_DATABASE_URL);
    return;
  }

  const dataDir = mkdtempSync(path.join(tmpdir(), "supportify-test-pg-"));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: false,
    onLog: () => {},
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("supportify_test");

  const url = `postgresql://postgres:postgres@localhost:${port}/supportify_test`;
  migrate(url);
  project.provide("databaseUrl", url);

  return async () => {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}

function migrate(url: string) {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
