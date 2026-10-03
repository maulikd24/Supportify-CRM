import { afterEach, describe, expect, it, vi } from "vitest";

import { createWhatsappMetaAdapter } from "@/lib/messaging/adapters/whatsapp-meta";
import { createSmsExotelAdapter } from "@/lib/messaging/adapters/sms-exotel";
import { createFreshdeskAdapter } from "@/lib/integrations/adapters/freshdesk";
import { createResendEmailAdapter } from "@/lib/integrations/adapters/resend-email";

type Call = { url: string; auth: string };

function recordFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 5)); // yield like a real network call
    calls.push({ url: String(url), auth: String((init?.headers as Record<string, string>)?.Authorization ?? "") });
    return new Response(JSON.stringify({ messages: [{ id: "m" }], SMSMessage: { Sid: "s" }, id: "e" }), { status: 200 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

/**
 * Audit P0 #2: adapters used to keep credentials in module scope, so org B
 * configuring between org A's configure() and send() made A send as B.
 * Reproduces exactly that interleaving for every live adapter.
 */
describe("live adapters keep each tenant's credentials separate", () => {
  it("WhatsApp (Meta)", async () => {
    const calls = recordFetch();
    const a = createWhatsappMetaAdapter();
    await a.configure({ phoneNumberId: "PHONE_A", accessToken: "TOKEN_A" }, {});
    const b = createWhatsappMetaAdapter();
    await b.configure({ phoneNumberId: "PHONE_B", accessToken: "TOKEN_B" }, {});
    await a.sendMessage({ to: "1", body: "x", variables: { body: "x" } });

    expect(calls[0].url).toContain("PHONE_A");
    expect(calls[0].auth).toBe("Bearer TOKEN_A");
  });

  it("SMS (Exotel)", async () => {
    const calls = recordFetch();
    const a = createSmsExotelAdapter();
    await a.configure({ sid: "SID_A", apiKey: "k", apiToken: "t", senderId: "A" }, {});
    await createSmsExotelAdapter().configure({ sid: "SID_B", apiKey: "k", apiToken: "t", senderId: "B" }, {});
    await a.sendMessage({ to: "1", body: "x", variables: {} });

    expect(calls[0].url).toContain("SID_A");
  });

  it("Freshdesk", async () => {
    const calls = recordFetch();
    const a = createFreshdeskAdapter();
    await a.configure({ domain: "orga", apiKey: "KA" }, {});
    await createFreshdeskAdapter().configure({ domain: "orgb", apiKey: "KB" }, {});
    await a.testConnection();

    expect(calls[0].url).toContain("orga.freshdesk.com");
  });

  it("Resend email", async () => {
    const calls = recordFetch();
    const a = createResendEmailAdapter();
    await a.configure({ apiKey: "RESEND_A", fromAddress: "a@example.test" }, {});
    await createResendEmailAdapter().configure({ apiKey: "RESEND_B", fromAddress: "b@example.test" }, {});
    await a.sendEmail({ to: ["x@example.test"], subject: "s", html: "h" });

    expect(calls[0].auth).toBe("Bearer RESEND_A");
  });
});
