import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type HandbookSection = {
  id: string;
  title: string;
  body: string[];
};

type HandbookGroup = {
  id: string;
  label: string;
  sections: HandbookSection[];
};

const GROUPS: HandbookGroup[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    sections: [
      {
        id: "organizations-trials",
        title: "Organizations & trials",
        body: [
          "Every account belongs to one Organization. The person who signs up becomes its Owner and first Admin — Owner controls billing across both products, Admin controls day-to-day CRM configuration.",
          "New organizations get a 14-day free trial on whichever product(s) they chose at signup, no card required. You can add the other product at any time from Billing.",
        ],
      },
      {
        id: "choosing-products",
        title: "Choosing your products",
        body: [
          "Supportify ships two independent products: QA Sentinel (AI review of support tickets) and CRM (sales pipeline & client management). You can run either one alone or both together under the same organization and login.",
          "Each product has its own subscription, plan, and usage — a trial or cancellation on one never affects the other.",
        ],
      },
    ],
  },
  {
    id: "crm",
    label: "CRM",
    sections: [
      {
        id: "dashboard",
        title: "Dashboard",
        body: ["Your CRM home page — active/new clients, tasks due today, overdue items, pipeline value, and recently won deals at a glance."],
      },
      {
        id: "clients-pipeline",
        title: "Clients & Pipeline",
        body: [
          "Clients is where every lead and account lives, filterable by stage, priority, SLA status, assigned rep, and more.",
          "Each client moves through your organization's configured Stages — opening a client shows its full history, documents, and available next actions.",
        ],
      },
      {
        id: "custom-fields",
        title: "Custom Fields",
        body: ["Add extra fields to every client record that are specific to how your team works — no hardcoded schema to work around. Configure these under Settings → Custom Fields."],
      },
      {
        id: "stages",
        title: "Stages",
        body: [
          "Define your own pipeline stages instead of being locked into someone else's sales process. Mark any stage as terminal — moving a client there automatically marks it Completed.",
        ],
      },
      {
        id: "tasks",
        title: "Tasks",
        body: ["Follow-up work tied to clients and reps, with due dates and SLA tracking so nothing slips through."],
      },
      {
        id: "journeys",
        title: "Journeys & Automation",
        body: ["Trigger-based workflows that automatically move clients, create tasks, or send follow-ups as they progress through your pipeline — build them visually and attach them to any stage change."],
      },
      {
        id: "reports",
        title: "Reports",
        body: ["Pipeline analytics: stage funnel, stage-to-stage conversion rates, and bottleneck analysis to see where deals are getting stuck."],
      },
      {
        id: "copilot",
        title: "Co-pilot",
        body: ["An AI assistant surface that summarizes your open work and suggests what to prioritize next across your assigned clients and tasks."],
      },
      {
        id: "templates",
        title: "Templates",
        body: ["Reusable message templates for client communication, configured under Settings → Templates."],
      },
      {
        id: "users-roles",
        title: "Users & Roles",
        body: [
          "Admins manage the team under Settings → Users. Three roles exist: Admin (full configuration access), Manager (team-wide visibility and journeys/reports), and RM (their own clients and tasks).",
          "Seats are limited by your CRM plan — check current usage on the Billing page.",
        ],
      },
      {
        id: "integrations",
        title: "Integrations",
        body: ["Connect external providers and configure outgoing webhook URLs under Settings → Integrations."],
      },
      {
        id: "developers-api",
        title: "Developers & API",
        body: ["Generate API keys and manage webhooks for programmatic access to your CRM data under Settings → Developers."],
      },
      {
        id: "sso",
        title: "Single Sign-On",
        body: ["Configure SAML/SSO login for your organization's domain under Settings → Single Sign-On (Enterprise plans)."],
      },
      {
        id: "audit-log",
        title: "Audit Log",
        body: ["A record of every change made to your organization's data — who changed what, and when. Useful for compliance reviews."],
      },
      {
        id: "data-privacy",
        title: "Data & Privacy",
        body: ["Export your organization's CRM data under Settings → Data & Privacy."],
      },
      {
        id: "account",
        title: "Account",
        body: ["Manage your own name, password, two-factor authentication, and notification preferences under Settings → Account."],
      },
    ],
  },
  {
    id: "qa-sentinel",
    label: "QA Sentinel",
    sections: [
      {
        id: "qa-overview",
        title: "Overview",
        body: ["Your QA Sentinel home page — reviews run, average score, and recent activity at a glance."],
      },
      {
        id: "qa-reviews",
        title: "Reviews",
        body: [
          "Every ticket review Claude has scored against your SOPs, filterable by agent. Each review shows a 0–100 score with a written rationale across SOP Adherence, Tone & Empathy, Accuracy, Resolution Quality, and Response Completeness.",
        ],
      },
      {
        id: "calibration",
        title: "Calibration",
        body: ["Calibration sessions let multiple reviewers score the same ticket independently, then compare results — the fastest way to keep your whole team applying the same rubric consistently."],
      },
      {
        id: "agents",
        title: "Agent Scorecards",
        body: ["Aggregate QA performance per agent over time, sorted lowest-average-first so coaching priorities are obvious at a glance."],
      },
      {
        id: "dsat",
        title: "DSAT",
        body: ["Automatic root-cause analysis on tickets from dissatisfied customers — surfaces patterns behind low CSAT instead of leaving you to read every negative ticket by hand."],
      },
      {
        id: "qa-settings",
        title: "Settings",
        body: [
          "Connect your Zendesk account so QA Sentinel can pull ticket conversations directly — no copy-pasting transcripts.",
          "Upload and manage the Standard Operating Procedures (SOPs) that every review is scored against; update them any time to change what \"good\" looks like for your team.",
        ],
      },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    sections: [
      {
        id: "how-billing-works",
        title: "How trials, plans, and quotas work",
        body: [
          "QA Sentinel plans are priced by reviews run per month; CRM plans are priced by number of team members (seats). Both start with a 14-day free trial, no card required.",
          "The Billing page shows your current plan, usage against your quota or seat limit, and renewal date for each product. Use \"Change plan\" to upgrade, downgrade, or start a subscription, and \"Manage billing\" to reach the Stripe portal for invoices and payment methods.",
        ],
      },
    ],
  },
];

export function HandbookContent() {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <nav className="flex shrink-0 flex-col gap-4 lg:sticky lg:top-6 lg:w-56">
        {GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-1">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
            {group.sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {section.title}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-8">
        {GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-4">
            <h2 className="font-heading text-lg font-semibold">{group.label}</h2>
            <div className="flex flex-col gap-4">
              {group.sections.map((section) => (
                <Card key={section.id} id={section.id} className="scroll-mt-20">
                  <CardHeader>
                    <CardTitle className="text-base">{section.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
                    {section.body.map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
