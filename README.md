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
