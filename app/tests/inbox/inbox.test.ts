import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { markConversationReadAction, sendInboxReplyAction } from "@/app/(dashboard)/inbox/actions";
import {
  computeFirstResponses,
  countUnreadConversations,
  firstResponseByRm,
  getThread,
  listConversations,
  median,
  whatsappWindowEndsAt,
} from "@/lib/inbox/inbox";
import { formatDuration } from "@/lib/utils/format";
import { asUser, createClient, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(Date.now() - ms);

describe("inbox rules (pure)", () => {
  it("WhatsApp free text is allowed for 24 hours after the client's last WhatsApp message", () => {
    const now = new Date();
    expect(whatsappWindowEndsAt([{ direction: "INBOUND", channel: "whatsapp", createdAt: ago(23 * HOUR) }], now)).not.toBeNull();
    expect(whatsappWindowEndsAt([{ direction: "INBOUND", channel: "whatsapp", createdAt: ago(25 * HOUR) }], now)).toBeNull();
    // Our own outbound messages and SMS replies don't open the WhatsApp window.
    expect(whatsappWindowEndsAt([{ direction: "OUTBOUND", channel: "whatsapp", createdAt: ago(MIN) }], now)).toBeNull();
    expect(whatsappWindowEndsAt([{ direction: "INBOUND", channel: "sms", createdAt: ago(MIN) }], now)).toBeNull();
  });

  it("first response: the clock starts at the client's first unanswered message and stops at our reply", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 9, 1, 9, m));
    const { responses, waitingSince } = computeFirstResponses(
      [
        { direction: "INBOUND", createdAt: t(0) },
        { direction: "INBOUND", createdAt: t(5) }, // still waiting: doesn't restart the clock
        { direction: "OUTBOUND", createdAt: t(30) },
        { direction: "OUTBOUND", createdAt: t(31) }, // a follow-up, not a response
        { direction: "INBOUND", createdAt: t(40) },
      ],
      "c1",
    );
    expect(responses).toEqual([{ clientId: "c1", waitedMs: 30 * MIN }]);
    expect(waitingSince).toEqual(t(40));
  });

  it("median and duration formatting", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(formatDuration(45 * MIN)).toBe("45m");
    expect(formatDuration(2 * HOUR + 10 * MIN)).toBe("2h 10m");
    expect(formatDuration(3 * 24 * HOUR + 4 * HOUR)).toBe("3d 4h");
  });
});

