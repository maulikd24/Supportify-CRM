import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as listClients } from "@/app/api/v1/clients/route";
import { GET as getClient } from "@/app/api/v1/clients/[id]/route";
import { GET as listReviews } from "@/app/api/v1/reviews/route";
import { GET as getReview } from "@/app/api/v1/reviews/[id]/route";
import { hashApiKey } from "@/lib/security/api-keys";
import { createClient, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

const KEY_A = "sk_live_isolation_test_key_a";
let orgA: string, orgB: string, clientA: string, clientB: string, reviewA: string, reviewB: string;

const req = (url: string, key = KEY_A) => new Request(`http://test${url}`, { headers: { authorization: `Bearer ${key}` } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  const products = [
    { product: "CRM" as const, planId: "growth" },
    { product: "QA_SENTINEL" as const, planId: "growth", reviewQuota: 500 },
  ];
  const a = await createOrg({ products });
  const b = await createOrg({ products });
  orgA = a.org.id;
  orgB = b.org.id;
  const userA = await createUser(orgA);
  await createUser(orgB);
  clientA = (await createClient(orgA, a.stage.id, "Alpha client")).id;
  clientB = (await createClient(orgB, b.stage.id, "Bravo client")).id;
  reviewA = (await prisma.ticketReview.create({ data: { organizationId: orgA, ticketId: "A-1" } })).id;
  reviewB = (await prisma.ticketReview.create({ data: { organizationId: orgB, ticketId: "B-1" } })).id;
  await prisma.apiKey.create({ data: { organizationId: orgA, name: "a", keyPrefix: KEY_A.slice(0, 12), hashedKey: hashApiKey(KEY_A), createdById: userA.id } });
});
afterAll(() => deleteOrgs(orgA, orgB));

describe("public API tenant isolation", () => {
  it("rejects missing and unknown keys", async () => {
    expect((await listClients(new Request("http://test/api/v1/clients"))).status).toBe(401);
    expect((await listClients(req("/api/v1/clients", "sk_live_not_a_real_key"))).status).toBe(401);
  });

  it("lists only the key's own clients and reviews", async () => {
    const clients = await (await listClients(req("/api/v1/clients"))).json();
    const clientIds = JSON.stringify(clients);
    expect(clientIds).toContain(clientA);
    expect(clientIds).not.toContain(clientB);

    const reviews = await (await listReviews(req("/api/v1/reviews"))).json();
    expect(JSON.stringify(reviews)).toContain(reviewA);
    expect(JSON.stringify(reviews)).not.toContain(reviewB);
  });

  it("returns 404 for another organization's records", async () => {
    expect((await getClient(req(`/api/v1/clients/${clientA}`), params(clientA))).status).toBe(200);
    expect((await getClient(req(`/api/v1/clients/${clientB}`), params(clientB))).status).toBe(404);
    expect((await getReview(req(`/api/v1/reviews/${reviewA}`), params(reviewA))).status).toBe(200);
    expect((await getReview(req(`/api/v1/reviews/${reviewB}`), params(reviewB))).status).toBe(404);
  });

  it("stops working once revoked", async () => {
    await prisma.apiKey.updateMany({ where: { organizationId: orgA }, data: { revokedAt: new Date() } });
    expect((await listClients(req("/api/v1/clients"))).status).toBe(401);
  });
});
