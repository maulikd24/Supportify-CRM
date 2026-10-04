import { createHmac } from "crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebhookAction } from "@/app/(dashboard)/settings/developers/actions";
import { rotateWebhookTokenAction, saveIntegrationCredentialsAction } from "@/app/(dashboard)/settings/integrations/actions";
import * as messagingWebhook from "@/app/api/webhooks/messaging/[channel]/[token]/route";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { encryptJson } from "@/lib/security/crypto";
import { assertPublicHttpsUrl, isPublicAddress, postJsonToPublicUrl, UnsafeUrlError } from "@/lib/security/outbound";
import { newWebhookToken, verifyMetaSignature } from "@/lib/integrations/webhook-security";
import { asUser, createClient, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

let orgId: string;
let admin: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  const { org } = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
  orgId = org.id;
  admin = await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" });
});
afterAll(() => deleteOrgs(orgId));

describe("outgoing webhooks can't reach internal addresses (SSRF)", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
  ])("treats %s as non-public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("treats %s as public", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    ["http (not https)", "http://93.184.216.34/hook"],
    ["loopback", "https://127.0.0.1/hook"],
    ["IPv6 loopback", "https://[::1]/hook"],
    ["cloud metadata", "https://169.254.169.254/latest/meta-data"],
    ["a hostname resolving to loopback", "https://localhost/hook"],
    ["embedded credentials", "https://user:pass@93.184.216.34/hook"],
  ])("rejects %s when saving", async (_, url) => {
    await expect(assertPublicHttpsUrl(url)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("accepts a public https URL", async () => {
    await expect(assertPublicHttpsUrl("https://93.184.216.34/hook")).resolves.toBeUndefined();
  });

  it("createWebhookAction refuses an internal URL and stores nothing", async () => {
    asUser(admin);
    const form = new FormData();
    form.append("url", "https://169.254.169.254/latest/meta-data");
    form.append("events", "client.created");
    expect(await createWebhookAction(form)).toEqual({ __actionError: expect.stringMatching(/public internet address/) });
    expect(await prisma.webhookEndpoint.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("re-checks at connect time, so a host that resolves internally is never contacted", async () => {
    // Stands in for DNS rebinding: the URL was fine when saved, but now resolves to loopback.
    await expect(postJsonToPublicUrl("https://localhost:1/hook", "{}", {}, 2000)).rejects.toThrow(/non-public/);
  });

  it("an existing internal endpoint gets a failed delivery, not a request", async () => {
    // Saved before this check existed (written directly, bypassing createWebhookAction).
    const endpoint = await prisma.webhookEndpoint.create({
      data: { organizationId: orgId, url: "https://127.0.0.1/hook", encryptedSecret: encryptJson("whsec_x"), events: ["client.created"] },
    });
    await dispatchWebhookEvent(orgId, "client.created", { id: "c1" });
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookEndpointId: endpoint.id } });
    expect(delivery).toMatchObject({ success: false, statusCode: null, error: expect.stringMatching(/non-public/) });
  });
});

describe("inbound WhatsApp webhooks are verified against Meta's signature", () => {
  const APP_SECRET = "meta-app-secret";
  let token: string;
  let clientId: string;
  const mobile = "15551230000";

  beforeAll(async () => {
    const stage = await prisma.stage.findFirstOrThrow({ where: { organizationId: orgId } });
    const client = await createClient(orgId, stage.id);
    clientId = (await prisma.client.update({ where: { id: client.id }, data: { mobile } })).id;
    token = (
      await prisma.integrationConfig.create({
        data: {
          organizationId: orgId,
          provider: "whatsapp_meta",
          mode: "live",
          isEnabled: true,
          webhookToken: newWebhookToken(),
          credentials: encryptJson({ phoneNumberId: "p", accessToken: "a", appSecret: APP_SECRET }),
        },
      })
    ).webhookToken;
  });

  const body = (id: string) =>
    JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: mobile, text: { body: "hi" }, timestamp: "1700000000" }] } }] }] });
  const sign = (raw: string, secret = APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const post = (raw: string, signature?: string) =>
    messagingWebhook.POST(
      new Request("https://app.test/x", {
        method: "POST",
        headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) },
        body: raw,
      }),
      { params: Promise.resolve({ channel: "whatsapp", token }) },
    );
  const inbound = (externalId: string) => prisma.message.count({ where: { clientId, externalId, direction: "INBOUND" } });

  it("rejects an unsigned, forged or wrongly-signed payload, and stores nothing", async () => {
    const raw = body("wamid.forged");
    expect((await post(raw)).status).toBe(401);
    expect((await post(raw, sign(raw, "attacker-secret"))).status).toBe(401);
    expect((await post(raw, sign(body("other")))).status).toBe(401); // signature for a different body
    expect(await inbound("wamid.forged")).toBe(0);
  });

  it("accepts a payload Meta signed", async () => {
    const raw = body("wamid.genuine");
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(await inbound("wamid.genuine")).toBe(1);
  });

  it("verifyMetaSignature is constant-format and strict", () => {
    const raw = "{}";
    expect(verifyMetaSignature(raw, sign(raw), APP_SECRET)).toBe(true);
    expect(verifyMetaSignature(raw, null, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, sign(raw).replace("sha256=", "sha1="), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=short", APP_SECRET)).toBe(false);
  });
});

