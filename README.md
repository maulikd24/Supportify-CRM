# Supportify

One repository for everything Supportify ships.

| Folder | What it is | Deployed to | Hosting settings |
|---|---|---|---|
| `app/` | Next.js app: **CRM** + **QA Sentinel** (`/qa`), billing, admin. Prisma + Postgres. | app.supportify.co.in | Vercel, Root Directory = `app` |
| `website/` | Marketing site (static HTML/CSS). | supportify.co.in | Netlify, reads `netlify.toml` (base = `website`) |
| `archive/qa-tool-reference/` | Legacy Python/FastAPI QA tool, superseded by QA Sentinel in `app/`. Kept for reference only; not deployed. | — | — |

## Branches

- `main` — production. Vercel and Netlify deploy from here.
- `develop` — day-to-day work. Branch features off `develop`, merge back via PR, then merge `develop` → `main` to release.

## Database

The app uses a single Prisma-managed Postgres database (`DATABASE_URL`). Schema lives in
`app/prisma/schema.prisma`; migrations in `app/prisma/migrations` and are applied on every
Vercel deploy by `npm run vercel-build` (`prisma migrate deploy`).

## Running locally

```bash
npm --prefix app install && npm --prefix app run dev   # app on :3000
npx -y serve website -l 4300                           # website on :4300
```

## Background jobs

Vercel Cron (see `app/vercel.json`) calls two endpoints once a day (Hobby plan limit):

- `/api/internal/cron/tick` — task/stage SLA checks, journeys, disengagement.
- `/api/internal/cron/auto-review` — QA auto-review: pulls newly solved Zendesk tickets for orgs
  with auto-review on, samples them, and reviews the queue. Each run works ~50s and then calls
  itself again until the queue is empty.

Required environment variables (Vercel → Settings → Environment Variables):

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer …`; the endpoints reject calls without it. |
| `APP_URL` | Public app URL, e.g. `https://app.supportify.co.in` (used for the auto-review chain and emails). |
| `STRIPE_METER_EVENT_QA_REVIEW` | Event name of the Stripe Billing Meter for QA overage reviews. |
| `STRIPE_PRICE_QA_OVERAGE` | Metered Stripe Price ($0.25/review) attached to that meter. |
| `AUTO_REVIEW_CONCURRENCY` | Optional. Reviews run in parallel per batch (default 4). |
| `ANTHROPIC_API_KEY` | Claude API key, used by QA Sentinel reviews and by "Draft with AI" in the Inbox (hidden when unset). |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Optional. Supportify's Slack app, for "Add to Slack" in Settings → Team alerts. Without them only Teams channels can be added. |

### Slack app for team alerts

Create one app at <https://api.slack.com/apps> (From scratch). Under **OAuth & Permissions** add the
redirect URL `<APP_URL>/api/integrations/slack/callback` and the bot scope `incoming-webhook` (nothing
else). Under **Manage Distribution**, turn on public distribution so other workspaces can install it.
Copy the Client ID and Client Secret from **Basic Information** into the two variables above.

## Plans and Stripe prices

Plans live in `app/src/lib/billing/plans.ts`. Each self-serve plan needs a monthly Stripe Price, and
an annual one (10× monthly) for the Monthly/Annual toggle to appear:

| Plan | Monthly env var | Annual env var |
|---|---|---|
| QA Starter $49 / $490 | `STRIPE_PRICE_QA_STARTER` | `STRIPE_PRICE_QA_STARTER_ANNUAL` |
| QA Growth $149 / $1,490 | `STRIPE_PRICE_QA_GROWTH` | `STRIPE_PRICE_QA_GROWTH_ANNUAL` |
| QA Scale $399 / $3,990 | `STRIPE_PRICE_QA_SCALE` | `STRIPE_PRICE_QA_SCALE_ANNUAL` |
| CRM Starter $29 / $290 per seat | `STRIPE_PRICE_CRM_STARTER` | `STRIPE_PRICE_CRM_STARTER_ANNUAL` |
| CRM Growth $49 / $490 per seat | `STRIPE_PRICE_CRM_GROWTH` | `STRIPE_PRICE_CRM_GROWTH_ANNUAL` |
| CRM Scale $69 / $690 per seat | `STRIPE_PRICE_CRM_SCALE` | `STRIPE_PRICE_CRM_SCALE_ANNUAL` |

Annual plans keep monthly review quotas (reset by the daily cron) and can't use overages.

Overage billing stays unavailable in the app until both Stripe variables are set.

## Error monitoring (optional)

Sentry is wired in (`app/src/instrumentation*.ts`) but stays off until these are set:

| Variable | Purpose |
|---|---|
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Project DSN (server / browser). |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Optional: upload source maps for readable stack traces. |

Error reports exclude request bodies, cookies, headers, user details and AI prompts.

## Rate limits

Stored in Postgres (`RateLimitBucket`), so no extra service is needed. Limits live in
`app/src/lib/security/rate-limit.ts`: sign-in (per IP and per email), sign-up, password reset,
SSO start, verification emails, and the public API (120 requests/minute per key → HTTP 429).

## Organization area, security and audit

`/org` is product-neutral (works for CRM-only, QA-only and two-product orgs):

- **My account** (`/org/account`): password and personal 2FA.
- **Security** (`/org/security`, owners/admins): require 2FA, require SSO (the owner keeps password
  sign-in as a break-glass), session length (8h / 24h / 7d / 30d), sign out all devices.
  Turning policies on needs a Scale or Enterprise plan (or a live trial); turning them off is always allowed.
- **Single sign-on** (`/org/sso`) and **Audit log** (`/org/audit-log`, CSV export on Scale/Enterprise).

Policies are enforced on every request in the NextAuth `jwt` callback (`src/lib/security/policy.ts`);
2FA setup is enforced by the product layouts (`src/lib/security/enforce.ts`). Audit events are written
with `recordAudit()` (`src/lib/audit/record.ts`).

## Tests

`app/tests` (Vitest) covers billing (plan limits, seats, quota/overage claims incl. concurrency, the
Stripe webhook with signed events, grace period, annual resets), tenant isolation (public API, server
actions, audit export), permissions and plan gating, security policies, rate limits, action error
handling, the audit trail and the QA auto-review pipeline (Zendesk and Claude stubbed).

Tests need a disposable Postgres and refuse to run without `TEST_DATABASE_URL`:

```bash
cd app && npx prisma dev --name test --detach   # prints a postgres:// URL
TEST_DATABASE_URL="postgres://…" npm test
```

GitHub Actions (`.github/workflows/app-tests.yml`) runs the type check and tests against Postgres 16 on
every push to `main`/`develop` and on pull requests that touch `app/`.
