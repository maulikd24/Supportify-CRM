import { execSync } from "node:child_process";

/**
 * Tests need their own database. TEST_DATABASE_URL must be set explicitly so the
 * suite can never run against the app's real DATABASE_URL by accident.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Set TEST_DATABASE_URL to an empty, disposable Postgres database (e.g. `npx prisma dev --name test`). Tests never use DATABASE_URL.",
    );
  }
  try {
    execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer };
    console.error(e.stdout?.toString(), e.stderr?.toString());
    throw error;
  }
}