describe("inbox (database)", () => {
  type U = Awaited<ReturnType<typeof createUser>>;
  let orgId: string;
  let admin: U, rmA: U, rmB: U;
  let clientA: string, clientB: string, quietClient: string;
  let waTemplate: string, unapprovedTemplate: string, smsTemplate: string;

  const message = (clientId: string, direction: "INBOUND" | "OUTBOUND", createdAt: Date, extra: { readAt?: Date; channel?: string } = {}) =>
    prisma.message.create({
      data: { organizationId: orgId, clientId, channel: extra.channel ?? "whatsapp", provider: "whatsapp_meta", direction, body: `${direction} msg`, status: "DELIVERED", createdAt, readAt: extra.readAt },
    });

  beforeAll(async () => {
    const { org, stage } = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
    orgId = org.id;
    admin = await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" });
    rmA = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
    rmB = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
    const assign = async (rm: string, name: string) =>
      (await prisma.client.update({ where: { id: (await createClient(orgId, stage.id, name)).id }, data: { assignedToId: rm } })).id;
    clientA = await assign(rmA.id, "Client of A");
    clientB = await assign(rmB.id, "Client of B");
    quietClient = await assign(rmA.id, "Quiet client"); // no messages: never listed

    // Client A wrote 2h ago and 1h ago (both unread); we replied 3h ago before that.
    await message(clientA, "OUTBOUND", ago(3 * HOUR));
    await message(clientA, "INBOUND", ago(2 * HOUR));
    await message(clientA, "INBOUND", ago(1 * HOUR));
    // Client B wrote 30 days ago (window long closed) and it was read.
    await message(clientB, "INBOUND", ago(30 * 24 * HOUR), { readAt: ago(29 * 24 * HOUR) });

    const tpl = (name: string, channel: string, approved: boolean) =>
      prisma.messageTemplate.create({ data: { organizationId: orgId, channel, provider: "meta", name, body: "Hi {{name}}", approved, variables: ["name"] } });
    waTemplate = (await tpl("Follow up", "whatsapp", true)).id;
    unapprovedTemplate = (await tpl("Draft", "whatsapp", false)).id;
    smsTemplate = (await tpl("SMS hello", "sms", true)).id;
  });
  afterAll(() => deleteOrgs(orgId));

  it("an RM sees only their own clients' conversations, newest first, with unread counts", async () => {
    const forA = await listConversations(rmA);
    expect(forA.map((c) => c.clientId)).toEqual([clientA]);
    expect(forA.at(0)).toMatchObject({ unread: 2, lastMessage: { direction: "INBOUND" } });
    expect(await countUnreadConversations(rmA)).toBe(1);
    expect(await countUnreadConversations(rmB)).toBe(0);

    const forAdmin = (await listConversations(admin)).map((c) => c.clientId);
    expect(forAdmin).toEqual([clientA, clientB]);
    expect(forAdmin).not.toContain(quietClient);
  });

  it("another RM can't open or mark read someone else's conversation", async () => {
    await expect(getThread(rmB, clientA)).rejects.toThrow(/not found/);
    asUser(rmB);
    expect(await markConversationReadAction(clientA)).toEqual({ __actionError: "Client not found" });
    expect(await prisma.message.count({ where: { clientId: clientA, direction: "INBOUND", readAt: null } })).toBe(2);
  });

  it("free text is refused once the WhatsApp window has closed; an approved template still goes", async () => {
    asUser(rmB);
    expect(await sendInboxReplyAction(clientB, { kind: "text", channel: "whatsapp", text: "hello?" })).toEqual({
      __actionError: expect.stringMatching(/24-hour WhatsApp window has closed/),
    });
    expect(await sendInboxReplyAction(clientB, { kind: "template", channel: "whatsapp", templateId: unapprovedTemplate })).toEqual({
      __actionError: expect.stringMatching(/not approved/),
    });
    expect(await sendInboxReplyAction(clientB, { kind: "template", channel: "whatsapp", templateId: smsTemplate })).toEqual({
      __actionError: expect.stringMatching(/not approved for this channel/),
    });
    expect(await sendInboxReplyAction(clientB, { kind: "template", channel: "whatsapp", templateId: waTemplate, variables: { name: "B" } })).toBeUndefined();
    expect(await prisma.message.count({ where: { clientId: clientB, direction: "OUTBOUND" } })).toBe(1);
  });

  it("inside the window, free text is sent and the conversation becomes read", async () => {
    asUser(rmA);
    expect(await sendInboxReplyAction(clientA, { kind: "text", channel: "whatsapp", text: "Thanks, on it!" })).toBeUndefined();
    const sent = await prisma.message.findFirstOrThrow({ where: { clientId: clientA, direction: "OUTBOUND" }, orderBy: { createdAt: "desc" } });
    expect(sent.body).toBe("Thanks, on it!");
    expect(await countUnreadConversations(rmA)).toBe(0);
  });

  it("can't reply to another RM's client", async () => {
    asUser(rmA);
    const before = await prisma.message.count({ where: { clientId: clientB } });
    expect(await sendInboxReplyAction(clientB, { kind: "template", channel: "whatsapp", templateId: waTemplate })).toEqual({ __actionError: "Client not found" });
    expect(await prisma.message.count({ where: { clientId: clientB } })).toBe(before);
  });

  it("reports first-response time per assigned RM", async () => {
    const stats = await firstResponseByRm(admin, ago(7 * 24 * HOUR));
    const a = stats.find((s) => s.userId === rmA.id)!;
    // Client A waited from its first unanswered message (2h ago) until our reply just now.
    expect(a.answered).toBe(1);
    expect(a.medianMs! / HOUR).toBeCloseTo(2, 1);
    expect(a.waitingNow).toBe(0);
  });
});
