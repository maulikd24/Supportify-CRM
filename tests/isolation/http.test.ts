import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { encryptJson } from "@/lib/security/crypto";
import * as clientsList from "@/app/api/v1/clients/route";
import * as clientById from "@/app/api/v1/clients/[id]/route";
import * as reviewsList from "@/app/api/v1/reviews/route";
import * as reviewById from "@/app/api/v1/reviews/[id]/route";
import * as exportOrg from "@/app/api/export/organization/route";
import * as exportClients from "@/app/api/export/clients/route";
import * as integrationWebhook from "@/app/api/webhooks/[provider]/[token]/route";
import * as messagingWebhook from "@/app/api/webhooks/messaging/[channel]/[token]/route";
import { createTenant, snapshotTenant, type Tenant } from "../helpers/fixtures";
import { actAs } from "../helpers/session";

const BASE = "https://app.test";
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const withKey = (key: string, init: RequestInit = {}) => ({
  ...init,
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
});

function secretsOf(B: Tenant): string[] {
  return [B.organizationId, B.orgName, B.clientName, B.clientMobile, B.clientEmail, ...Object.values(B.ids)];
}
async function bodyText(res: Response) {
  return res.text();
}

let A: Tenant;
let B: Tenant;

beforeEach(async () => {
  A = await createTenant("A");
  B = await createTenant("B");
});

describe("public REST API (/api/v1) with org A's key", () => {
  it("cannot read B's client by id", async () => {
    const res = await clientById.GET(new Request(`${BASE}/api/v1/clients/${B.ids.client}`, withKey(A.apiKey)), params({ id: B.ids.client }));
    expect(res.status).toBe(404);
    const control = await clientById.GET(new Request(`${BASE}/x`, withKey(A.apiKey)), params({ id: A.ids.client }));
    expect(control.status).toBe(200);
  });

  it("lists only A's clients, and can't page into B via cursor", async () => {
    const res = await clientsList.GET(new Request(`${BASE}/api/v1/clients?limit=100`, withKey(A.apiKey)));
    const text = await bodyText(res);
    expect(res.status).toBe(200);
    expect(text).toContain(A.ids.client);
    expect(secretsOf(B).filter((s) => text.includes(s))).toEqual([]);

    const cursored = await clientsList.GET(new Request(`${BASE}/api/v1/clients?cursor=${B.ids.client}`, withKey(A.apiKey)));
    const cursoredText = await bodyText(cursored);
    expect(secretsOf(B).filter((s) => cursoredText.includes(s))).toEqual([]);
  });

  it("creates clients only in A", async () => {
    const before = await snapshotTenant(B.organizationId);
    const res = await clientsList.POST(
      new Request(`${BASE}/api/v1/clients`, withKey(A.apiKey, { method: "POST", body: JSON.stringify({ name: "Api", mobile: "+1999" }) })),
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect((await prisma.client.findUnique({ where: { id: data.id } }))?.organizationId).toBe(A.organizationId);
    expect(await snapshotTenant(B.organizationId)).toEqual(before);
  });

  it("cannot read B's QA reviews", async () => {
    const one = await reviewById.GET(new Request(`${BASE}/x`, withKey(A.apiKey)), params({ id: B.ids.review }));
    expect(one.status).toBe(404);
    const list = await bodyText(await reviewsList.GET(new Request(`${BASE}/api/v1/reviews`, withKey(A.apiKey))));
    expect(list).toContain(A.ids.review);
    expect(secretsOf(B).filter((s) => list.includes(s))).toEqual([]);
  });

  it("rejects a revoked key", async () => {
    await prisma.apiKey.update({ where: { id: A.ids.apiKey }, data: { revokedAt: new Date() } });
    const res = await clientsList.GET(new Request(`${BASE}/api/v1/clients`, withKey(A.apiKey)));
    expect(res.status).toBe(401);
  });
});

describe("data exports as org A's admin", () => {
  it.each([
    ["organization JSON", () => exportOrg.GET()],
    ["clients CSV", () => exportClients.GET()],
  ])("%s contains only A's data", async (_, run) => {
    actAs(A.admin);
    const text = await bodyText(await run());
    expect(text).toContain(A.clientName);
    expect(secretsOf(B).filter((s) => text.includes(s))).toEqual([]);
  });
});

describe("inbound webhooks on org A's URL", () => {
  it("integration webhook naming B's client never touches B", async () => {
    // Live Freshdesk parsing is pure (no network) and, unlike the mock, carries the requester email.
    await prisma.integrationConfig.update({
      where: { id: A.ids.integration },
      data: { mode: "live", credentials: encryptJson({ domain: "a", apiKey: "k" }) },
    });
    const before = await snapshotTenant(B.organizationId);

    const attack = await integrationWebhook.POST(
      new Request(`${BASE}/api/webhooks/freshdesk/${A.ids.integrationWebhookToken}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket_id: 1, status: "closed", requester_email: B.clientEmail }),
      }),
      params({ provider: "freshdesk", token: A.ids.integrationWebhookToken }),
    );
    expect(attack.status).toBe(200);
    expect(await snapshotTenant(B.organizationId)).toEqual(before);

    // Control: the same event for A's own client is recorded on A.
    await integrationWebhook.POST(
      new Request(`${BASE}/x`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket_id: 1, status: "closed", requester_email: A.clientEmail }),
      }),
      params({ provider: "freshdesk", token: A.ids.integrationWebhookToken }),
    );
    expect(await prisma.activity.count({ where: { clientId: A.ids.client, type: "TICKET" } })).toBe(1);
  });

  it("rejects a token presented under the wrong provider, or an unknown token", async () => {
    const wrongProvider = await integrationWebhook.POST(
      new Request(`${BASE}/x`, { method: "POST", body: "{}" }),
      params({ provider: "exotel", token: A.ids.integrationWebhookToken }),
    );
    expect(wrongProvider.status).toBe(404);
    const unknown = await integrationWebhook.POST(
      new Request(`${BASE}/x`, { method: "POST", body: "{}" }),
      params({ provider: "freshdesk", token: "not-a-token" }),
    );
    expect(unknown.status).toBe(404);
  });

  it("messaging webhook can't inject into, or update the status of, B's messages", async () => {
    const config = await prisma.integrationConfig.create({
      data: { organizationId: A.organizationId, provider: "whatsapp_meta", mode: "mock", isEnabled: true },
    });
    await prisma.message.create({
      data: {
        organizationId: B.organizationId,
        clientId: B.ids.client,
        channel: "whatsapp",
        provider: "whatsapp_meta",
        direction: "OUTBOUND",
        body: "hi",
        status: "SENT",
        externalId: "wamid.B",
      },
    });
    const before = await snapshotTenant(B.organizationId);

    const post = (payload: object) =>
      messagingWebhook.POST(
        new Request(`${BASE}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
        params({ channel: "whatsapp", token: config.webhookToken }),
      );
    await post({ from: B.clientMobile, text: "inbound", id: "wamid.in" }); // inbound from B's client's phone
    await post({ id: "wamid.B", status: "read" }); // status update for B's message id

    expect(await snapshotTenant(B.organizationId)).toEqual(before);
  });
});
