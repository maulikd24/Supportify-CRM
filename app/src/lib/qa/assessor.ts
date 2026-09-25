import Anthropic from "@anthropic-ai/sdk";

/**
 * Ported 1:1 from qa-tool-reference/app/assessor.py (the standalone QA_Tool
 * prototype). Keep prompt wording and JSON shapes identical to that source —
 * they're what the scoring-quality diff script compares against.
 */

export type ConversationTurn = {
  role: "customer" | "agent";
  body: string;
  author?: string | number;
  created_at?: string;
  public?: boolean;
};

const MODEL = "claude-sonnet-4-6";

function makeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your environment and restart the server.",
    );
  }
  return new Anthropic({ apiKey });
}

// All scoreable criteria in display order
export const ALL_CRITERIA: [string, string][] = [
  ["sop_adherence", "SOP Adherence"],
  ["tone_and_empathy", "Tone & Empathy"],
  ["accuracy", "Accuracy"],
  ["resolution_quality", "Resolution Quality"],
  ["response_completeness", "Response Completeness"],
];

const SYSTEM_PROMPT = `You are an expert Quality Assurance reviewer for customer support teams.
Evaluate support agent conversations against Standard Operating Procedures (SOPs).
Be objective, fair, and specific. Score each criterion 0-100.
Always respond with valid JSON only — no markdown fences, no prose outside the JSON.`;

function buildAssessmentPrompt(params: {
  sopsBlock: string;
  subject: string;
  status: string;
  priority: string;
  conversation: string;
  excludedCriteria: string[];
}): string {
  const excluded = new Set(params.excludedCriteria ?? []);
  const included = ALL_CRITERIA.filter(([key]) => !excluded.has(key));

  const criteriaLines = included.map(([key]) => `    "${key}": <integer 0-100>`).join("\n");

  let exclusionNote = "";
  if (excluded.size > 0) {
    const excludedLabels = ALL_CRITERIA.filter(([key]) => excluded.has(key)).map(([, label]) => label);
    exclusionNote =
      `NOTE: The following criteria are EXCLUDED from this assessment and must NOT ` +
      `appear in criteria_scores: ${excludedLabels.join(", ")}. ` +
      `The overall_score must be the average of the INCLUDED criteria only.\n\n`;
  }

  return `Review this support ticket and evaluate the agent against the SOP(s) below.

## SOP(s) Applied
${params.sopsBlock}

## Ticket
- Subject: ${params.subject}
- Status: ${params.status}
- Priority: ${params.priority}

## Conversation
${params.conversation}

## Instructions
${exclusionNote}Return exactly this JSON structure — no extra keys, no markdown:

{
  "overall_score": <integer 0-100, average of the INCLUDED criteria only>,
  "criteria_scores": {
${criteriaLines}
  },
  "summary":    "<2-3 sentence overall assessment>",
  "strengths":  ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>"],
  "accuracy_detail": {
    "accurate_items":          ["<specific fact, info, or step the agent got right>"],
    "inaccurate_items":        ["<specific incorrect info, wrong answer, or mistake — empty array if none>"],
    "improvement_suggestions": ["<concrete action the agent can take to be more accurate>"]
  },
  "sop_violations": ["<SOP step missed/violated — empty array if none>"],
  "sentiment": {
    "overall":   "<positive|neutral|negative>",
    "score":     <integer -100 to 100>,
    "customer_sentiment": "<positive|neutral|negative>",
    "agent_sentiment":    "<positive|neutral|negative>",
    "tone_shift": "<describe any notable shift in tone during the conversation, or 'none'>",
    "turns": [
      {"role": "<customer|agent>", "sentiment": "<positive|neutral|negative>", "note": "<brief note>"}
    ]
  }
}

Scoring guide: 90-100 Excellent · 75-89 Good · 60-74 Acceptable · 40-59 Below standard · 0-39 Poor
`;
}

function buildSopsBlock(sops: { name: string; content: string }[]): string {
  return sops
    .map((sop, i) => {
      const prefix = sops.length > 1 ? `### SOP ${i + 1}: ${sop.name}` : `### ${sop.name}`;
      return `${prefix}\n${sop.content}`;
    })
    .join("\n\n");
}

export function formatConversation(conversation: ConversationTurn[]): string {
  return conversation.map((m) => `[${m.role.toUpperCase()}]: ${m.body.trim()}`).join("\n\n");
}

/**
 * Parse free-form pasted conversation text into structured turns. Supports:
 *   [CUSTOMER]: / [AGENT]:  — bracket labels
 *   Customer: / Agent:      — colon labels
 *   Plain paragraphs        — alternates customer/agent by blank line
 */
export function parseManualConversation(text: string): ConversationTurn[] {
  const rolePattern = /^\s*\[?(customer|agent|support|user|rep|operator)\]?\s*:\s*(.*)$/i;
  const lines = text.trim().split("\n");
  const hasLabels = lines.some((l) => rolePattern.test(l));

  if (hasLabels) {
    const turns: ConversationTurn[] = [];
    let currentRole: "customer" | "agent" | null = null;
    let currentBody: string[] = [];

    const flush = () => {
      if (currentRole && currentBody.length > 0) {
        const body = currentBody.join("\n").trim();
        if (body) turns.push({ role: currentRole, body });
      }
    };

    for (const line of lines) {
      const m = rolePattern.exec(line);
      if (m) {
        flush();
        const raw = m[1].toLowerCase();
        currentRole = ["agent", "support", "rep", "operator"].includes(raw) ? "agent" : "customer";
        currentBody = [m[2]];
      } else {
        currentBody.push(line);
      }
    }
    flush();
    return turns;
  }

  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((body, i) => ({ role: i % 2 === 0 ? "customer" : "agent", body }));
}

