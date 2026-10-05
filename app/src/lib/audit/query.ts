import type { Prisma } from "@/generated/prisma/client";

export const AUDIT_CATEGORIES = {
  signin: { label: "Sign-in", prefixes: ["auth."] },
  team: { label: "Team", prefixes: ["user."] },
  settings: { label: "Settings", prefixes: ["security.", "sso.", "api_key.", "webhook.", "alerts.", "integration.", "zendesk.", "helpdesk.", "qa."] },
  data: { label: "Data", prefixes: ["data."] },
  billing: { label: "Billing", prefixes: ["billing.", "platform_admin_"] },
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORIES | "records";

export type AuditFilters = { category?: string; from?: string; to?: string; q?: string };

const NAMESPACED = Object.values(AUDIT_CATEGORIES).flatMap((c) => c.prefixes);

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Shared by the audit-log page and its CSV export so both always show the same rows. */
export function auditWhere(organizationId: string, filters: AuditFilters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [{ organizationId }];

  if (filters.category && filters.category in AUDIT_CATEGORIES) {
    const prefixes = AUDIT_CATEGORIES[filters.category as keyof typeof AUDIT_CATEGORIES].prefixes;
    and.push({ OR: prefixes.map((p) => ({ action: { startsWith: p } })) });
  } else if (filters.category === "records") {
    // Client/record history (stage changes, merges, …): everything not in a named category.
    and.push({ NOT: { OR: NAMESPACED.map((p) => ({ action: { startsWith: p } })) } });
  }

  const from = parseDate(filters.from);
  const to = parseDate(filters.to, true);
  if (from || to) and.push({ timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });

  const q = filters.q?.trim();
  if (q) {
    and.push({
      OR: [
        { actorEmail: { contains: q, mode: "insensitive" } },
        { user: { name: { contains: q, mode: "insensitive" } } },
        { entityId: q },
        { ipAddress: q },
      ],
    });
  }
  return { AND: and };
}

export function summarizeAuditValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(", ");
  }
  return String(value);
}
