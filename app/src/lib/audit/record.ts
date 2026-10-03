import { headers } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type AuditEvent = {
  organizationId: string;
  /** The acting user; omit for system events (Stripe, cron) or unknown sign-in attempts. */
  userId?: string | null;
  actorEmail?: string | null;
  entity: string;
  entityId: string;
  action: string;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  reason?: string | null;
};

async function requestContext(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return {
      ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
      userAgent: h.get("user-agent")?.slice(0, 300) || null,
    };
  } catch {
    // Outside a request (cron, webhooks processed in the background).
    return { ipAddress: null, userAgent: null };
  }
}

/**
 * Appends to the organization's audit trail. Best-effort: an audit write must
 * never make the audited action fail, so errors are logged and swallowed.
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    const context = await requestContext();
    let actorEmail = event.actorEmail ?? null;
    if (!actorEmail && event.userId) {
      actorEmail = (await prisma.user.findUnique({ where: { id: event.userId }, select: { email: true } }))?.email ?? null;
    }
    await prisma.auditLog.create({
      data: {
        organizationId: event.organizationId,
        userId: event.userId ?? null,
        actorEmail,
        entity: event.entity,
        entityId: event.entityId,
        action: event.action,
        oldValue: event.oldValue ?? undefined,
        newValue: event.newValue ?? undefined,
        reason: event.reason ?? null,
        ...context,
      },
    });
  } catch (error) {
    console.error("Failed to write audit log", { action: event.action, error });
  }
}

/** Human labels for the audit log viewer and CSV export. Unknown actions fall back to the raw key. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Sign-in & sessions
  "auth.login_succeeded": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.login_blocked_sso_required": "Sign-in blocked (SSO required)",
  "auth.sso_login": "Signed in with SSO",
  "auth.password_changed": "Changed password",
  "auth.password_reset": "Reset password via email",
  "auth.2fa_enabled": "Turned on 2FA",
  "auth.2fa_disabled": "Turned off 2FA",
  "auth.sessions_revoked": "Signed out of all devices",
  // Team
  "user.created": "Added a user",
  "user.role_changed": "Changed a user's role",
  "user.manager_changed": "Changed a user's manager",
  "user.activated": "Reactivated a user",
  "user.deactivated": "Deactivated a user",
  "user.password_reset_by_admin": "Reset a user's password",
  "user.sessions_revoked": "Signed a user out",
  // Security & org settings
  "security.policy_changed": "Changed security policies",
  "sso.domain_changed": "Changed SSO domain",
  "api_key.created": "Created an API key",
  "api_key.revoked": "Revoked an API key",
  "webhook.created": "Added a webhook",
  "webhook.updated": "Updated a webhook",
  "webhook.deleted": "Deleted a webhook",
  "integration.updated": "Updated an integration",
  "zendesk.connected": "Connected Zendesk",
  "zendesk.disconnected": "Disconnected Zendesk",
  "qa.auto_review_changed": "Changed auto-review settings",
  "qa.overage_changed": "Changed overage settings",
  "qa.scorecard_created": "Created a scorecard",
  "qa.scorecard_updated": "Edited a scorecard",
  "qa.scorecard_deleted": "Deleted a scorecard",
  "qa.scorecard_default_changed": "Changed the default scorecard",
  "qa.coaching_created": "Assigned a coaching session",
  "qa.coaching_acknowledged": "Marked coaching acknowledged",
  "qa.coaching_completed": "Completed a coaching session",
  "qa.coaching_cancelled": "Cancelled a coaching session",
  "qa.dispute_raised": "Disputed a review score",
  "qa.dispute_upheld": "Upheld a disputed score",
  "qa.review_score_adjusted": "Adjusted a review score after a dispute",
  // Data
  "data.export_organization": "Exported organization data",
  "data.export_clients": "Exported clients",
  "data.export_audit_log": "Exported the audit log",
  "data.import_clients": "Imported clients",
  // Billing (system)
  "billing.subscription_updated": "Subscription updated",
  "billing.payment_failed": "Payment failed",
  "billing.checkout_started": "Started checkout",
  // CRM records (existing action names)
  created: "Created",
  stage_changed: "Stage changed",
  stage_corrected: "Stage corrected",
  hold_started: "Put on hold",
  hold_resolved: "Resumed from hold",
  marked_not_proceeding: "Marked not proceeding",
  reopened: "Reopened",
  merged: "Merged",
  auto_completed: "Auto-completed",
  platform_admin_adjusted_subscription: "Supportify staff adjusted the subscription",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}
