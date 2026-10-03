import { prisma } from "@/lib/db/prisma";
import { ALL_CRITERIA } from "@/lib/qa/assessor";
import type { Tenant } from "../helpers/fixtures";

import * as clients from "@/app/(dashboard)/clients/actions";
import * as importActions from "@/app/(dashboard)/clients/import-actions";
import * as journeys from "@/app/(dashboard)/journeys/actions";
import * as notifications from "@/app/(dashboard)/notifications-actions";
import * as customFields from "@/app/(dashboard)/settings/custom-fields/actions";
import * as data from "@/app/(dashboard)/settings/data/actions";
import * as developers from "@/app/(dashboard)/settings/developers/actions";
import * as integrations from "@/app/(dashboard)/settings/integrations/actions";
import * as sso from "@/app/(dashboard)/settings/sso/actions";
import * as stages from "@/app/(dashboard)/settings/stages/actions";
import * as templates from "@/app/(dashboard)/settings/templates/actions";
import * as users from "@/app/(dashboard)/settings/users/actions";
import * as tasks from "@/app/(dashboard)/tasks/actions";
import * as admin from "@/app/admin/organizations/[id]/actions";
import * as calibration from "@/app/qa/calibration/actions";
import * as dsat from "@/app/qa/dsat/actions";
import * as reviews from "@/app/qa/reviews/actions";
import * as qaSettings from "@/app/qa/settings/actions";

export type IsolationCase = {
  /** "<file under src/, no extension>#<exported action>" — what the coverage test matches against. */
  action: string;
  /** Short description of the attack, used in the test name. */
  name: string;
  /** Which of org A's users performs the attack (default: admin, who is also org OWNER). */
  as?: "admin" | "rm";
  /** Optional state to set up before the attack (e.g. B claims an SSO domain). */
  setup?: (A: Tenant, B: Tenant) => Promise<void>;
  /** Runs as org A, aimed at org B's data. May throw or no-op — it must just not touch or reveal B. */
  attack: (A: Tenant, B: Tenant) => Promise<unknown>;
  /** The same call against A's own data. Must succeed — proves the attack isn't "passing" on bad arguments. */
  control?: (A: Tenant) => Promise<unknown>;
};

export function fd(fields: Record<string, string | string[]>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
  }
  return form;
}

const k = (file: string, fn: string) => `${file}#${fn}`;
const CLIENTS = "app/(dashboard)/clients/actions";
const USERS = "app/(dashboard)/settings/users/actions";

const scores = () => fd(Object.fromEntries([...ALL_CRITERIA.map(([key]) => [key, "80"]), ["notes", "n"]]));
const contact = { contactMethod: "Phone", contactOutcome: "Connected" } as const;
const graph = {
  nodes: [{ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "client_created" } }],
  edges: [],
} as never;
// Browsers submit "" for every empty field — mirror that, or zod rejects the
// form on a missing (null) field and the attack never reaches the code under test.
const newClient = (overrides: Record<string, string> = {}) =>
  fd({
    name: "New",
    mobile: `+1444${Math.floor(Math.random() * 1e7)}`,
    email: "",
    clientType: "",
    leadSource: "",
    referralSource: "",
    notes: "",
    assignedToId: "",
    ...overrides,
  });
const newUser = (overrides: Record<string, string> = {}) =>
  fd({ name: "n", email: `u-${Math.random().toString(36).slice(2)}@example.test`, role: "RM", managerId: "", ...overrides });

