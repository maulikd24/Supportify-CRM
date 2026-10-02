import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { redirect } from "next/navigation";

import { sessionAllowed, ssoRequiredFor, enterpriseControlsAvailable } from "@/lib/security/policy";
import { rateLimit, cleanupRateLimits, hashIdentifier } from "@/lib/security/rate-limit";
import { withUserErrors, UserError } from "@/lib/actions/user-error";
import { callAction } from "@/lib/actions/call-action";
import { auditWhere } from "@/lib/audit/query";
import { recordAudit } from "@/lib/audit/record";
import { createOrg, deleteOrgs, prisma } from "../helpers";

const H = 3_600_000;
const orgs: string[] = [];
afterAll(() => deleteOrgs(...orgs));

describe("session policies", () => {
  const now = Date.now();
  const base = {
    authTime: now - 2 * H,
    authMethod: "password" as const,
    orgRole: "MEMBER" as const,
    userSessionsRevokedAt: null,
    org: { sessionMaxHours: null, sessionsRevokedAt: null, requireSso: false },
  };

  it("enforces the session length", () => {
    expect(sessionAllowed(base, now)).toBe(true);
    expect(sessionAllowed({ ...base, org: { ...base.org, sessionMaxHours: 1 } }, now)).toBe(false);
    expect(sessionAllowed({ ...base, org: { ...base.org, sessionMaxHours: 8 } }, now)).toBe(true);
  });

  it("ends sessions started before an org-wide or per-user sign-out", () => {
    expect(sessionAllowed({ ...base, org: { ...base.org, sessionsRevokedAt: new Date(now - H) } }, now)).toBe(false);
    expect(sessionAllowed({ ...base, authTime: now, org: { ...base.org, sessionsRevokedAt: new Date(now - H) } }, now)).toBe(true);
    expect(sessionAllowed({ ...base, userSessionsRevokedAt: new Date(now - H) }, now)).toBe(false);
  });

  it("requires SSO for members but never locks out the owner", () => {
    const sso = { ...base, org: { ...base.org, requireSso: true } };
    expect(sessionAllowed(sso, now)).toBe(false);
    expect(sessionAllowed({ ...sso, authMethod: "sso" }, now)).toBe(true);
    expect(sessionAllowed({ ...sso, orgRole: "OWNER" }, now)).toBe(true);
    expect(ssoRequiredFor({ requireSso: true }, "OWNER")).toBe(false);
    expect(ssoRequiredFor({ requireSso: true }, "ADMIN")).toBe(true);
  });

  it("offers enterprise controls on Scale/Enterprise and live trials only", async () => {
    const scale = (await createOrg({ products: [{ product: "CRM", planId: "scale" }] })).org.id;
    const starter = (await createOrg({ products: [{ product: "CRM", planId: "starter" }] })).org.id;
    const trial = (await createOrg({ products: [{ product: "QA_SENTINEL", status: "TRIALING", trialEndsAt: new Date(now + 86_400_000) }] })).org.id;
    const expired = (await createOrg({ products: [{ product: "QA_SENTINEL", status: "TRIALING", trialEndsAt: new Date(now - 1000) }] })).org.id;
    orgs.push(scale, starter, trial, expired);
    expect(await enterpriseControlsAvailable(scale)).toBe(true);
    expect(await enterpriseControlsAvailable(starter)).toBe(false);
    expect(await enterpriseControlsAvailable(trial)).toBe(true);
    expect(await enterpriseControlsAvailable(expired)).toBe(false);
  });
});

describe("rate limiting", () => {
  it("allows the limit, then blocks with a retry time; windows reset; identifiers are independent", async () => {
    const id = hashIdentifier(`Rate-${Date.now()}@Example.com `);
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await rateLimit("loginByEmail", id));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results[10].allowed).toBe(false);
    expect(results[10].retryAfterSeconds).toBeGreaterThan(800);
    expect((await rateLimit("loginByEmail", `${id}-other`)).allowed).toBe(true);

    await prisma.rateLimitBucket.update({ where: { key: `loginByEmail:${id}` }, data: { resetAt: new Date(Date.now() - 1000) } });
    expect((await rateLimit("loginByEmail", id)).allowed).toBe(true);
    await prisma.rateLimitBucket.update({ where: { key: `loginByEmail:${id}` }, data: { resetAt: new Date(Date.now() - 1000) } });
    expect(await cleanupRateLimits()).toBeGreaterThanOrEqual(1);
  });

  it("normalises emails before hashing", () => {
    expect(hashIdentifier(" Someone@Example.com ")).toBe(hashIdentifier("someone@example.com"));
  });
});

describe("user-facing action errors", () => {
  it("returns UserError and validation messages, rethrows bugs and redirects", async () => {
    await expect(withUserErrors(async () => { throw new UserError("SOP not found"); })()).resolves.toEqual({ __actionError: "SOP not found" });
    await expect(
      withUserErrors(async () => z.object({ name: z.string().min(1, "Name is required") }).parse({ name: "" }))(),
    ).resolves.toEqual({ __actionError: "Name is required" });
    await expect(withUserErrors(async () => { throw new TypeError("boom"); })()).rejects.toThrow("boom");
    const redirected = await withUserErrors(async () => redirect("/billing"))().then(() => null, (e) => e);
    expect(String(redirected?.digest)).toMatch(/^NEXT_REDIRECT/);
  });

  it("callAction gives the client a normal Error with the real message", async () => {
    await expect(callAction(withUserErrors(async () => { throw new UserError("Plan limit reached"); }))()).rejects.toThrow("Plan limit reached");
    await expect(callAction(withUserErrors(async (n: number) => n * 2))(21)).resolves.toBe(42);
  });
});

describe("audit trail", () => {
  it("records system events without a user and filters by category and person", async () => {
    const org = (await createOrg()).org.id;
    orgs.push(org);
    await recordAudit({ organizationId: org, entity: "ProductSubscription", entityId: "CRM", action: "billing.payment_failed" });
    await recordAudit({ organizationId: org, actorEmail: "intruder@example.com", entity: "User", entityId: "u", action: "auth.login_failed" });
    await prisma.auditLog.create({ data: { organizationId: org, entity: "Client", entityId: "c1", action: "stage_changed" } });
    const count = (filters: Parameters<typeof auditWhere>[1]) => prisma.auditLog.count({ where: auditWhere(org, filters) });
    expect(await count({ category: "billing" })).toBe(1);
    expect(await count({ category: "signin" })).toBe(1);
    expect(await count({ category: "records" })).toBe(1);
    expect(await count({ q: "intruder@example.com" })).toBe(1);
    const failed = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: org, action: "auth.login_failed" } });
    expect([failed.userId, failed.ipAddress, failed.userAgent]).toEqual([null, "203.0.113.7", "vitest"]);
  });
});
