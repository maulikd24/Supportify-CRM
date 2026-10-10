// Applies pending database migrations during a Vercel build, but only for production deploys.
// Preview deploys used to run them too: when previews share the production DATABASE_URL, an
// unmerged branch's migrations landed in production, and one failed migration then blocked
// every later deploy. Outside Vercel (VERCEL_ENV unset) migrations run as before.
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
if (env && env !== "production") {
  console.log(`Skipping "prisma migrate deploy" for a ${env} deploy; migrations run only on production deploys.`);
  process.exit(0);
}
execSync("npx prisma migrate deploy", { stdio: "inherit" });
