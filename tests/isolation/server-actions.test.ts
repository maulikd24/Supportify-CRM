import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { createTenant, snapshotTenant, type Tenant } from "../helpers/fixtures";
import { actAs, RedirectError } from "../helpers/session";
import { CASES } from "./cases";

/** Values that must never appear in anything org A can see or store. */
function secretsOf(B: Tenant): string[] {
  return [...idsOf(B), B.orgName, B.clientName, B.clientMobile, B.clientEmail];
}

/** B's unguessable row ids — A storing one of these means a cross-tenant foreign key. (Phone/email are
 * excluded here: an attacker who types B's client's phone into A's own form already knew it.) */
function idsOf(B: Tenant): string[] {
  return [B.organizationId, B.admin.id, ...Object.values(B.ids)];
}

function findLeaks(value: unknown, secrets: string[]): string[] {
  const text = JSON.stringify(value ?? null);
  return secrets.filter((s) => text.includes(s));
}

/** Guard bounces (login/billing/role redirects) count as a rejected attack; any other redirect is a success. */
const GUARD_REDIRECTS = [/^\/login/, /^\/billing/, /^\/dashboard$/, /^\/clients$/, /^\/$/];

describe.each(CASES)("$action — $name", (testCase) => {
  let A: Tenant;
  let B: Tenant;

  beforeEach(async () => {
    // Sequential on purpose: client codes come from one global, non-atomic
    // sequence (audit P1 #10), so parallel creation collides.
    A = await createTenant("A");
    B = await createTenant("B");
    await testCase.setup?.(A, B);
    actAs(testCase.as === "rm" ? A.rm : A.admin);
  });

  it("cannot modify, reveal, or link to org B's data", async () => {
    const before = await snapshotTenant(B.organizationId);

    let result: unknown;
    try {
      result = await testCase.attack(A, B);
    } catch (error) {
      // An attack bounced by input validation never reached the code under test,
      // so it would "pass" while proving nothing — fix the case's inputs instead.
      expect(error, "attack was rejected by input validation, not by isolation").not.toBeInstanceOf(ZodError);
      // Rejecting is fine; but an error message must not leak B's data either.
      result = error instanceof Error ? error.message : error;
    }

    expect(await snapshotTenant(B.organizationId), "org B's data changed").toEqual(before);
    expect(findLeaks(result, secretsOf(B)), "response contained org B's data").toEqual([]);
    expect(
      findLeaks(await snapshotTenant(A.organizationId), idsOf(B)),
      "org A now stores a reference to org B's data",
    ).toEqual([]);
  });

  if (testCase.control) {
    it("control: the same call works on org A's own data", async () => {
      try {
        await testCase.control!(A);
      } catch (error) {
        if (error instanceof RedirectError && !GUARD_REDIRECTS.some((re) => re.test(error.url))) return;
        throw error;
      }
    });
  }
});
