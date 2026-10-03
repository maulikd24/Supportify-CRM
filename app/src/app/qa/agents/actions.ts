"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireProductAccess } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { issueVerificationToken } from "@/lib/auth/verification-tokens";
import { sendAgentInviteEmail } from "@/lib/email/send";
import { agentSeatLimit, QA_GROWTH_UPSELL } from "@/lib/qa/plan-features";

const INVITE_HOURS = 72;

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Enter the agent's name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid login email"),
  /** Helpdesk email, when different from the login email. */
  helpdeskEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid helpdesk email")
    .nullable()
    .default(null)
    .or(z.literal("").transform(() => null)),
});

async function assertAgentSeatAvailable(organizationId: string) {
  const limit = await agentSeatLimit(organizationId);
  if (limit === 0) throw new UserError(`The agent portal is ${QA_GROWTH_UPSELL}`);
  if (limit == null) return;
  const used = await prisma.user.count({ where: { organizationId, orgRole: "AGENT", isActive: true } });
  if (used >= limit) throw new UserError(`Your plan includes ${limit} agent portal logins and they're all in use. Remove an agent or upgrade in Billing.`);
}

async function sendInvite(user: { id: string; name: string; email: string }, organizationId: string, inviterName: string) {
  const [token, org] = await Promise.all([
    issueVerificationToken(user.id, "PASSWORD_RESET", INVITE_HOURS),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
  ]);
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  try {
    await sendAgentInviteEmail({ to: user.email, name: user.name, orgName: org.name, inviterName, setPasswordUrl: `${appUrl}/reset-password/${token}` });
    return true;
  } catch (error) {
    console.error("Failed to send agent invite email", { organizationId, error });
    return false;
  }
}

function revalidate() {
  revalidatePath("/qa/agents");
}

export const inviteAgentAction = withUserErrors(async function inviteAgentAction(input: z.input<typeof inviteSchema>) {
  const session = await requireProductAccess("QA_SENTINEL", ["OWNER", "ADMIN"]);
  const organizationId = session.user.organizationId;
  const parsed = inviteSchema.parse(input);
  await assertAgentSeatAvailable(organizationId);

  const existing = await prisma.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (existing) throw new UserError("Someone already has a Supportify account with that email");

  const user = await prisma.user.create({
    data: {
      organizationId,
      orgRole: "AGENT",
      role: "RM",
      name: parsed.name,
      email: parsed.email,
      helpdeskEmail: parsed.helpdeskEmail && parsed.helpdeskEmail !== parsed.email ? parsed.helpdeskEmail : null,
      // Unusable until the agent sets a password from the invite link.
      passwordHash: await bcrypt.hash(randomBytes(32).toString("base64url"), 10),
      emailVerifiedAt: new Date(),
    },
  });
  const emailed = await sendInvite(user, organizationId, session.user.name);
  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "User",
    entityId: user.id,
    action: "qa.agent_invited",
    newValue: { email: parsed.email, helpdeskEmail: user.helpdeskEmail },
  });
  revalidate();
  return { emailed };
});

async function findAgent(organizationId: string, userId: string) {
  const agent = await prisma.user.findFirst({ where: { id: userId, organizationId, orgRole: "AGENT" } });
  if (!agent) throw new UserError("Agent not found");
  return agent;
}

export const resendAgentInviteAction = withUserErrors(async function resendAgentInviteAction(userId: string) {
  const session = await requireProductAccess("QA_SENTINEL", ["OWNER", "ADMIN"]);
  const organizationId = session.user.organizationId;
  const agent = await findAgent(organizationId, userId);
  if (!agent.isActive) throw new UserError("Restore this agent's access first");
  const emailed = await sendInvite(agent, organizationId, session.user.name);
  await recordAudit({ organizationId, userId: session.user.id, entity: "User", entityId: agent.id, action: "qa.agent_invite_resent", newValue: { email: agent.email } });
  return { emailed };
});

export const setAgentActiveAction = withUserErrors(async function setAgentActiveAction(userId: string, active: boolean) {
  const session = await requireProductAccess("QA_SENTINEL", ["OWNER", "ADMIN"]);
  const organizationId = session.user.organizationId;
  const agent = await findAgent(organizationId, userId);
  if (agent.isActive === active) return;
  if (active) await assertAgentSeatAvailable(organizationId);

  await prisma.user.update({
    where: { id: agent.id },
    // Removing access also ends any signed-in sessions right away.
    data: active ? { isActive: true } : { isActive: false, sessionsRevokedAt: new Date() },
  });
  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "User",
    entityId: agent.id,
    action: active ? "qa.agent_reactivated" : "qa.agent_deactivated",
    newValue: { email: agent.email },
  });
  revalidate();
});
