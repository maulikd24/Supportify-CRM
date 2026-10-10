import { createHash, createHmac } from "crypto";

import { createRedactor, REDACTION_VERSION } from "@/lib/cx/redact";
import { normalizeRequester } from "@/lib/support-health/link";
import type { HelpdeskTicket } from "@/lib/qa/helpdesks/types";

/**
 * Turns a helpdesk ticket into the stored, redacted shape of a CX conversation. Pure (no
 * database), so the redaction-before-storage rule can be tested directly.
 */

const MAX_TURNS = 200;
const MAX_TURN_CHARS = 4_000;
const MAX_TOTAL_CHARS = 60_000;

export type StoredTurn = { role: "customer" | "agent"; text: string; at: string | null };

export type ConversationFields = {
  subject: string | null;
  turns: StoredTurn[];
  textHash: string;
  truncated: boolean;
  redactionVersion: number;
  startedAt: Date;
  firstReplyAt: Date | null;
  solvedAt: Date | null;
  replyCount: number;
  customerKey: string | null;
  agentEmail: string | null;
  agentName: string | null;
};

/** Parses helpdesk timestamps, including Salesforce's "+0000" offsets. */
export function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A stable, non-reversible key for the customer: an HMAC of their normalised email (or phone)
 * with a per-organization salt, so repeat contacts can be counted without storing contact
 * details and keys can't be correlated across organizations.
 */
export function customerKeyFor(organizationId: string, requester: HelpdeskTicket["requester"]): string | null {
  const r = normalizeRequester(requester);
  const id = r.email ? `email:${r.email}` : r.phone ? `phone:${r.phone}` : null;
  if (!id) return null;
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error("ENCRYPTION_KEY is not set");
  return createHmac("sha256", secret).update(`${organizationId}:${id}`).digest("hex").slice(0, 32);
}

export function buildConversation(
  organizationId: string,
  ticket: HelpdeskTicket,
  opts: { listedUpdatedAt?: string | null; now?: Date } = {},
): ConversationFields {
  const redactor = createRedactor();
  let truncated = false;

  let turns = ticket.conversation
    .filter((t) => t.body?.trim())
    .map((t) => {
      let body = t.body.trim();
      if (body.length > MAX_TURN_CHARS) {
        body = `${body.slice(0, MAX_TURN_CHARS)}…`;
        truncated = true;
      }
      return { role: t.role, body, at: t.created_at ?? null };
    });

  // Very long threads keep their opening (up to half the budget) and their end, the parts
  // that say what the customer wanted and how it ended.
  if (turns.length > MAX_TURNS || turns.reduce((n, t) => n + t.body.length, 0) > MAX_TOTAL_CHARS) {
    truncated = true;
    const head: typeof turns = [];
    let used = 0;
    for (const t of turns.slice(0, MAX_TURNS / 2)) {
      if (head.length > 0 && used + t.body.length > MAX_TOTAL_CHARS / 2) break;
      head.push(t);
      used += t.body.length;
    }
    const tail: typeof turns = [];
    for (const t of turns.slice(head.length).reverse()) {
      if (used + t.body.length > MAX_TOTAL_CHARS || head.length + tail.length >= MAX_TURNS) break;
      tail.unshift(t);
      used += t.body.length;
    }
    turns = head.concat(tail);
  }

  // Redact in order so placeholders number in reading order across the thread.
  const subject = ticket.subject?.trim() ? redactor.redact(ticket.subject.trim()) : null;
  const stored: StoredTurn[] = turns.map((t) => ({ role: t.role, text: redactor.redact(t.body), at: t.at }));

  const times = stored.map((t) => parseTime(t.at));
  const firstCustomer = stored.findIndex((t) => t.role === "customer");
  const firstReplyIdx = stored.findIndex((t, i) => t.role === "agent" && i > firstCustomer && firstCustomer >= 0);
  const startedAt = times.find((t): t is Date => t !== null) ?? parseTime(opts.listedUpdatedAt) ?? opts.now ?? new Date();

  const textHash = createHash("sha256")
    .update(JSON.stringify([subject, stored.map((t) => [t.role, t.text])]))
    .digest("hex");

  return {
    subject,
    turns: stored,
    textHash,
    truncated,
    redactionVersion: REDACTION_VERSION,
    startedAt,
    firstReplyAt: firstReplyIdx >= 0 ? times[firstReplyIdx] : null,
    solvedAt: parseTime(opts.listedUpdatedAt),
    replyCount: stored.filter((t) => t.role === "agent").length,
    customerKey: customerKeyFor(organizationId, ticket.requester),
    agentEmail: ticket.agentEmail?.trim().toLowerCase() || null,
    agentName: ticket.agentName && ticket.agentName !== "Unknown" ? ticket.agentName : null,
  };
}
