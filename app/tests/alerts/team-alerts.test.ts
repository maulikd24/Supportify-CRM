import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/security/outbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/outbound")>();
  return {
    ...actual,
    postJsonToPublicUrl: post,
    // No DNS in tests: treat anything that isn't https://<something>.example as private.
    assertPublicHttpsUrl: vi.fn(async (url: string) => {
      if (!/^https:\/\/[^/]+\.example\//.test(url)) throw new actual.UnsafeUrlError("Webhook URLs must point to a public internet address");
    }),
  };
});

import {
  addTeamsChannelAction,
  deleteAlertChannelAction,
  sendTestAlertAction,
  setAlertChannelActiveAction,
  updateAlertTypesAction,
} from "@/app/(dashboard)/settings/alerts/actions";
import { connectSlackChannel } from "@/lib/alerts/channels";
import { DIGEST_THRESHOLD, renderMessage } from "@/lib/alerts/format";
import { MAX_CONSECUTIVE_FAILURES, routeAlerts } from "@/lib/alerts/route";
import type { Alert } from "@/lib/alerts/types";
import { checkStageSla } from "@/lib/sla/check-stage-sla";
import { decryptJson, encryptJson } from "@/lib/security/crypto";
import { asUser, createClient, createOrg, createUser, deleteOrgs, isRedirect, prisma } from "../helpers";

const HOUR = 3_600_000;
type U = Awaited<ReturnType<typeof createUser>>;

let orgA: string, orgB: string, stageA: string;
let adminA: U, adminB: U, rmA: U;

beforeAll(async () => {
  const a = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
  const b = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
  orgA = a.org.id;
  orgB = b.org.id;
  stageA = a.stage.id;
  adminA = await createUser(orgA, { role: "ADMIN", orgRole: "OWNER" });
  adminB = await createUser(orgB, { role: "ADMIN", orgRole: "OWNER" });
  rmA = await createUser(orgA, { role: "RM", orgRole: "MEMBER" });
});
afterAll(() => deleteOrgs(orgA, orgB));

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ status: 200 });
});
afterEach(async () => {
  await prisma.alertChannel.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.notification.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
});

const channel = (organizationId: string, opts: { kind?: string; alertTypes?: string[]; isActive?: boolean } = {}) =>
  prisma.alertChannel.create({
    data: {
      organizationId,
      kind: opts.kind ?? "slack",
      name: "#alerts",
      encryptedUrl: encryptJson(`https://hooks.slack.com/services/${organizationId}`),
      alertTypes: opts.alertTypes ?? ["stage_sla_breach"],
      isActive: opts.isActive ?? true,
    },
  });

const breach = (organizationId: string, n = 1): Extract<Alert, { type: "stage_sla_breach" }> => ({
  organizationId,
  type: "stage_sla_breach",
  clientId: `c${n}`,
  clientName: `Client ${n}`,
  stage: "KYC",
  assignedToName: "Asha",
});

/** The URL and parsed body of each post made. */
const posts = () => post.mock.calls.map(([url, body]) => ({ url: url as string, body: JSON.parse(body as string) }));

