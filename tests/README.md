# Tests

```bash
npm test          # full suite (~10s)
npm run test:watch
```

The suite boots a throwaway **real Postgres** (via `embedded-postgres`, no Docker) and applies the actual
migration history to it. It never touches the `DATABASE_URL` in `.env`. In CI, set `TEST_DATABASE_URL`
to an empty database instead (see `.github/workflows/ci.yml`). Network access and the Anthropic client are
disabled for every test.

## Tenant isolation harness (`tests/isolation/`)

Every test creates two fully populated orgs, **A** and **B**, then runs an attack as A's admin against B's data
and asserts three things:

1. **B's full snapshot is unchanged**: every tenant-owned table.
2. **Nothing of B's leaks** into the response or error message.
3. **A stores no reference to a B row**: no cross-tenant foreign keys.

An attack that gets rejected by zod input validation **fails** the test, because it never reached the code under
test. Where practical, a **control** runs the same call on A's own data and must succeed.

### Adding a server action

`coverage.test.ts` scans every `"use server"` file and **fails if an exported action has neither an isolation case
nor a documented exemption.** When you add an action, add an entry to `CASES` in `tests/isolation/cases.ts`:

```ts
{
  action: "app/(dashboard)/things/actions#archiveThingAction",
  name: "archive B's thing",
  attack: (A, B) => things.archiveThingAction(B.ids.thing),
  control: (A) => things.archiveThingAction(A.ids.thing),
},
```

If it takes no resource id (it acts only on the session user/org, or it's a public auth flow), add it to `EXEMPT`
with the reason. New tenant-owned models belong in `createTenant()` and `snapshotTenant()` in
`tests/helpers/fixtures.ts`.

Also covered: the public API, exports and inbound webhooks (`http.test.ts`), per-tenant adapter credentials
(`adapters.test.ts`), and QA quota, billing gates and the Stripe webhook (`tests/billing/`).
