import { z } from "zod";

// Scorecard types and pure helpers, safe to import from client components.
// Server-only lookups (plan gating, resolving an org's scorecard) live in ./scorecard.

export type ScorecardCriterion = {
  /** Stable machine key, used in criteria_scores (e.g. "tone_and_empathy"). */
  key: string;
  label: string;
  /** Tells the AI (and reviewers) what "good" looks like for this criterion. */
  description: string;
  /** Relative weight in the overall score (1–10). */
  weight: number;
  /** If set, a score below this fails the whole review (overall becomes 0). */
  autoFailBelow: number | null;
};

export type ResolvedScorecard = { id: string | null; name: string; criteria: ScorecardCriterion[] };

export const MAX_CRITERIA = 12;

/** Built-in scorecard: the original five criteria, equally weighted. Used on Starter and for older reviews. */
export const DEFAULT_SCORECARD: ResolvedScorecard = {
  id: null,
  name: "Standard",
  criteria: [
    { key: "sop_adherence", label: "SOP Adherence", description: "Follows the steps and policies in the SOP.", weight: 1, autoFailBelow: null },
    { key: "tone_and_empathy", label: "Tone & Empathy", description: "Courteous, empathetic and on-brand throughout.", weight: 1, autoFailBelow: null },
    { key: "accuracy", label: "Accuracy", description: "Information and actions given to the customer are correct.", weight: 1, autoFailBelow: null },
    { key: "resolution_quality", label: "Resolution Quality", description: "The customer's problem is actually solved, or clearly progressed.", weight: 1, autoFailBelow: null },
    { key: "response_completeness", label: "Response Completeness", description: "Every question the customer asked is answered.", weight: 1, autoFailBelow: null },
  ],
};

export function criterionKey(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "criterion"
  );
}

export const criterionInputSchema = z.object({
  label: z.string().trim().min(1, "Every criterion needs a name").max(60, "Criterion names must be 60 characters or fewer"),
  description: z.string().trim().max(400, "Descriptions must be 400 characters or fewer").default(""),
  weight: z.coerce.number().int().min(1, "Weights must be 1–10").max(10, "Weights must be 1–10"),
  autoFailBelow: z.coerce.number().int().min(1).max(100).nullable().default(null),
});

export const scorecardInputSchema = z.object({
  name: z.string().trim().min(1, "Give the scorecard a name").max(80),
  criteria: z
    .array(criterionInputSchema)
    .min(1, "Add at least one criterion")
    .max(MAX_CRITERIA, `A scorecard can have up to ${MAX_CRITERIA} criteria`),
});

/** Validates editor input and assigns unique keys. */
export function normalizeCriteria(input: z.input<typeof criterionInputSchema>[]): ScorecardCriterion[] {
  const parsed = scorecardInputSchema.shape.criteria.parse(input);
  const used = new Set<string>();
  return parsed.map((c) => {
    let key = criterionKey(c.label);
    for (let i = 2; used.has(key); i++) key = `${criterionKey(c.label)}_${i}`;
    used.add(key);
    return { key, label: c.label, description: c.description, weight: c.weight, autoFailBelow: c.autoFailBelow };
  });
}

/** Parses stored criteria JSON defensively (bad rows fall back to the default scorecard). */
export function parseCriteria(value: unknown): ScorecardCriterion[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: ScorecardCriterion[] = [];
  for (const raw of value) {
    const c = raw as Partial<ScorecardCriterion>;
    if (typeof c?.key !== "string" || typeof c.label !== "string") return null;
    out.push({
      key: c.key,
      label: c.label,
      description: typeof c.description === "string" ? c.description : "",
      weight: typeof c.weight === "number" && c.weight > 0 ? c.weight : 1,
      autoFailBelow: typeof c.autoFailBelow === "number" ? c.autoFailBelow : null,
    });
  }
  return out;
}

/** Criteria a stored review was scored with (snapshot, or the built-in set for older reviews). */
export function reviewCriteria(snapshot: unknown): ScorecardCriterion[] {
  return parseCriteria((snapshot as { criteria?: unknown } | null)?.criteria) ?? DEFAULT_SCORECARD.criteria;
}

export type ScoreResult = { overall: number; autoFailed: boolean; autoFailReasons: string[] };

/**
 * Weighted overall score, computed by Supportify (not the model) so it's
 * consistent and auditable. Missing criteria are ignored; any auto-fail
 * criterion under its threshold makes the overall 0.
 */
export function computeScore(criteria: ScorecardCriterion[], scores: Record<string, number | null | undefined>): ScoreResult {
  let weighted = 0;
  let totalWeight = 0;
  const autoFailReasons: string[] = [];
  for (const c of criteria) {
    const raw = scores[c.key];
    if (typeof raw !== "number" || Number.isNaN(raw)) continue;
    const score = Math.min(100, Math.max(0, raw));
    weighted += score * c.weight;
    totalWeight += c.weight;
    if (c.autoFailBelow != null && score < c.autoFailBelow) autoFailReasons.push(c.label);
  }
  const overall = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
  return autoFailReasons.length > 0 ? { overall: 0, autoFailed: true, autoFailReasons } : { overall, autoFailed: false, autoFailReasons };
}
