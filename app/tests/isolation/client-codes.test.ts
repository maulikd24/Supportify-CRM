import { afterAll, describe, expect, it } from "vitest";

import { createClientAction } from "@/app/(dashboard)/clients/actions";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { asUser, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

/**
 * Client codes used to come from one global "read the last code, add 1" sequence:
 * concurrent creates collided on the unique constraint, and every tenant's codes
 * revealed how many clients the whole platform had. They are now numbered per org
 * from an atomically incremented counter.
 */

const orgIds: string[] = [];
afterAll(() => deleteOrgs(...orgIds));

async function crmOrg() {
  const { org } = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
  orgIds.push(org.id);
  return { orgId: org.id, admin: await createUser(org.id, { role: "ADMIN", orgRole: "OWNER" }) };
}

const clientForm = (i: number) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: `Client ${i}`, mobile: `+1555000${1000 + i}`, email: "", clientType: "", leadSource: "", referralSource: "", notes: "", assignedToId: "" })) {
    f.append(k, v);
  }
  return f;
};

describe("client codes", () => {
  it("concurrent creates in one org all succeed with distinct, gapless codes", async () => {
    const { orgId, admin } = await crmOrg();
    asUser(admin);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => createClientAction(clientForm(i))));

    expect(results.every((r) => r && "client" in r)).toBe(true);
    const codes = (await prisma.client.findMany({ where: { organizationId: orgId }, select: { clientCode: true } }))
      .map((c) => c.clientCode)
      .sort();
    expect(codes).toEqual(Array.from({ length: 10 }, (_, i) => `CL-${String(i + 1).padStart(5, "0")}`));
  });

  it("are numbered per organization, so one tenant's codes reveal nothing about another's", async () => {
    const a = await crmOrg();
    const b = await crmOrg();
    for (let i = 0; i < 3; i++) await generateClientCode(a.orgId);
    expect(await generateClientCode(b.orgId)).toBe("CL-00001");
    expect(await generateClientCode(a.orgId)).toBe("CL-00004");
  });

  it("the same code may exist in two orgs, but not twice in one", async () => {
    const a = await crmOrg();
    const b = await crmOrg();
    const stageFor = (orgId: string) => prisma.stage.findFirstOrThrow({ where: { organizationId: orgId } });
    const make = async (orgId: string) =>
      prisma.client.create({ data: { organizationId: orgId, clientCode: "CL-00042", name: "x", mobile: "1", currentStageId: (await stageFor(orgId)).id } });

    await make(a.orgId);
    await expect(make(b.orgId)).resolves.toBeTruthy();
    await expect(make(a.orgId)).rejects.toThrow();
  });
});