describe("inbound webhook URL tokens", () => {
  it("are 256-bit random values", () => {
    const tokens = new Set(Array.from({ length: 50 }, newWebhookToken));
    expect(tokens.size).toBe(50);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("can be rotated by an admin, and the old URL stops working", async () => {
    const config = await prisma.integrationConfig.create({
      data: { organizationId: orgId, provider: "sms_exotel", mode: "mock", webhookToken: newWebhookToken() },
    });
    asUser(admin);
    await rotateWebhookTokenAction("sms_exotel");

    const rotated = await prisma.integrationConfig.findUniqueOrThrow({ where: { id: config.id } });
    expect(rotated.webhookToken).not.toBe(config.webhookToken);
    const old = await messagingWebhook.POST(new Request("https://app.test/x", { method: "POST", body: "From=1&Body=x" }), {
      params: Promise.resolve({ channel: "sms", token: config.webhookToken }),
    });
    expect(old.status).toBe(404);
  });
});

describe("the WhatsApp App Secret is mandatory for live mode", () => {
  it("a live integration without an App Secret accepts no inbound messages", async () => {
    const { org, stage } = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
    const client = await createClient(org.id, stage.id);
    await prisma.client.update({ where: { id: client.id }, data: { mobile: "15559990000" } });
    const config = await prisma.integrationConfig.create({
      data: {
        organizationId: org.id,
        provider: "whatsapp_meta",
        mode: "live",
        webhookToken: newWebhookToken(),
        credentials: encryptJson({ phoneNumberId: "p", accessToken: "a" }),
      },
    });
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.nosecret", from: "15559990000", text: { body: "hi" }, timestamp: "1" }] } }] }] });
    try {
      const res = await messagingWebhook.POST(
        new Request("https://app.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: raw }),
        { params: Promise.resolve({ channel: "whatsapp", token: config.webhookToken }) },
      );
      expect(res.status).toBe(401);
      expect(await prisma.message.count({ where: { organizationId: org.id } })).toBe(0);
    } finally {
      await deleteOrgs(org.id);
    }
  });

  it("saving WhatsApp credentials requires the App Secret", async () => {
    asUser(admin);
    await expect(saveIntegrationCredentialsAction("whatsapp_meta", { phoneNumberId: "p", accessToken: "a", appSecret: " " })).rejects.toThrow(/App Secret is required/);
    await expect(saveIntegrationCredentialsAction("whatsapp_meta", { phoneNumberId: "p", accessToken: "a", appSecret: "s" })).resolves.toBeUndefined();
  });
});