export const CASES: IsolationCase[] = [
  // --- CRM clients -------------------------------------------------------------
  {
    action: k(CLIENTS, "searchClientsForMergeAction"),
    name: "search for B's client by name",
    attack: (A, B) => clients.searchClientsForMergeAction(B.clientName, "x"),
    control: async (A) => {
      const hits = await clients.searchClientsForMergeAction(A.clientName, "x");
      if (hits.length !== 1) throw new Error("control should find A's own client");
    },
  },
  {
    action: k(CLIENTS, "createClientAction"),
    name: "duplicate check leaks B's client (mobile collision)",
    attack: (A, B) => clients.createClientAction(newClient({ mobile: B.clientMobile, email: B.clientEmail })),
    control: () => clients.createClientAction(newClient()),
  },
  {
    action: k(CLIENTS, "createClientAction"),
    name: "assign a new client to B's user",
    attack: (A, B) => clients.createClientAction(newClient({ assignedToId: B.ids.rmUser })),
  },
  {
    action: k(CLIENTS, "reassignClientAction"),
    name: "reassign B's client",
    attack: (A, B) => clients.reassignClientAction(B.ids.client, A.ids.rmUser),
    control: (A) => clients.reassignClientAction(A.ids.client, A.admin.id),
  },
  {
    action: k(CLIENTS, "reassignClientAction"),
    name: "reassign A's client to B's user",
    attack: (A, B) => clients.reassignClientAction(A.ids.client, B.ids.rmUser),
  },
  {
    action: k(CLIENTS, "addClientNoteAction"),
    name: "add note to B's client",
    attack: (A, B) => clients.addClientNoteAction(B.ids.client, "pwned"),
    control: (A) => clients.addClientNoteAction(A.ids.client, "hi"),
  },
  {
    action: k(CLIENTS, "sendClientMessageAction"),
    name: "message B's client",
    attack: (A, B) => clients.sendClientMessageAction(B.ids.client, "whatsapp", A.ids.template, { name: "x" }),
    control: (A) => clients.sendClientMessageAction(A.ids.client, "whatsapp", A.ids.template, { name: "x" }),
  },
  {
    action: k(CLIENTS, "sendClientMessageAction"),
    name: "message own client using B's template",
    attack: (A, B) => clients.sendClientMessageAction(A.ids.client, "whatsapp", B.ids.template, { name: "x" }),
  },
  {
    action: k(CLIENTS, "recordRmContactAction"),
    name: "log contact on B's client",
    attack: (A, B) => clients.recordRmContactAction(B.ids.client, contact),
    control: (A) => clients.recordRmContactAction(A.ids.client, contact),
  },
  {
    action: k(CLIENTS, "addDocumentAction"),
    name: "add document to B's client",
    attack: (A, B) => clients.addDocumentAction(B.ids.client, "Passport", true),
    control: (A) => clients.addDocumentAction(A.ids.client, "Passport", true),
  },
  {
    action: k(CLIENTS, "updateDocumentStatusAction"),
    name: "verify B's document",
    attack: (A, B) => clients.updateDocumentStatusAction(B.ids.document, { status: "VERIFIED" }),
    control: (A) => clients.updateDocumentStatusAction(A.ids.document, { status: "VERIFIED" }),
  },
  {
    action: k(CLIENTS, "updateClientDetailsAction"),
    name: "edit B's client",
    attack: (A, B) => clients.updateClientDetailsAction(B.ids.client, { dealValue: 1 }),
    control: (A) => clients.updateClientDetailsAction(A.ids.client, { dealValue: 1 }),
  },
  {
    action: k(CLIENTS, "moveToStageAction"),
    name: "move B's client",
    attack: (A, B) => clients.moveToStageAction(B.ids.client, B.ids.laterStage),
    control: (A) => clients.moveToStageAction(A.ids.client, A.ids.laterStage),
  },
  {
    action: k(CLIENTS, "moveToStageAction"),
    name: "move own client into B's stage",
    attack: (A, B) => clients.moveToStageAction(A.ids.client, B.ids.laterStage),
  },
  {
    action: k(CLIENTS, "correctStageAction"),
    name: "correct B's client stage",
    attack: (A, B) => clients.correctStageAction(B.ids.client, B.ids.laterStage, "r"),
    control: (A) => clients.correctStageAction(A.ids.client, A.ids.laterStage, "r"),
  },
  {
    action: k(CLIENTS, "correctStageAction"),
    name: "correct own client into B's stage",
    attack: (A, B) => clients.correctStageAction(A.ids.client, B.ids.stage, "r"),
  },
  {
    action: k(CLIENTS, "putOnHoldAction"),
    name: "put B's client on hold",
    attack: (A, B) => clients.putOnHoldAction(B.ids.client, { reason: "r" }),
    control: (A) => clients.putOnHoldAction(A.ids.client, { reason: "r" }),
  },
  {
    action: k(CLIENTS, "resumeFromHoldAction"),
    name: "resume B's client",
    setup: async (A, B) => {
      await prisma.client.update({ where: { id: B.ids.client }, data: { status: "ON_HOLD" } });
    },
    attack: (A, B) => clients.resumeFromHoldAction(B.ids.client),
  },
  {
    action: k(CLIENTS, "markNotProceedingAction"),
    name: "close B's client",
    attack: (A, B) => clients.markNotProceedingAction(B.ids.client, { reason: "r" }),
    control: (A) => clients.markNotProceedingAction(A.ids.client, { reason: "r" }),
  },
  {
    action: k(CLIENTS, "reopenClientAction"),
    name: "reopen B's client",
    setup: async (A, B) => {
      await prisma.client.update({ where: { id: B.ids.client }, data: { status: "NOT_PROCEEDING" } });
    },
    attack: (A, B) => clients.reopenClientAction(B.ids.client, { reason: "r" }),
  },
  {
    action: k(CLIENTS, "mergeClientsAction"),
    name: "merge B's client into own",
    attack: (A, B) => clients.mergeClientsAction(A.ids.client, B.ids.client),
  },
  {
    action: k(CLIENTS, "mergeClientsAction"),
    name: "merge own client into B's",
    attack: (A, B) => clients.mergeClientsAction(B.ids.client, A.ids.client),
  },
  {
    action: k("app/(dashboard)/clients/import-actions", "importClientsAction"),
    name: "import rows naming B's client and user",
    attack: (A, B) =>
      importActions.importClientsAction(
        `name,mobile,email,assignedtoemail\nCopy,${B.clientMobile},${B.clientEmail},${B.rm.email}`,
      ),
  },

  // --- Journeys ----------------------------------------------------------------
  {
    action: k("app/(dashboard)/journeys/actions", "saveJourneyGraphAction"),
    name: "overwrite B's journey",
    attack: (A, B) => journeys.saveJourneyGraphAction(B.ids.journey, graph),
    control: (A) => journeys.saveJourneyGraphAction(A.ids.journey, graph),
  },
  {
    action: k("app/(dashboard)/journeys/actions", "setJourneyActiveAction"),
    name: "activate B's journey",
    attack: (A, B) => journeys.setJourneyActiveAction(B.ids.journey, true),
    control: (A) => journeys.setJourneyActiveAction(A.ids.journey, true),
  },
  {
    action: k("app/(dashboard)/journeys/actions", "deleteJourneyAction"),
    name: "delete B's journey",
    attack: (A, B) => journeys.deleteJourneyAction(B.ids.journey),
    control: (A) => journeys.deleteJourneyAction(A.ids.journey),
  },
  {
    action: k("app/(dashboard)/journeys/actions", "enrollClientInJourneyAction"),
    name: "enroll B's client in own journey",
    attack: (A, B) => journeys.enrollClientInJourneyAction(A.ids.journey, B.ids.client),
    control: (A) => journeys.enrollClientInJourneyAction(A.ids.journey, A.ids.client),
  },
  {
    action: k("app/(dashboard)/journeys/actions", "enrollClientInJourneyAction"),
    name: "enroll own client in B's journey",
    attack: (A, B) => journeys.enrollClientInJourneyAction(B.ids.journey, A.ids.client),
  },

  // --- Notifications -----------------------------------------------------------
  {
    action: k("app/(dashboard)/notifications-actions", "markNotificationReadAction"),
    name: "mark B's notification read",
    attack: (A, B) => notifications.markNotificationReadAction(B.ids.notification),
    control: (A) => notifications.markNotificationReadAction(A.ids.notification),
  },
  {
    action: k("app/(dashboard)/notifications-actions", "markAllNotificationsReadAction"),
    name: "mark all read",
    attack: () => notifications.markAllNotificationsReadAction(),
  },
  {
    action: k("app/(dashboard)/notifications-actions", "getRecentNotificationsAction"),
    name: "list notifications",
    attack: () => notifications.getRecentNotificationsAction(),
  },
  {
    action: k("app/(dashboard)/notifications-actions", "getNewSlaBreachNotificationsAction"),
    name: "poll SLA notifications",
    as: "rm",
    attack: () => notifications.getNewSlaBreachNotificationsAction(new Date(0).toISOString()),
  },

  // --- Tasks -------------------------------------------------------------------
  {
    action: k("app/(dashboard)/tasks/actions", "createTaskAction"),
    name: "create task on B's client",
    attack: (A, B) =>
      tasks.createTaskAction(fd({ clientId: B.ids.client, title: "t", dueAt: "2030-01-01", assignedToId: A.ids.rmUser })),
    control: (A) =>
      tasks.createTaskAction(fd({ clientId: A.ids.client, title: "t", dueAt: "2030-01-01", assignedToId: A.ids.rmUser })),
  },
  {
    action: k("app/(dashboard)/tasks/actions", "createTaskAction"),
    name: "assign own task to B's user",
    attack: (A, B) =>
      tasks.createTaskAction(fd({ clientId: A.ids.client, title: "t", dueAt: "2030-01-01", assignedToId: B.ids.rmUser })),
  },
  {
    action: k("app/(dashboard)/tasks/actions", "completeTaskAction"),
    name: "complete B's task",
    attack: (A, B) => tasks.completeTaskAction(B.ids.task),
    control: (A) => tasks.completeTaskAction(A.ids.task),
  },

  // --- Settings ----------------------------------------------------------------
  {
    action: k("app/(dashboard)/settings/stages/actions", "updateStageAction"),
    name: "rename B's stage",
    attack: (A, B) => stages.updateStageAction(B.ids.stage, { name: "Hacked", slaHours: 1, isActive: true, isTerminal: false }),
    control: (A) => stages.updateStageAction(A.ids.stage, { name: "Renamed", slaHours: 1, isActive: true, isTerminal: false }),
  },
  {
    action: k("app/(dashboard)/settings/custom-fields/actions", "deleteCustomFieldAction"),
    name: "delete B's custom field",
    attack: (A, B) => customFields.deleteCustomFieldAction(B.ids.customField),
    control: (A) => customFields.deleteCustomFieldAction(A.ids.customField),
  },
  {
    action: k("app/(dashboard)/settings/templates/actions", "setTemplateApprovedAction"),
    name: "unapprove B's template",
    attack: (A, B) => templates.setTemplateApprovedAction(B.ids.template, false),
    control: (A) => templates.setTemplateApprovedAction(A.ids.template, false),
  },
  {
    action: k("app/(dashboard)/settings/templates/actions", "deleteTemplateAction"),
    name: "delete B's template",
    attack: (A, B) => templates.deleteTemplateAction(B.ids.template),
    control: (A) => templates.deleteTemplateAction(A.ids.template),
  },
  {
    action: k("app/(dashboard)/settings/developers/actions", "revokeApiKeyAction"),
    name: "revoke B's API key",
    attack: (A, B) => developers.revokeApiKeyAction(B.ids.apiKey),
    control: (A) => developers.revokeApiKeyAction(A.ids.apiKey),
  },
  {
    action: k("app/(dashboard)/settings/developers/actions", "deleteWebhookAction"),
    name: "delete B's webhook",
    attack: (A, B) => developers.deleteWebhookAction(B.ids.webhook),
    control: (A) => developers.deleteWebhookAction(A.ids.webhook),
  },
  {
    action: k("app/(dashboard)/settings/developers/actions", "toggleWebhookActiveAction"),
    name: "disable B's webhook",
    attack: (A, B) => developers.toggleWebhookActiveAction(B.ids.webhook, false),
    control: (A) => developers.toggleWebhookActiveAction(A.ids.webhook, false),
  },
  {
    action: k("app/(dashboard)/settings/integrations/actions", "setIntegrationModeAction"),
    name: "switch integration mode",
    attack: () => integrations.setIntegrationModeAction("freshdesk", "live"),
  },
  {
    action: k("app/(dashboard)/settings/integrations/actions", "saveIntegrationCredentialsAction"),
    name: "save integration credentials",
    attack: () => integrations.saveIntegrationCredentialsAction("freshdesk", { domain: "x", apiKey: "y" }),
  },
  {
    action: k("app/(dashboard)/settings/integrations/actions", "testIntegrationConnectionAction"),
    name: "test integration connection",
    attack: () => integrations.testIntegrationConnectionAction("freshdesk"),
  },
  {
    action: k("app/(dashboard)/settings/sso/actions", "saveSsoDomainAction"),
    name: "claim B's SSO domain",
    setup: async (A, B) => {
      await prisma.organization.update({ where: { id: B.organizationId }, data: { ssoDomain: `${B.organizationId}.example` } });
    },
    attack: (A, B) => sso.saveSsoDomainAction(fd({ domain: `${B.organizationId}.example` })),
  },
  {
    action: k("app/(dashboard)/settings/data/actions", "deleteOrganizationAction"),
    name: "delete B's organization by name",
    attack: (A, B) => data.deleteOrganizationAction(B.orgName),
  },

  // --- Users -------------------------------------------------------------------
  {
    action: k(USERS, "createUserAction"),
    name: "create user managed by B's admin",
    attack: (A, B) =>
      users.createUserAction(newUser({ managerId: B.admin.id })),
    control: () => users.createUserAction(newUser()),
  },
  {
    action: k(USERS, "setUserRoleAction"),
    name: "promote B's user",
    attack: (A, B) => users.setUserRoleAction(B.ids.rmUser, "ADMIN"),
    control: (A) => users.setUserRoleAction(A.ids.rmUser, "MANAGER"),
  },
  {
    action: k(USERS, "setUserManagerAction"),
    name: "re-parent B's user",
    attack: (A, B) => users.setUserManagerAction(B.ids.rmUser, A.admin.id),
    control: (A) => users.setUserManagerAction(A.ids.rmUser, A.admin.id),
  },
  {
    action: k(USERS, "setUserManagerAction"),
    name: "make B's admin manage own user",
    attack: (A, B) => users.setUserManagerAction(A.ids.rmUser, B.admin.id),
  },
  {
    action: k(USERS, "setUserActiveAction"),
    name: "deactivate B's user",
    attack: (A, B) => users.setUserActiveAction(B.ids.rmUser, false),
    control: (A) => users.setUserActiveAction(A.ids.rmUser, false),
  },
  {
    action: k(USERS, "setUserCapacityAction"),
    name: "change B's user capacity",
    attack: (A, B) => users.setUserCapacityAction(B.ids.rmUser, 9),
    control: (A) => users.setUserCapacityAction(A.ids.rmUser, 9),
  },
  {
    action: k(USERS, "resetUserPasswordAction"),
    name: "reset B's user password",
    attack: (A, B) => users.resetUserPasswordAction(B.ids.rmUser, "Password123!"),
    control: (A) => users.resetUserPasswordAction(A.ids.rmUser, "Password123!"),
  },

  // --- Platform admin ----------------------------------------------------------
  {
    action: k("app/admin/organizations/[id]/actions", "adjustSubscriptionAction"),
    name: "non-staff edits B's subscription",
    attack: (A, B) =>
      admin.adjustSubscriptionAction(
        fd({ organizationId: B.organizationId, product: "QA_SENTINEL", planId: "enterprise", status: "ACTIVE" }),
      ),
  },

  // --- QA Sentinel -------------------------------------------------------------
  {
    action: k("app/qa/reviews/actions", "createReviewAction"),
    name: "review using B's SOP",
    attack: (A, B) => reviews.createReviewAction(fd({ ticketId: "1001", sopId: B.ids.sop })),
  },
  {
    action: k("app/qa/reviews/actions", "createBulkReviewAction"),
    name: "bulk review using B's SOP",
    attack: (A, B) => reviews.createBulkReviewAction("1001", B.ids.sop),
  },
  {
    action: k("app/qa/reviews/actions", "saveAuditorCommentAction"),
    name: "comment on B's review",
    attack: (A, B) => reviews.saveAuditorCommentAction(B.ids.review, "x"),
    control: (A) => reviews.saveAuditorCommentAction(A.ids.review, "x"),
  },
  {
    action: k("app/qa/dsat/actions", "saveDsatCommentAction"),
    name: "comment on B's DSAT analysis",
    attack: (A, B) => dsat.saveDsatCommentAction(B.ids.dsat, "x"),
    control: (A) => dsat.saveDsatCommentAction(A.ids.dsat, "x"),
  },
  {
    action: k("app/qa/calibration/actions", "startCalibrationAction"),
    name: "start calibration on B's review",
    attack: (A, B) => calibration.startCalibrationAction(B.ids.review),
    control: (A) => calibration.startCalibrationAction(A.ids.review),
  },
  {
    action: k("app/qa/calibration/actions", "submitCalibrationEntryAction"),
    name: "score in B's calibration session",
    attack: (A, B) => calibration.submitCalibrationEntryAction(B.ids.calibration, scores()),
    control: (A) => calibration.submitCalibrationEntryAction(A.ids.calibration, scores()),
  },
  {
    action: k("app/qa/calibration/actions", "closeCalibrationSessionAction"),
    name: "close B's calibration session",
    attack: (A, B) => calibration.closeCalibrationSessionAction(B.ids.calibration),
    control: (A) => calibration.closeCalibrationSessionAction(A.ids.calibration),
  },
  {
    action: k("app/qa/settings/actions", "updateSopAction"),
    name: "edit B's SOP",
    attack: (A, B) => qaSettings.updateSopAction(B.ids.sop, fd({ name: "Hacked", content: "x" })),
    control: (A) => qaSettings.updateSopAction(A.ids.sop, fd({ name: "Edited", content: "x" })),
  },
  {
    action: k("app/qa/settings/actions", "deleteSopAction"),
    name: "delete B's SOP",
    attack: (A, B) => qaSettings.deleteSopAction(B.ids.sop),
  },
  {
    action: k("app/qa/settings/actions", "createSopAction"),
    name: "create SOP",
    attack: () => qaSettings.createSopAction(fd({ name: "Mine", content: "x" })),
  },
  {
    action: k("app/qa/settings/actions", "disconnectZendeskAction"),
    name: "disconnect Zendesk",
    attack: () => qaSettings.disconnectZendeskAction(),
  },
];