describe("message format", () => {
  it("Slack: escapes control characters, links to the client, and digests bursts", () => {
    const one = renderMessage("slack", "stage_sla_breach", [{ ...breach(orgA), clientName: "A&B <Ltd>" }]);
    expect(JSON.stringify(one)).toContain("A&amp;B &lt;Ltd&gt;");
    expect(JSON.stringify(one)).toContain("/clients/c1|Open in Supportify");

    const many = Array.from({ length: DIGEST_THRESHOLD + 25 }, (_, i) => breach(orgA, i));
    const digest = renderMessage("slack", "stage_sla_breach", many) as { text: string; blocks: { text: { text: string } }[] };
    expect(digest.text).toBe(`${many.length} new alerts: SLA breaches`);
    expect(digest.blocks[1].text.text.split("\n")).toHaveLength(21); // 20 lines + "…and N more"
    expect(digest.blocks[1].text.text).toContain("…and 10 more");
  });

  it("Teams: an Adaptive Card with an open-in-Supportify action", () => {
    const card = renderMessage("teams", "qa_low_score", [
      { organizationId: orgA, type: "qa_low_score", reviewId: "r1", ticketId: "42", agentName: "Ravi", score: 55.4 },
    ]) as { attachments: { contentType: string; content: { body: { text: string }[]; actions: { url: string }[] } }[] };
    expect(card.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(card.attachments[0].content.body[0].text).toBe("Low QA score: 55 on ticket 42");
    expect(card.attachments[0].content.actions[0].url).toMatch(/\/qa\/reviews\/r1$/);
  });
});

describe("routing", () => {
  it("posts only to active channels in the alert's own org that subscribed to its type", async () => {
    const subscribed = await channel(orgA);
    await channel(orgA, { alertTypes: ["task_overdue"] }); // other type
    await channel(orgA, { isActive: false }); // switched off
    await channel(orgB); // other org

    await routeAlerts([breach(orgA)]);
    expect(posts().map((p) => p.url)).toEqual([`https://hooks.slack.com/services/${orgA}`]);
    expect(await prisma.alertDelivery.findMany({ where: { alertChannelId: subscribed.id } })).toMatchObject([{ success: true, attempts: 1, alertCount: 1 }]);
  });

  it("a sweep's mixed-org batch reaches each org's channel with only that org's alerts", async () => {
    await channel(orgA);
    await channel(orgB);
    await routeAlerts([{ ...breach(orgA, 1), clientName: "Client of A" }, { ...breach(orgB, 2), clientName: "Client of B" }]);

    const byUrl = Object.fromEntries(posts().map((p) => [p.url, JSON.stringify(p.body)]));
    expect(Object.keys(byUrl)).toHaveLength(2);
    expect(byUrl[`https://hooks.slack.com/services/${orgA}`]).toContain("Client of A");
    expect(byUrl[`https://hooks.slack.com/services/${orgA}`]).not.toContain("Client of B");
    expect(byUrl[`https://hooks.slack.com/services/${orgB}`]).toContain("Client of B");
    expect(byUrl[`https://hooks.slack.com/services/${orgB}`]).not.toContain("Client of A");
  });

  it(`sends up to ${DIGEST_THRESHOLD} alerts one by one, and more as one digest`, async () => {
    await channel(orgA);
    await routeAlerts(Array.from({ length: DIGEST_THRESHOLD }, (_, i) => breach(orgA, i)));
    expect(post).toHaveBeenCalledTimes(DIGEST_THRESHOLD);

    post.mockClear();
    await routeAlerts(Array.from({ length: DIGEST_THRESHOLD + 1 }, (_, i) => breach(orgA, i)));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx or network error once, but not a 4xx", async () => {
    const c = await channel(orgA);
    post.mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 200 });
    await routeAlerts([breach(orgA)]);
    post.mockResolvedValueOnce({ status: 404 });
    await routeAlerts([breach(orgA)]);

    const deliveries = await prisma.alertDelivery.findMany({ where: { alertChannelId: c.id }, orderBy: { createdAt: "asc" } });
    expect(deliveries.map((d) => [d.success, d.attempts, d.statusCode])).toEqual([[true, 2, 200], [false, 1, 404]]);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it(`switches a channel off after ${MAX_CONSECUTIVE_FAILURES} failed deliveries in a row and tells admins once`, async () => {
    const c = await channel(orgA);
    post.mockResolvedValue({ status: 500 });

    await routeAlerts([breach(orgA, 1)]);
    await routeAlerts([breach(orgA, 2)]);
    expect(await prisma.alertChannel.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ isActive: true, consecutiveFailures: 2 });

    // The third failure in one sweep turns it off; the rest of that sweep is not attempted.
    await routeAlerts([breach(orgA, 3), breach(orgA, 4)]);
    expect(await prisma.alertChannel.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ isActive: false, lastError: "Channel responded with 500" });
    expect(await prisma.alertDelivery.count({ where: { alertChannelId: c.id } })).toBe(3);

    const notices = await prisma.notification.findMany({ where: { organizationId: orgA, type: "alert_channel_disabled" } });
    expect(notices.map((n) => n.userId)).toEqual([adminA.id]); // admins only, once
  });

  it("a success resets the failure streak", async () => {
    const c = await channel(orgA);
    post.mockResolvedValueOnce({ status: 500 }).mockResolvedValueOnce({ status: 500 });
    await routeAlerts([breach(orgA)]);
    await routeAlerts([breach(orgA)]);
    await routeAlerts([breach(orgA)]);
    expect(await prisma.alertChannel.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ isActive: true, consecutiveFailures: 0, lastError: null });
  });
});

