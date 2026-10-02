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

Overage billing stays unavailable in the app until both Stripe variables are set.