/**
 * Exported server actions with no isolation case, and why. The coverage test
 * fails on any action in neither list, so a new action can't ship untested.
 */
export const EXEMPT: Record<string, string> = {
  [k("app/(dashboard)/actions", "logoutAction")]: "acts only on the caller's own session",
  [k("app/(dashboard)/journeys/actions", "createJourneyAction")]: "takes no resource id; writes only to session org",
  [k("app/(dashboard)/settings/account/actions", "changeOwnPasswordAction")]: "acts only on the session user",
  [k("app/(dashboard)/settings/account/actions", "startTwoFactorSetupAction")]: "acts only on the session user",
  [k("app/(dashboard)/settings/account/actions", "confirmTwoFactorSetupAction")]: "acts only on the session user",
  [k("app/(dashboard)/settings/account/actions", "disableTwoFactorAction")]: "acts only on the session user",
  [k("app/(dashboard)/settings/account/actions", "regenerateRecoveryCodesAction")]: "acts only on the session user",
  [k("app/(dashboard)/settings/custom-fields/actions", "createCustomFieldAction")]: "takes no resource id; writes only to session org",
  [k("app/(dashboard)/settings/developers/actions", "createApiKeyAction")]: "takes no resource id; writes only to session org",
  [k("app/(dashboard)/settings/developers/actions", "createWebhookAction")]: "takes no resource id; writes only to session org",
  [k("app/(dashboard)/settings/sso/actions", "openSsoAdminPortalAction")]: "session org only; calls WorkOS",
  [k("app/(dashboard)/settings/stages/actions", "createStageAction")]: "takes no resource id; writes only to session org",
  [k("app/(dashboard)/settings/templates/actions", "createTemplateAction")]: "takes no resource id; writes only to session org",
  [k("app/billing/[product]/actions", "startCheckoutAction")]: "session org only; calls Stripe",
  [k("app/billing/actions", "manageBillingAction")]: "session org only; calls Stripe",
  [k("app/qa/dsat/actions", "submitDsatAction")]: "takes no resource id; calls the LLM (billing covered in billing.test.ts)",
  [k("app/qa/settings/actions", "connectZendeskAction")]: "session org only; calls Zendesk",
  [k("app/qa/settings/actions", "retestZendeskConnectionAction")]: "session org only; calls Zendesk",
  [k("app/forgot-password/actions", "forgotPasswordAction")]: "public auth flow",
  [k("app/login/actions", "loginAction")]: "public auth flow",
  [k("app/login/sso/actions", "startSsoLoginAction")]: "public auth flow",
  [k("app/login/sso/complete/actions", "completeSsoLoginAction")]: "public auth flow",
  [k("app/reset-password/[token]/actions", "resetPasswordAction")]: "public auth flow",
  [k("app/signup/actions", "signupAction")]: "public auth flow",
  [k("lib/auth/google-signin-action", "signInWithGoogleAction")]: "public auth flow",
  [k("lib/auth/resend-verification", "resendVerificationEmailAction")]: "acts only on the session user",
};