describe("SLA sweep → channel", () => {
  it("posts each breach once, without the client's phone number or email", async () => {
    await channel(orgA);
    const c = await createClient(orgA, stageA, "Meera Shah");
    await prisma.client.update({
      where: { id: c.id },
      data: { assignedToId: rmA.id, email: "meera@private.example", stageEnteredAt: new Date(Date.now() - 30 * HOUR) },
    });

    await checkStageSla();
    await checkStageSla();

    const mine = posts().filter((p) => JSON.stringify(p.body).includes("Meera Shah"));
    expect(mine).toHaveLength(1);
    const text = JSON.stringify(mine[0].body);
    expect(text).toContain(`SLA breach: Meera Shah`);
    expect(text).toContain(`RM: ${rmA.name}`);
    expect(text).not.toContain("9999999999");
    expect(text).not.toContain("meera@private.example");
  });
});

describe("channel settings", () => {
  const formData = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("admins add a Teams channel with a public https URL, stored encrypted and audit-logged", async () => {
    asUser(adminA);
    expect(await addTeamsChannelAction(formData({ name: "Ops", url: "http://10.0.0.5/hook" }))).toEqual({
      __actionError: expect.stringMatching(/public internet address/),
    });

    const url = "https://acme.example/workflows/abc";
    expect(await addTeamsChannelAction(formData({ name: "Ops", url }))).toBeUndefined();
    const saved = await prisma.alertChannel.findFirstOrThrow({ where: { organizationId: orgA } });
    expect(saved).toMatchObject({ kind: "teams", name: "Ops", alertTypes: ["stage_sla_breach"] });
    expect(saved.encryptedUrl).not.toContain("acme.example");
    expect(decryptJson<string>(saved.encryptedUrl)).toBe(url);
    expect(await prisma.auditLog.count({ where: { organizationId: orgA, action: "alerts.channel_created", entityId: saved.id } })).toBe(1);
  });

  it("only admins can change channels", async () => {
    const c = await channel(orgA);
    asUser(rmA);
    for (const call of [
      () => addTeamsChannelAction(formData({ name: "x", url: "https://acme.example/x" })),
      () => updateAlertTypesAction(c.id, ["task_overdue"]),
      () => deleteAlertChannelAction(c.id),
    ]) {
      await expect(call()).rejects.toSatisfy((e) => isRedirect(e));
    }
    expect(await prisma.alertChannel.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ alertTypes: ["stage_sla_breach"] });
  });

  it("an admin can't touch another org's channel", async () => {
    const c = await channel(orgA);
    asUser(adminB);
    expect(await updateAlertTypesAction(c.id, ["task_overdue"])).toEqual({ __actionError: "Channel not found" });
    expect(await setAlertChannelActiveAction(c.id, false)).toEqual({ __actionError: "Channel not found" });
    expect(await sendTestAlertAction(c.id)).toEqual({ __actionError: "Channel not found" });
    expect(await deleteAlertChannelAction(c.id)).toEqual({ __actionError: "Channel not found" });
    expect(post).not.toHaveBeenCalled();
    expect(await prisma.alertChannel.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ isActive: true, alertTypes: ["stage_sla_breach"] });
  });

  it("alert types are validated and the change is audit-logged", async () => {
    const c = await channel(orgA);
    asUser(adminA);
    expect(await updateAlertTypesAction(c.id, ["drop_tables"])).toEqual({ __actionError: expect.stringMatching(/Invalid option/) });
    expect(await updateAlertTypesAction(c.id, ["task_overdue", "qa_low_score", "task_overdue"])).toBeUndefined();
    expect((await prisma.alertChannel.findUniqueOrThrow({ where: { id: c.id } })).alertTypes).toEqual(["task_overdue", "qa_low_score"]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "alerts.channel_updated" } });
    expect(audit.newValue).toEqual({ alertTypes: ["task_overdue", "qa_low_score"] });
  });

  it("turning a switched-off channel back on clears its failure streak; a failed test doesn't add to it", async () => {
    const c = await channel(orgA);
    await prisma.alertChannel.update({ where: { id: c.id }, data: { isActive: false, consecutiveFailures: 3, lastError: "boom" } });
    asUser(adminA);
    await setAlertChannelActiveAction(c.id, true);
    expect(await prisma.alertChannel.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ isActive: true, consecutiveFailures: 0, lastError: null });

    post.mockResolvedValue({ status: 500 });
    expect(await sendTestAlertAction(c.id)).toEqual({ __actionError: expect.stringMatching(/couldn't be delivered/) });
    expect(await prisma.alertChannel.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ isActive: true, consecutiveFailures: 0 });
  });
});

