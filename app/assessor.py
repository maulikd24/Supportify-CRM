import json
import re
import anthropic
from app.config import settings


def _make_client() -> anthropic.Anthropic:
    if not settings.anthropic_api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY is not set. "
            "Copy .env.example → .env, add your key from https://console.anthropic.com/settings/keys, "
            "and restart the server."
        )
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


# All scoreable criteria in display order
ALL_CRITERIA = [
    ("sop_adherence",         "SOP Adherence"),
    ("tone_and_empathy",      "Tone & Empathy"),
    ("accuracy",              "Accuracy"),
    ("resolution_quality",    "Resolution Quality"),
    ("response_completeness", "Response Completeness"),
]

SYSTEM_PROMPT = """You are an expert Quality Assurance reviewer for customer support teams.
Evaluate support agent conversations against Standard Operating Procedures (SOPs).
Be objective, fair, and specific. Score each criterion 0-100.
Always respond with valid JSON only — no markdown fences, no prose outside the JSON."""

ASSESSMENT_TEMPLATE = """Review this support ticket and evaluate the agent against the SOP(s) below.

## SOP(s) Applied
{{sops_block}}

## Ticket
- Subject: {{subject}}
- Status: {{status}}
- Priority: {{priority}}

## Conversation
{{conversation}}

## Instructions
{exclusion_note}Return exactly this JSON structure — no extra keys, no markdown:

{{{{
  "overall_score": <integer 0-100, average of the INCLUDED criteria only>,
  "criteria_scores": {{{{
{criteria_lines}
  }}}},
  "summary":    "<2-3 sentence overall assessment>",
  "strengths":  ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>"],
  "sop_violations": ["<SOP step missed/violated — empty array if none>"],
  "sentiment": {{{{
    "overall":   "<positive|neutral|negative>",
    "score":     <integer -100 to 100>,
    "customer_sentiment": "<positive|neutral|negative>",
    "agent_sentiment":    "<positive|neutral|negative>",
    "tone_shift": "<describe any notable shift in tone during the conversation, or 'none'>",
    "turns": [
      {{{{"role": "<customer|agent>", "sentiment": "<positive|neutral|negative>", "note": "<brief note>"}}}}
    ]
  }}}}
}}}}

Scoring guide: 90-100 Excellent · 75-89 Good · 60-74 Acceptable · 40-59 Below standard · 0-39 Poor
"""


def _build_assessment_prompt(
    sops_block: str,
    subject: str,
    status: str,
    priority: str,
    conversation: str,
    excluded_criteria: list[str],
) -> str:
    """Build the assessment prompt, omitting excluded criteria from scoring."""
    excluded = set(excluded_criteria or [])
    included = [(k, l) for k, l in ALL_CRITERIA if k not in excluded]

    criteria_lines = "\n".join(
        f'    "{key}": <integer 0-100>' for key, _ in included
    )
    if excluded:
        excluded_labels = [l for k, l in ALL_CRITERIA if k in excluded]
        exclusion_note = (
            f"NOTE: The following criteria are EXCLUDED from this assessment and must NOT "
            f"appear in criteria_scores: {', '.join(excluded_labels)}. "
            f"The overall_score must be the average of the INCLUDED criteria only.\n\n"
        )
    else:
        exclusion_note = ""

    template = ASSESSMENT_TEMPLATE.format(
        criteria_lines=criteria_lines,
        exclusion_note=exclusion_note,
    )
    return template.format(
        sops_block=sops_block,
        subject=subject,
        status=status,
        priority=priority,
        conversation=conversation,
    )


def _build_sops_block(sops: list[dict]) -> str:
    """Combine one or more SOPs into a single prompt block."""
    blocks = []
    for i, sop in enumerate(sops, 1):
        prefix = f"### SOP {i}: {sop['name']}" if len(sops) > 1 else f"### {sop['name']}"
        blocks.append(f"{prefix}\n{sop['content']}")
    return "\n\n".join(blocks)


def format_conversation(conversation: list[dict]) -> str:
    return "\n\n".join(
        f"[{m['role'].upper()}]: {m['body'].strip()}"
        for m in conversation
    )


def parse_manual_conversation(text: str) -> list[dict]:
    """
    Parse free-form pasted conversation text into structured turns.
    Supports:
      [CUSTOMER]: / [AGENT]:  — bracket labels
      Customer: / Agent:      — colon labels
      Plain paragraphs        — alternates customer/agent by blank line
    """
    role_pattern = re.compile(
        r"^\s*\[?(customer|agent|support|user|rep|operator)\]?\s*:\s*(.*)$",
        re.IGNORECASE,
    )
    lines = text.strip().splitlines()
    has_labels = any(role_pattern.match(l) for l in lines)

    if has_labels:
        turns, current_role, current_body = [], None, []

        def flush():
            if current_role and current_body:
                body = "\n".join(current_body).strip()
                if body:
                    turns.append({"role": current_role, "body": body})

        for line in lines:
            m = role_pattern.match(line)
            if m:
                flush()
                raw = m.group(1).lower()
                current_role = "agent" if raw in ("agent", "support", "rep", "operator") else "customer"
                current_body = [m.group(2)]
            else:
                current_body.append(line)
        flush()
        return turns

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    return [
        {"role": "customer" if i % 2 == 0 else "agent", "body": para}
        for i, para in enumerate(paragraphs)
    ]


