import { prisma } from "@/lib/db/prisma";
import { getEmailAdapter } from "@/lib/integrations/registry";

function baseUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

/** Emails all active Admins + the client's assigned RM about an SLA breach. Never throws — a failed send degrades to in-app notification only. */
export async function sendSlaBreachEmail(client: {
  id: string;
  organizationId: string;
  name: string;
  clientCode: string;
  currentStage: { name: string };
  assignedTo: { email: string; name: string } | null;
}) {
  try {
    const admins = await prisma.user.findMany({
      where: { organizationId: client.organizationId, role: "ADMIN", isActive: true },
      select: { email: true },
    });

    const recipients = new Set(admins.map((a) => a.email));
    if (client.assignedTo) recipients.add(client.assignedTo.email);
    if (recipients.size === 0) return;

    const adapter = await getEmailAdapter(client.organizationId);
    const url = `${baseUrl()}/clients/${client.id}`;

    await adapter.sendEmail({
      to: [...recipients],
      subject: `SLA breach: ${client.name} (${client.clientCode}) at ${client.currentStage.name}`,
      html: `<p>${client.name} (${client.clientCode}) is overdue at stage <b>${client.currentStage.name}</b>.</p><p><a href="${url}">View client</a></p>`,
      text: `${client.name} (${client.clientCode}) is overdue at stage ${client.currentStage.name}. View: ${url}`,
    });
  } catch (error) {
    console.error("Failed to send SLA breach email", error);
  }
}
