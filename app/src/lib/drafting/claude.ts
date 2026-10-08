import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/**
 * The one place the drafting feature talks to Claude (kept separate so tests can stub it).
 * Short, structured replies: low effort, a JSON schema for the output, and Anthropic's
 * server-side fallback so a safety-classifier decline on one model is retried on another
 * instead of failing the RM's click.
 */

export const DRAFT_MODEL = "claude-opus-5-5";

/** $ per million tokens, by the model that actually served the request (fallbacks may switch it). */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export class DraftModelError extends Error {}

export function draftingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type ModelDraft<T> = { output: T; model: string; inputTokens: number; outputTokens: number; costUsd: number };

export async function requestDraft<S extends z.ZodType>(params: {
  system: string;
  prompt: string;
  schema: S;
}): Promise<ModelDraft<z.infer<S>>> {
  const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  const response = await client.beta.messages.parse({
    model: DRAFT_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(params.schema) },
    system: params.system,
    messages: [{ role: "user", content: params.prompt }],
  });

  if (response.stop_reason === "refusal") throw new DraftModelError("The model declined to draft this reply");
  if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
    throw new DraftModelError(`No usable draft (stop reason: ${response.stop_reason})`);
  }

  const usage = response.usage;
  const price = PRICING[response.model] ?? PRICING[DRAFT_MODEL];
  const inputTokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const costUsd =
    (usage.input_tokens * price.input +
      (usage.cache_creation_input_tokens ?? 0) * price.input * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * price.input * 0.1 +
      usage.output_tokens * price.output) /
    1_000_000;

  return {
    output: response.parsed_output as z.infer<S>,
    model: response.model,
    inputTokens,
    outputTokens: usage.output_tokens,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
  };
}