function cleanJson(raw: string): string {
  let text = raw;
  if (text.startsWith("```")) {
    text = text.split("```")[1] ?? text;
    if (text.startsWith("json")) text = text.slice(4);
  }
  return text.trim();
}

/**
 * Best-effort repair of JSON truncated mid-string (e.g. token-limit cut-off).
 * Drops the incomplete trailing string value, then closes any open
 * arrays/objects in the correct order.
 */
function repairTruncatedJson(raw: string): string {
  let text = raw.replace(/\s+$/, "");

  text = text.replace(/"\s*$/, ""); // cut bare open quote at end
  text = text.replace(/:\s*"[^"]*$/, ": null"); // cut "key": "unterminated...
  text = text.replace(/,\s*"[^"]*$/, ""); // cut ,"unterminated... in array/obj
  text = text.replace(/\s+$/, "").replace(/,$/, ""); // trailing comma left behind

  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;
  for (const ch of text) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
    } else if ((ch === "}" || ch === "]") && stack.length > 0) {
      stack.pop();
    }
  }

  return text + stack.reverse().join("");
}

function safeParseJson<T>(raw: string): T {
  const cleaned = cleanJson(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const repaired = repairTruncatedJson(cleaned);
    try {
      return JSON.parse(repaired) as T;
    } catch (exc) {
      throw new Error(
        `The analyser returned malformed JSON that could not be repaired. ` +
          `Try shortening the conversation or removing noisy content. (Detail: ${exc})`,
      );
    }
  }
}

const DSAT_SYSTEM_PROMPT = `You are a senior customer experience specialist helping support teams recover dissatisfied customers.
Analyse support ticket conversations to identify root causes of dissatisfaction and create actionable recovery plans.
Always respond with valid JSON only — no markdown fences, no prose outside the JSON.`;

function buildDsatPrompt(params: { subject: string; customerName: string; context: string; conversation: string }): string {
  return `Analyse this DSAT (dissatisfied) support ticket and provide a detailed recovery plan.

## Ticket Details
- Subject: ${params.subject}
- Customer Name: ${params.customerName}
- Additional Context: ${params.context}

## Conversation
${params.conversation}

## Instructions
Return exactly this JSON structure — no extra keys, no markdown:

{
  "root_causes": [
    {"issue": "<specific issue that caused dissatisfaction>", "severity": "<high|medium|low>", "category": "<response_time|incorrect_info|lack_of_empathy|unresolved_issue|process_failure|communication|other>"}
  ],
  "what_went_wrong": "<2-4 sentence clear narrative of why this ticket resulted in a DSAT rating>",
  "customer_impact": "<1-2 sentences on how this issue affected the customer>",
  "csat_recovery_recommendations": [
    {"action": "<specific action to take>", "priority": "<immediate|short_term|long_term>", "owner": "<agent|team_lead|management|product>", "rationale": "<why this will help recover satisfaction>"}
  ],
  "follow_up_response": {
    "subject": "<suggested email/message subject line>",
    "body": "<professional, empathetic follow-up message to send to the customer — ready to use, personalised with their name and issue details, focused on recovery and resolution>"
  },
  "prevention_tips": ["<tip to prevent similar DSATs in future>"],
  "recovery_probability": "<high|medium|low>",
  "recovery_rationale": "<1-2 sentences on why this rating was given>"
}
`;
}

export type DsatResult = {
  root_causes: { issue: string; severity: string; category: string }[];
  what_went_wrong: string;
  customer_impact: string;
  csat_recovery_recommendations: { action: string; priority: string; owner: string; rationale: string }[];
  follow_up_response: { subject: string; body: string };
  prevention_tips: string[];
  recovery_probability: string;
  recovery_rationale: string;
};

export async function analyzeDsat(params: {
  conversation: ConversationTurn[];
  subject?: string;
  customerName?: string;
  context?: string;
}): Promise<DsatResult> {
  const client = makeClient();
  const prompt = buildDsatPrompt({
    subject: params.subject || "N/A",
    customerName: params.customerName || "the customer",
    context: params.context || "None provided",
    conversation: formatConversation(params.conversation),
  });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: DSAT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "";
  return safeParseJson<DsatResult>(text);
}

export type AssessmentResult = {
  overall_score: number;
  criteria_scores: Record<string, number>;
  summary: string;
  strengths: string[];
  improvements: string[];
  accuracy_detail: {
    accurate_items: string[];
    inaccurate_items: string[];
    improvement_suggestions: string[];
  };
  sop_violations: string[];
  sentiment: {
    overall: string;
    score: number;
    customer_sentiment: string;
    agent_sentiment: string;
    tone_shift: string;
    turns: { role: string; sentiment: string; note: string }[];
  };
};

export type AssessmentUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
};

export async function assessTicket(params: {
  ticket: { subject?: string; status?: string; priority?: string };
  conversation: ConversationTurn[];
  sops: { name: string; content: string }[];
  excludedCriteria?: string[];
}): Promise<{ result: AssessmentResult; usage: AssessmentUsage }> {
  const prompt = buildAssessmentPrompt({
    sopsBlock: buildSopsBlock(params.sops),
    subject: params.ticket.subject || "N/A",
    status: params.ticket.status || "N/A",
    priority: params.ticket.priority || "N/A",
    conversation: formatConversation(params.conversation),
    excludedCriteria: params.excludedCriteria ?? [],
  });

  const client = makeClient();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "";
  const result = safeParseJson<AssessmentResult>(text);

  const costUsd = (message.usage.input_tokens / 1_000_000) * 3.0 + (message.usage.output_tokens / 1_000_000) * 15.0;
  const usage: AssessmentUsage = {
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
    total_tokens: message.usage.input_tokens + message.usage.output_tokens,
    cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
  };

  return { result, usage };
}
