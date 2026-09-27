import type { BadgeProps } from "@/components/ui/badge";

type Variant = NonNullable<BadgeProps["variant"]>;

/** Badge styling for CRM enums, shared by the client list and client detail pages. */
export const CLIENT_STATUS_VARIANT: Record<string, Variant> = {
  ACTIVE: "success",
  ON_HOLD: "warning",
  COMPLETED: "soft",
  NOT_PROCEEDING: "destructive",
};

export const PRIORITY_VARIANT: Record<string, Variant> = {
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "secondary",
};

export const SLA_VARIANT: Record<string, Variant> = {
  ON_TRACK: "success",
  DUE_SOON: "warning",
  OVERDUE: "destructive",
  NOT_APPLICABLE: "secondary",
};

export function humanize(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
