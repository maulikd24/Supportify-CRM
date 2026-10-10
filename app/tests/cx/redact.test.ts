import { describe, expect, it } from "vitest";

import { createRedactor, redactText } from "@/lib/cx/redact";

describe("PII redaction", () => {
  it("replaces each kind with a numbered placeholder, the same value with the same one", () => {
    const r = createRedactor();
    expect(r.redact("Mail me at Meera.S@Example.com or meera.s@example.com, cc ops@acme.co.in")).toBe(
      "Mail me at [EMAIL_1] or [EMAIL_1], cc [EMAIL_2]",
    );
    // Consistent across turns of the same conversation.
    expect(r.redact("Did you get my mail at meera.s@example.com?")).toBe("Did you get my mail at [EMAIL_1]?");
    expect(r.counts()).toEqual({ EMAIL: 2 });
  });

  it("phones: international or 10+ digits, but not order numbers or amounts", () => {
    expect(redactText("Call +91 98000 11111 or (022) 2345-6789-01 or 9800011111")).toBe("Call [PHONE_1] or [PHONE_2] or [PHONE_3]");
    expect(redactText("Order #4815162 for ₹12,499.00 shipped on 2026-10-05")).toBe("Order #4815162 for ₹12,499.00 shipped on 2026-10-05");
  });

  it("cards only when the Luhn check passes", () => {
    expect(redactText("Card 4111 1111 1111 1111 was declined")).toBe("Card [CARD_1] was declined");
    expect(redactText("Card 4111-1111-1111-1111")).toBe("Card [CARD_1]");
    // 16 digits that fail Luhn are not a card (here they are long enough to read as a phone-like id).
    expect(redactText("Ref 1234 5678 9012 3456")).not.toContain("[CARD");
  });

  it("IBANs (mod-97), Aadhaar (Verhoeff), PAN and SSN-style ids", () => {
    expect(redactText("IBAN GB82 WEST 1234 5698 7654 32 please")).toBe("IBAN [IBAN_1] please");
    expect(redactText("IBAN GB00 WEST 1234 5698 7654 32")).not.toContain("[IBAN");
    expect(redactText("Aadhaar 4991 1866 5246")).toBe("Aadhaar [GOV_ID_1]");
    expect(redactText("PAN ABCDE1234F, SSN 123-45-6789")).toBe("PAN [GOV_ID_1], SSN [GOV_ID_2]");
  });

  it("IPv4 addresses and secrets in URLs, keeping the rest of the URL readable", () => {
    expect(redactText("From 192.168.1.20, not 999.1.1.1")).toBe("From [IP_1], not 999.1.1.1");
    expect(redactText("Open https://app.example.com/reset?token=abc123XYZ&lang=en")).toBe(
      "Open https://app.example.com/reset?token=[SECRET_1]&lang=en",
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "My parcel is 3 days late and the app crashes on Android 14 after v2.3.1. Please refund 499.";
    expect(redactText(text)).toBe(text);
  });
});