def _clean_json(raw: str) -> str:
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def _repair_truncated_json(raw: str) -> str:
    """
    Best-effort repair of JSON truncated mid-string (e.g. token-limit cut-off).
    Strategy:
      1. Drop the incomplete trailing string value.
      2. Close any open arrays/objects in the correct order.
    Returns the repaired string, or the original if nothing helps.
    """
    text = raw.rstrip()

    # Remove a trailing unterminated string: last unescaped quote with no closing quote
    # Pattern: a double-quote that opened but never closed before end-of-string
    text = re.sub(r'"\s*$', '', text)                   # cut bare open quote at end
    text = re.sub(r':\s*"[^"]*$', ': null', text)       # cut "key": "unterminated...
    text = re.sub(r',\s*"[^"]*$', '', text)              # cut ,"unterminated... in array/obj
    text = text.rstrip().rstrip(',')                     # trailing comma left behind

    # Re-close open brackets in reverse order
    stack = []
    in_string = False
    escape_next = False
    for ch in text:
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ('{', '['):
            stack.append('}' if ch == '{' else ']')
        elif ch in ('}', ']') and stack:
            stack.pop()

    text += ''.join(reversed(stack))
    return text


def _safe_parse_json(raw: str) -> dict:
    """Parse LLM JSON output, repairing truncated strings before raising."""
    cleaned = _clean_json(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        repaired = _repair_truncated_json(cleaned)
        try:
            return json.loads(repaired)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"The analyser returned malformed JSON that could not be repaired. "
                f"Try shortening the conversation or removing noisy content. (Detail: {exc})"
            ) from exc


DSAT_SYSTEM_PROMPT = """You are a senior customer experience specialist helping support teams recover dissatisfied customers.
Analyse support ticket conversations to identify root causes of dissatisfaction and create actionable recovery plans.
Always respond with valid JSON only — no markdown fences, no prose outside the JSON."""

DSAT_ANALYSIS_TEMPLATE = """Analyse this DSAT (dissatisfied) support ticket and provide a detailed recovery plan.

## Ticket Details
- Subject: {subject}
- Customer Name: {customer_name}
- Additional Context: {context}

## Conversation
{conversation}

## Instructions
Return exactly this JSON structure — no extra keys, no markdown:

{{
  "root_causes": [
    {{"issue": "<specific issue that caused dissatisfaction>", "severity": "<high|medium|low>", "category": "<response_time|incorrect_info|lack_of_empathy|unresolved_issue|process_failure|communication|other>"}}
  ],
  "what_went_wrong": "<2-4 sentence clear narrative of why this ticket resulted in a DSAT rating>",
  "customer_impact": "<1-2 sentences on how this issue affected the customer>",
  "csat_recovery_recommendations": [
    {{"action": "<specific action to take>", "priority": "<immediate|short_term|long_term>", "owner": "<agent|team_lead|management|product>", "rationale": "<why this will help recover satisfaction>"}}
  ],
  "follow_up_response": {{
    "subject": "<suggested email/message subject line>",
    "body": "<professional, empathetic follow-up message to send to the customer — ready to use, personalised with their name and issue details, focused on recovery and resolution>"
  }},
  "prevention_tips": ["<tip to prevent similar DSATs in future>"],
  "recovery_probability": "<high|medium|low>",
  "recovery_rationale": "<1-2 sentences on why this rating was given>"
}}
"""


async def analyze_dsat(
    conversation: list[dict],
    subject: str = "",
    customer_name: str = "",
    context: str = "",
) -> dict:
    client = _make_client()
    prompt = DSAT_ANALYSIS_TEMPLATE.format(
        subject       = subject or "N/A",
        customer_name = customer_name or "the customer",
        context       = context or "None provided",
        conversation  = format_conversation(conversation),
    )
    try:
        message = client.messages.create(
            model      = "claude-sonnet-4-6",
            max_tokens = 2048,
            system     = DSAT_SYSTEM_PROMPT,
            messages   = [{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError:
        raise ValueError("Anthropic API key is invalid or expired (401).")
    except anthropic.PermissionDeniedError:
        raise ValueError("Anthropic API key lacks permission for this model (403).")
    return _safe_parse_json(message.content[0].text)


async def assess_ticket(
    ticket_data: dict,
    sops: list[dict],                          # list of {"name": ..., "content": ...}
    excluded_criteria=None,
) -> dict:
    ticket       = ticket_data["ticket"]
    conversation = ticket_data["conversation"]

    prompt = _build_assessment_prompt(
        sops_block   = _build_sops_block(sops),
        subject      = ticket.get("subject",  "N/A"),
        status       = ticket.get("status",   "N/A"),
        priority     = ticket.get("priority", "N/A"),
        conversation = format_conversation(conversation),
        excluded_criteria = excluded_criteria or [],
    )

    try:
        client  = _make_client()
        message = client.messages.create(
            model    = "claude-sonnet-4-6",
            max_tokens = 2048,
            system   = SYSTEM_PROMPT,
            messages = [{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError:
        raise ValueError(
            "Anthropic API key is invalid or expired (401). "
            "Check ANTHROPIC_API_KEY in your .env — "
            "get a new key at https://console.anthropic.com/settings/keys."
        )
    except anthropic.PermissionDeniedError:
        raise ValueError(
            "Anthropic API key lacks permission for this model (403). "
            "Ensure your account has access to claude-sonnet-4-6."
        )

    result = _safe_parse_json(message.content[0].text)
    cost_usd = (message.usage.input_tokens / 1_000_000 * 3.0) + \
               (message.usage.output_tokens / 1_000_000 * 15.0)
    usage = {
        "input_tokens":  message.usage.input_tokens,
        "output_tokens": message.usage.output_tokens,
        "total_tokens":  message.usage.input_tokens + message.usage.output_tokens,
        "cost_usd":      round(cost_usd, 6),
    }
    return result, usage
