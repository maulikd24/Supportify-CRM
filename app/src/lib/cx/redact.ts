/**
 * PII redaction for CX Intelligence: conversations are redacted before they are stored or
 * sent to a model. Deterministic patterns only: emails, phone numbers, payment cards (Luhn
 * checked), IBANs (mod-97 checked), Aadhaar (Verhoeff checked), PAN and SSN-style ids, IPv4
 * addresses and secrets in URL query strings. Names and street addresses are NOT redacted.
 *
 * Each distinct value gets a numbered placeholder ("[EMAIL_1]"), consistent across every turn
 * of one conversation, so "the same address again" stays visible without the address itself.
 * Bump REDACTION_VERSION whenever the rules change; stored conversations record it.
 */

export const REDACTION_VERSION = 1;

export type PiiKind = "EMAIL" | "PHONE" | "CARD" | "IBAN" | "GOV_ID" | "IP" | "SECRET";

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

// Verhoeff tables (Aadhaar's check digit).
const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
function verhoeffValid(digits: string): boolean {
  let c = 0;
  [...digits].reverse().forEach((d, i) => {
    c = VD[c][VP[i % 8][Number(d)]];
  });
  return c === 0;
}

type Rule = { kind: PiiKind; pattern: RegExp; valid?: (match: string) => boolean; group?: number };

// Order matters: the most specific patterns run first so their digits aren't taken as phones.
const RULES: Rule[] = [
  // The value of secret-looking query parameters (the rest of the URL stays readable).
  { kind: "SECRET", pattern: /(?<=[?&](?:access_token|token|api_key|apikey|key|sig|signature|password|pwd|auth|session|otp|code)=)[^&\s#]+/gi },
  { kind: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { kind: "IBAN", pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, valid: ibanValid },
  { kind: "CARD", pattern: /\b\d(?:[ -]?\d){12,18}\b/g, valid: (m) => luhnValid(m.replace(/\D/g, "")) },
  { kind: "GOV_ID", pattern: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g, valid: (m) => verhoeffValid(m.replace(/\D/g, "")) }, // Aadhaar
  { kind: "GOV_ID", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g }, // Indian PAN
  { kind: "GOV_ID", pattern: /\b\d{3}-\d{2}-\d{4}\b/g }, // US SSN format
  {
    kind: "IP",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    valid: (m) => m.split(".").every((o) => Number(o) <= 255),
  },
  // Phones: a leading + with 8+ digits, or 10+ digits with common separators. Shorter digit
  // runs (order numbers, amounts) are left alone.
  { kind: "PHONE", pattern: /(?:\+\d[\d\s().-]{6,}\d|\(?\b\d[\d\s().-]{8,}\d\b)/g, valid: (m) => {
    const digits = m.replace(/\D/g, "").length;
    return m.trim().startsWith("+") ? digits >= 8 && digits <= 15 : digits >= 10 && digits <= 15;
  } },
];

export type Redactor = {
  redact(text: string): string;
  /** How many distinct values of each kind were replaced so far. */
  counts(): Partial<Record<PiiKind, number>>;
};

/** One redactor per conversation, so placeholders stay consistent across its turns. */
export function createRedactor(): Redactor {
  const seen = new Map<string, string>();
  const perKind: Partial<Record<PiiKind, number>> = {};

  function placeholder(kind: PiiKind, value: string): string {
    const key = `${kind}:${kind === "EMAIL" ? value.toLowerCase() : value.replace(/[\s().-]/g, "")}`;
    let ph = seen.get(key);
    if (!ph) {
      perKind[kind] = (perKind[kind] ?? 0) + 1;
      ph = `[${kind}_${perKind[kind]}]`;
      seen.set(key, ph);
    }
    return ph;
  }

  return {
    redact(text: string): string {
      let out = text;
      for (const rule of RULES) {
        out = out.replace(rule.pattern, (match) => {
          // Never re-redact inside a placeholder we already inserted.
          if (/^\[[A-Z_]+_\d+\]$/.test(match)) return match;
          return !rule.valid || rule.valid(match) ? placeholder(rule.kind, match) : match;
        });
      }
      return out;
    },
    counts: () => ({ ...perKind }),
  };
}

/** Redacts one standalone text (its placeholders are numbered on their own). */
export function redactText(text: string): string {
  return createRedactor().redact(text);
}
