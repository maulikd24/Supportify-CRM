import type { BadgeProps } from "@/components/ui/badge";

type Variant = NonNullable<BadgeProps["variant"]>;

/** Scores below this are flagged for coaching across QA Sentinel. */
export const LOW_SCORE = 70;

export function scoreVariant(score: number | null): Variant {
  if (score === null) return "secondary";
  if (score >= 75) return "success";
  if (score >= 50) return "warning";
  return "destructive";
}

export function probabilityVariant(prob: string | null): Variant {
  if (prob === "high") return "success";
  if (prob === "medium") return "warning";
  return "destructive";
}
