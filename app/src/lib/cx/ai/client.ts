import Anthropic from "@anthropic-ai/sdk";

/**
 * Every CX call to Claude goes through here, so tests stub one module and the model is a
 * single setting. Classification runs through Message Batches (half price, results within
 * hours) except on plans with real-time analysis; discovery and other low-volume work is
 * real-time with Anthropic's server-side refusal fallback.
 */

/** The model for each CX task (your decision: Opus 5.5 throughout). */
export const CX_MODELS = {
  classify: "claude-opus-5-5",
  discover: "claude-opus-5-5",
} as const;

/** $ per million tokens by the model that actually served the request. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** What a request cost; batched requests are billed at half price. */
export function costUsd(model: string, usage: Usage, { batch = false } = {}): number {
  const p = PRICING[model] ?? PRICING[CX_MODELS.classify];
  const raw =
    (usage.input_tokens * p.input +
      (usage.cache_creation_input_tokens ?? 0) * p.input * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * p.input * 0.1 +
      usage.output_tokens * p.output) /
    1_000_000;
  return Math.round(raw * (batch ? 0.5 : 1) * 1_000_000) / 1_000_000;
}

export class CxModelError extends Error {}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client() {
  return new Anthropic({ timeout: 120_000, maxRetries: 2 });
}

/** A JSON-schema structured-output request body (shared by real-time calls and batches). */
export type JsonRequest = {
  model: string;
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  /** Mark the system prompt for prompt caching (it repeats across many requests). */
  cacheSystem?: boolean;
};

export function requestParams(req: JsonRequest) {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: "text" as const, text: req.system, ...(req.cacheSystem ? { cache_control: { type: "ephemeral" as const } } : {}) }],
    output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema: req.jsonSchema } },
    messages: [{ role: "user" as const, content: req.prompt }],
  };
}

/** The JSON text of a finished response, or an error saying why there isn't one. */
export function jsonText(message: { stop_reason: string | null; content: { type: string; text?: string }[] }): string {
  if (message.stop_reason === "refusal") throw new CxModelError("The model declined this request");
  if (message.stop_reason === "max_tokens") throw new CxModelError("The response was cut off");
  const text = message.content.find((b) => b.type === "text")?.text;
  if (!text) throw new CxModelError("The response had no text");
  return text;
}

/** One real-time structured request, retried on another model if a safety filter declines it. */
export async function requestJson(req: JsonRequest): Promise<{ json: unknown; model: string; usage: Usage }> {
  const message = await client().beta.messages.create({
    ...requestParams(req),
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  return { json: JSON.parse(jsonText(message)), model: message.model, usage: message.usage };
}

export type BatchRequest = { custom_id: string; params: ReturnType<typeof requestParams> };

export async function createBatch(requests: BatchRequest[]): Promise<{ id: string }> {
  // Server-side fallbacks aren't accepted on the Batches API; a declined item comes back as
  // a refusal and is marked failed.
  const batch = await client().messages.batches.create({ requests });
  return { id: batch.id };
}

export async function getBatchStatus(id: string): Promise<"in_progress" | "canceling" | "ended"> {
  return (await client().messages.batches.retrieve(id)).processing_status;
}

export type BatchItem =
  | { customId: string; type: "succeeded"; message: { model: string; stop_reason: string | null; content: { type: string; text?: string }[]; usage: Usage } }
  | { customId: string; type: "errored" | "canceled" | "expired"; error?: string };

export async function* batchResults(id: string): AsyncGenerator<BatchItem> {
  for await (const r of await client().messages.batches.results(id)) {
    if (r.result.type === "succeeded") {
      const m = r.result.message;
      yield { customId: r.custom_id, type: "succeeded", message: { model: m.model, stop_reason: m.stop_reason, content: m.content as { type: string; text?: string }[], usage: m.usage } };
    } else {
      yield { customId: r.custom_id, type: r.result.type, error: r.result.type === "errored" ? r.result.error.error.type : undefined };
    }
  }
}