describe("Add to Slack", () => {
  const fetchMock = vi.fn();
  beforeAll(() => {
    vi.stubEnv("SLACK_CLIENT_ID", "cid");
    vi.stubEnv("SLACK_CLIENT_SECRET", "csecret");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  beforeEach(() => fetchMock.mockReset());

  const slackReply = (body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
  const input = (over: Partial<Parameters<typeof connectSlackChannel>[1]> = {}) => ({
    code: "code-1",
    state: "s".repeat(32),
    expectedState: "s".repeat(32),
    error: null,
    ...over,
  });

  it("rejects a state that doesn't match this browser's cookie, before calling Slack", async () => {
    expect(await connectSlackChannel(adminA, input({ expectedState: "t".repeat(32) }))).toBe("invalid");
    expect(await connectSlackChannel(adminA, input({ expectedState: null }))).toBe("invalid");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.alertChannel.count({ where: { organizationId: orgA } })).toBe(0);
  });

  it("stores the channel's webhook URL encrypted in the admin's org", async () => {
    const url = "https://hooks.slack.com/services/T1/B1/xyz";
    slackReply({ ok: true, team: { name: "Acme" }, incoming_webhook: { channel: "#sla-alerts", url } });
    expect(await connectSlackChannel(adminA, input())).toBe("connected");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    const saved = await prisma.alertChannel.findFirstOrThrow({ where: { organizationId: orgA } });
    expect(saved).toMatchObject({ kind: "slack", name: "#sla-alerts · Acme", createdById: adminA.id });
    expect(decryptJson<string>(saved.encryptedUrl)).toBe(url);
  });

  it("refuses anything Slack returns that isn't a hooks.slack.com URL, and handles cancel and errors", async () => {
    slackReply({ ok: true, incoming_webhook: { channel: "#x", url: "https://evil.example/hook" } });
    expect(await connectSlackChannel(adminA, input())).toBe("failed");
    slackReply({ ok: false, error: "invalid_code" });
    expect(await connectSlackChannel(adminA, input())).toBe("failed");
    expect(await connectSlackChannel(adminA, input({ code: null, error: "access_denied" }))).toBe("cancelled");
    expect(await prisma.alertChannel.count({ where: { organizationId: orgA } })).toBe(0);
  });

  it("is unavailable when Supportify's Slack app isn't configured", async () => {
    vi.stubEnv("SLACK_CLIENT_ID", "");
    expect(await connectSlackChannel(adminA, input())).toBe("unavailable");
    vi.stubEnv("SLACK_CLIENT_ID", "cid");
  });
});
