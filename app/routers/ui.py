import csv
import io
import json
from pathlib import Path
from typing import Optional, List
import aiosqlite
from fastapi import APIRouter, Depends, Request, Form, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from app.database import get_db
from app.zendesk_client import ZendeskClient
from app.assessor import assess_ticket, parse_manual_conversation, ALL_CRITERIA
from app.auth import require_user

router = APIRouter(tags=["UI"])
templates = Jinja2Templates(directory=str(Path(__file__).parent.parent.parent / "templates"))


# ── helpers ────────────────────────────────────────────────────────────────

def _parse_review(row) -> dict:
    d = dict(row)
    d["criteria_scores"]  = json.loads(d.get("criteria_scores")  or "{}")
    d["strengths"]        = json.loads(d.get("strengths")        or "[]")
    d["improvements"]     = json.loads(d.get("improvements")     or "[]")
    d["sop_violations"]   = json.loads(d.get("sop_violations")   or "[]")
    d["sop_ids"]          = json.loads(d.get("sop_ids")          or "[]")
    d["sop_names"]        = json.loads(d.get("sop_names")        or "[]")
    d["sentiment"]          = json.loads(d.get("sentiment")          or "{}")
    d["excluded_criteria"]    = json.loads(d.get("excluded_criteria")    or "[]")
    d["dismissed_violations"] = json.loads(d.get("dismissed_violations") or "[]")
    return d


async def _run_and_save_review(
    db, ticket_data, sops_list, save_ticket_id, save_subject, save_agent_name, save_agent_email,
    existing_id=None, excluded_criteria=None,
):
    """Run assessment and insert/update a review row. Returns review id."""
    result, usage = await assess_ticket(ticket_data, sops_list, excluded_criteria=excluded_criteria or [])

    sop_ids   = [s["id"]   for s in sops_list]
    sop_names = [s["name"] for s in sops_list]

    row_data = (
        save_ticket_id,
        save_subject,
        save_agent_name,
        save_agent_email,
        sop_ids[0] if sop_ids else None,
        sop_names[0] if sop_names else None,
        result["overall_score"],
        json.dumps(result.get("criteria_scores", {})),
        result.get("summary", ""),
        json.dumps(result.get("strengths", [])),
        json.dumps(result.get("improvements", [])),
        json.dumps(ticket_data["conversation"]),
        json.dumps(sop_ids),
        json.dumps(sop_names),
        json.dumps(result.get("sentiment", {})),
        json.dumps(result.get("sop_violations", [])),
        json.dumps(excluded_criteria or []),
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
        usage.get("cost_usd", 0.0),
    )

    if existing_id:
        await db.execute("""
            UPDATE qa_reviews SET
              ticket_id=?, ticket_subject=?, agent_name=?, agent_email=?,
              sop_id=?, sop_name=?,
              overall_score=?, criteria_scores=?, summary=?, strengths=?, improvements=?,
              raw_conversation=?, sop_ids=?, sop_names=?, sentiment=?, sop_violations=?,
              excluded_criteria=?, tokens_input=?, tokens_output=?, tokens_cost_usd=?,
              created_at=CURRENT_TIMESTAMP
            WHERE id=?
        """, (*row_data, existing_id))
        await db.commit()
        return existing_id
    else:
        await db.execute("""
            INSERT INTO qa_reviews
              (ticket_id, ticket_subject, agent_name, agent_email,
               sop_id, sop_name, overall_score, criteria_scores, summary,
               strengths, improvements, raw_conversation,
               sop_ids, sop_names, sentiment, sop_violations, excluded_criteria,
               tokens_input, tokens_output, tokens_cost_usd)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, row_data)
        await db.commit()
        cursor = await db.execute("SELECT last_insert_rowid()")
        return (await cursor.fetchone())[0]


# ── Dashboard ──────────────────────────────────────────────────────────────

@router.get("/", response_class=HTMLResponse)
async def dashboard(
    request: Request,
    agent: Optional[str] = Query(None),
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    # Filtered stats
    if agent:
        cursor = await db.execute(
            "SELECT COUNT(*) as c, ROUND(AVG(overall_score),1) as avg FROM qa_reviews "
            "WHERE agent_email=? OR agent_name=?", (agent, agent)
        )
    else:
        cursor = await db.execute(
            "SELECT COUNT(*) as c, ROUND(AVG(overall_score),1) as avg FROM qa_reviews"
        )
    stats = dict(await cursor.fetchone())

    if agent:
        cursor = await db.execute(
            "SELECT * FROM qa_reviews WHERE agent_email=? OR agent_name=? "
            "ORDER BY created_at DESC LIMIT 50", (agent, agent)
        )
    else:
        cursor = await db.execute(
            "SELECT * FROM qa_reviews ORDER BY created_at DESC LIMIT 50"
        )
    reviews = [_parse_review(r) for r in await cursor.fetchall()]

    cursor = await db.execute("SELECT * FROM sops ORDER BY category, name")
    sops = [dict(r) for r in await cursor.fetchall()]

    # Agent list for filter dropdown
    cursor = await db.execute(
        "SELECT DISTINCT agent_name, agent_email FROM qa_reviews "
        "WHERE agent_name IS NOT NULL AND agent_name != '' ORDER BY agent_name"
    )
    agents = [dict(r) for r in await cursor.fetchall()]

    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "current_user": current_user,
        "stats": stats,
        "reviews": reviews,
        "sops": sops,
        "agents": agents,
        "selected_agent": agent or "",
    })


# ── CSV Download ────────────────────────────────────────────────────────────

@router.get("/reviews/download")
async def download_reviews_csv(
    request: Request,
    agent: Optional[str] = Query(None),
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    if agent:
        cursor = await db.execute(
            "SELECT * FROM qa_reviews WHERE agent_email=? OR agent_name=? ORDER BY created_at DESC",
            (agent, agent),
        )
    else:
        cursor = await db.execute("SELECT * FROM qa_reviews ORDER BY created_at DESC")

    rows = [dict(r) for r in await cursor.fetchall()]

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "Review ID", "Ticket ID", "Subject", "Agent Name", "Agent Email",
        "SOP(s)", "Overall Score",
        "SOP Adherence", "Tone & Empathy", "Accuracy", "Resolution Quality", "Response Completeness",
        "Sentiment Overall", "Customer Sentiment", "Agent Sentiment", "Sentiment Score",
        "Summary", "Strengths", "Improvements", "SOP Violations",
        "Tokens Input", "Tokens Output", "Tokens Total", "Est. Cost (USD)",
        "Reviewed At",
    ])

    for r in rows:
        criteria = json.loads(r.get("criteria_scores") or "{}")
        sentiment = json.loads(r.get("sentiment") or "{}")
        sop_names = json.loads(r.get("sop_names") or "[]") or ([r.get("sop_name")] if r.get("sop_name") else [])
        strengths   = json.loads(r.get("strengths")      or "[]")
        improvements = json.loads(r.get("improvements")  or "[]")
        violations  = json.loads(r.get("sop_violations")  or "[]")

        writer.writerow([
            r["id"],
            r.get("ticket_id", ""),
            r.get("ticket_subject", ""),
            r.get("agent_name", ""),
            r.get("agent_email", ""),
            "; ".join(sop_names),
            r.get("overall_score", ""),
            criteria.get("sop_adherence", ""),
            criteria.get("tone_and_empathy", ""),
            criteria.get("accuracy", ""),
            criteria.get("resolution_quality", ""),
            criteria.get("response_completeness", ""),
            sentiment.get("overall", ""),
            sentiment.get("customer_sentiment", ""),
            sentiment.get("agent_sentiment", ""),
            sentiment.get("score", ""),
            r.get("summary", ""),
            " | ".join(strengths),
            " | ".join(improvements),
            " | ".join(violations),
            r.get("tokens_input") or "",
            r.get("tokens_output") or "",
            (r.get("tokens_input") or 0) + (r.get("tokens_output") or 0) or "",
            r.get("tokens_cost_usd") or "",
            r.get("created_at", ""),
        ])

    output.seek(0)
    filename = f"qa_reviews{'_' + agent.replace('@','_').replace('.','_') if agent else ''}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),  # utf-8-sig for Excel compatibility
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── New Review ─────────────────────────────────────────────────────────────

@router.get("/review/new", response_class=HTMLResponse)
async def new_review_form(
    request: Request,
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    cursor = await db.execute("SELECT id, name, category FROM sops ORDER BY category, name")
    sops = [dict(r) for r in await cursor.fetchall()]
    return templates.TemplateResponse("new_review.html", {
        "request": request,
        "current_user": current_user,
        "sops": sops,
        "zendesk_configured": ZendeskClient.is_configured(),
        "all_criteria": ALL_CRITERIA,
    })


@router.post("/review/new", response_class=HTMLResponse)
async def submit_review(
    request: Request,
    sop_ids: List[int] = Form(...),
    input_mode: str = Form("manual"),
    ticket_id: Optional[str] = Form(None),
    manual_subject: Optional[str] = Form(None),
    manual_agent: Optional[str] = Form(None),
    manual_conversation: Optional[str] = Form(None),
    excluded_criteria: List[str] = Form(default=[]),
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    # Validate
    if input_mode == "zendesk":
        if not ticket_id or not ticket_id.strip():
            return templates.TemplateResponse(
                "error.html", {"request": request, "error": "Ticket ID is required for Zendesk mode."})
    else:
        if not manual_conversation or not manual_conversation.strip():
            return templates.TemplateResponse(
                "error.html", {"request": request, "error": "Please paste a conversation before running the review."})

    # Fetch selected SOPs
    placeholders = ",".join("?" * len(sop_ids))
    cursor = await db.execute(
        f"SELECT id, name, content FROM sops WHERE id IN ({placeholders})", sop_ids
    )
    sops_list = [dict(r) for r in await cursor.fetchall()]
    if not sops_list:
        return templates.TemplateResponse(
            "error.html", {"request": request, "error": "No valid SOPs found for the selected IDs."})

    # Build ticket_data
    if input_mode == "zendesk":
        zd = ZendeskClient()
        try:
            ticket_data = await zd.get_ticket_with_conversation(ticket_id.strip())
        except Exception as e:
            return templates.TemplateResponse("error.html", {"request": request, "error": f"Zendesk error: {e}"})
        save_ticket_id   = ticket_id.strip()
        save_subject     = ticket_data["ticket"].get("subject", "")
        save_agent_name  = ticket_data["agent_name"]
        save_agent_email = ticket_data["agent_email"]
    else:
        parsed = parse_manual_conversation(manual_conversation.strip())
        ticket_data = {
            "ticket": {"subject": manual_subject or "Manual Review", "status": "manual", "priority": "normal"},
            "conversation": parsed,
            "agent_name": manual_agent or "Unknown",
            "agent_email": "",
        }
        import time
        save_ticket_id   = f"manual-{int(time.time())}"
        save_subject     = manual_subject or "Manual Review"
        save_agent_name  = manual_agent or "Unknown"
        save_agent_email = ""

    try:
        review_id = await _run_and_save_review(
            db, ticket_data, sops_list,
            save_ticket_id, save_subject, save_agent_name, save_agent_email,
            excluded_criteria=excluded_criteria,
        )
    except Exception as e:
        return templates.TemplateResponse("error.html", {"request": request, "error": f"Assessment error: {e}"})

    return RedirectResponse(f"/review/{review_id}", status_code=303)


# ── Review detail + Re-run ─────────────────────────────────────────────────

@router.get("/review/{review_id}", response_class=HTMLResponse)
async def view_review(
    review_id: int,
    request: Request,
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    cursor = await db.execute("SELECT * FROM qa_reviews WHERE id = ?", (review_id,))
    row = await cursor.fetchone()
    if not row:
        return templates.TemplateResponse(
            "error.html", {"request": request, "error": "Review not found"}, status_code=404)
    review = _parse_review(row)
    review["raw_conversation"] = json.loads(row["raw_conversation"] or "[]")

    # Fetch SOP content for all SOPs used
    sop_ids = review["sop_ids"] or ([review["sop_id"]] if review.get("sop_id") else [])
    sops_content = []
    for sid in sop_ids:
        c = await db.execute("SELECT id, name, content FROM sops WHERE id=?", (sid,))
        r = await c.fetchone()
        if r:
            sops_content.append(dict(r))

    # All SOPs for re-run selector
    cursor = await db.execute("SELECT id, name, category FROM sops ORDER BY category, name")
    all_sops = [dict(r) for r in await cursor.fetchall()]

    return templates.TemplateResponse("review_detail.html", {
        "request": request,
        "current_user": current_user,
        "review": review,
        "sops_content": sops_content,
        "all_sops": all_sops,
        "all_criteria": ALL_CRITERIA,
    })


@router.post("/review/{review_id}/rerun", response_class=HTMLResponse)
async def rerun_review(
    review_id: int,
    request: Request,
    sop_ids: List[int] = Form(...),
    excluded_criteria: List[str] = Form(default=[]),
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    cursor = await db.execute("SELECT * FROM qa_reviews WHERE id=?", (review_id,))
    row = await cursor.fetchone()
    if not row:
        return templates.TemplateResponse(
            "error.html", {"request": request, "error": "Review not found"}, status_code=404)
    review = dict(row)

    placeholders = ",".join("?" * len(sop_ids))
    cursor = await db.execute(
        f"SELECT id, name, content FROM sops WHERE id IN ({placeholders})", sop_ids)
    sops_list = [dict(r) for r in await cursor.fetchall()]
    if not sops_list:
        return templates.TemplateResponse(
            "error.html", {"request": request, "error": "No valid SOPs selected."})

    conversation = json.loads(review.get("raw_conversation") or "[]")
    ticket_data  = {
        "ticket": {
            "subject":  review.get("ticket_subject", ""),
            "status":   "manual",
            "priority": "normal",
        },
        "conversation": conversation,
        "agent_name":   review.get("agent_name", ""),
        "agent_email":  review.get("agent_email", ""),
    }

    try:
        await _run_and_save_review(
            db, ticket_data, sops_list,
            review["ticket_id"], review.get("ticket_subject", ""),
            review.get("agent_name", ""), review.get("agent_email", ""),
            existing_id=review_id,
            excluded_criteria=excluded_criteria,
        )
    except Exception as e:
        return templates.TemplateResponse("error.html", {"request": request, "error": f"Re-run error: {e}"})

    return RedirectResponse(f"/review/{review_id}", status_code=303)


# ── Edit ticket info ───────────────────────────────────────────────────────

@router.post("/review/{review_id}/edit-info")
async def edit_review_info(
    review_id: int,
    request: Request,
    ticket_id: str = Form(...),
    ticket_subject: Optional[str] = Form(""),
    agent_name: Optional[str] = Form(""),
    agent_email: Optional[str] = Form(""),
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    await db.execute(
        "UPDATE qa_reviews SET ticket_id=?, ticket_subject=?, agent_name=?, agent_email=? WHERE id=?",
        (ticket_id.strip(), ticket_subject or "", agent_name or "", agent_email or "", review_id),
    )
    await db.commit()
    return RedirectResponse(f"/review/{review_id}", status_code=303)


# ── Auditor comment ────────────────────────────────────────────────────────

@router.post("/review/{review_id}/comment")
async def save_review_comment(
    review_id: int,
    request: Request,
    auditor_comment: str = Form(""),
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    await db.execute(
        "UPDATE qa_reviews SET auditor_comment=?, auditor_updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (auditor_comment.strip(), review_id),
    )
    await db.commit()
    return RedirectResponse(f"/review/{review_id}", status_code=303)


# ── Violation dismissal with score recalculation ───────────────────────────

@router.post("/review/{review_id}/dismiss-violations")
async def dismiss_review_violations(
    review_id: int,
    request: Request,
    dismissed: List[str] = Form(default=[]),
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    cursor = await db.execute(
        "SELECT criteria_scores, sop_violations FROM qa_reviews WHERE id=?", (review_id,)
    )
    row = await cursor.fetchone()
    if not row:
        return RedirectResponse(f"/review/{review_id}", status_code=303)

    criteria   = json.loads(row["criteria_scores"] or "{}")
    violations = json.loads(row["sop_violations"]  or "[]")

    N = len(violations)
    K = len(dismissed)

    if N > 0 and criteria:
        orig_sop = criteria.get("sop_adherence", 0)
        revised_sop = min(100, round(orig_sop + (K / N) * (100 - orig_sop)))
        criteria["sop_adherence"] = revised_sop
        overall = round(sum(criteria.values()) / len(criteria))
    else:
        cursor2 = await db.execute("SELECT overall_score FROM qa_reviews WHERE id=?", (review_id,))
        overall = (await cursor2.fetchone())["overall_score"]

    await db.execute(
        "UPDATE qa_reviews SET dismissed_violations=?, criteria_scores=?, overall_score=?, "
        "score_edited_at=CURRENT_TIMESTAMP WHERE id=?",
        (json.dumps(dismissed), json.dumps(criteria), overall, review_id),
    )
    await db.commit()
    return RedirectResponse(f"/review/{review_id}", status_code=303)


# ── SOPs (list + create + edit) ────────────────────────────────────────────

@router.get("/sops", response_class=HTMLResponse)
async def sops_page(
    request: Request,
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    cursor = await db.execute("SELECT * FROM sops ORDER BY category, name")
    sops = [dict(r) for r in await cursor.fetchall()]
    return templates.TemplateResponse("sops.html", {"request": request, "current_user": current_user, "sops": sops})


@router.post("/sops/new")
async def create_sop_ui(
    request: Request,
    name: str = Form(...),
    category: str = Form("general"),
    content: str = Form(...),
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    try:
        await db.execute(
            "INSERT INTO sops (name, category, content) VALUES (?, ?, ?)",
            (name, category, content),
        )
        await db.commit()
    except Exception:
        return RedirectResponse(f"/sops?error=An+SOP+named+'{name}'+already+exists", status_code=303)
    return RedirectResponse("/sops", status_code=303)


@router.get("/sops/{sop_id}/edit", response_class=HTMLResponse)
async def edit_sop_page(
    sop_id: int,
    request: Request,
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    cursor = await db.execute("SELECT * FROM sops WHERE id=?", (sop_id,))
    row = await cursor.fetchone()
    if not row:
        return templates.TemplateResponse(
            "error.html", {"request": request, "error": "SOP not found"}, status_code=404)
    return templates.TemplateResponse("sop_edit.html", {"request": request, "current_user": current_user, "sop": dict(row)})


@router.post("/sops/{sop_id}/edit")
async def update_sop_ui(
    sop_id: int,
    request: Request,
    name: str = Form(...),
    category: str = Form("general"),
    content: str = Form(...),
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    await db.execute(
        "UPDATE sops SET name=?, category=?, content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (name, category, content, sop_id),
    )
    await db.commit()
    return RedirectResponse("/sops", status_code=303)


@router.post("/sops/{sop_id}/delete")
async def delete_sop_ui(
    sop_id: int,
    request: Request,
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    await db.execute("DELETE FROM sops WHERE id=?", (sop_id,))
    await db.commit()
    return RedirectResponse("/sops", status_code=303)


# ── Agent-wise reviews ─────────────────────────────────────────────────────

@router.get("/agents", response_class=HTMLResponse)
async def agents_page(
    request: Request,
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    cursor = await db.execute("""
        SELECT
            agent_name, agent_email,
            COUNT(*)                          AS total,
            ROUND(AVG(overall_score), 1)      AS avg_score,
            MIN(overall_score)                AS min_score,
            MAX(overall_score)                AS max_score,
            MAX(created_at)                   AS last_review
        FROM qa_reviews
        WHERE agent_name IS NOT NULL AND agent_name != ''
        GROUP BY COALESCE(NULLIF(agent_email,''), agent_name)
        ORDER BY avg_score DESC
    """)
    agents = [dict(r) for r in await cursor.fetchall()]
    return templates.TemplateResponse("agents.html", {"request": request, "current_user": current_user, "agents": agents})


@router.get("/agents/{agent_key}", response_class=HTMLResponse)
async def agent_detail(
    agent_key: str,
    request: Request,
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    # agent_key is email or name
    cursor = await db.execute("""
        SELECT * FROM qa_reviews
        WHERE agent_email=? OR agent_name=?
        ORDER BY created_at DESC
    """, (agent_key, agent_key))
    reviews = [_parse_review(r) for r in await cursor.fetchall()]

    cursor = await db.execute("""
        SELECT
            COUNT(*)                        AS total,
            ROUND(AVG(overall_score), 1)    AS avg_score,
            MIN(overall_score)              AS min_score,
            MAX(overall_score)              AS max_score
        FROM qa_reviews WHERE agent_email=? OR agent_name=?
    """, (agent_key, agent_key))
    stats = dict(await cursor.fetchone())

    # Score trend (last 10 in order)
    trend = [{"date": r["created_at"][:10], "score": r["overall_score"]} for r in reviews[:10]][::-1]

    agent_name = reviews[0]["agent_name"] if reviews else agent_key
    return templates.TemplateResponse("agent_detail.html", {
        "request": request,
        "current_user": current_user,
        "agent_key": agent_key,
        "agent_name": agent_name,
        "reviews": reviews,
        "stats": stats,
        "trend": trend,
    })


# ── Team report ────────────────────────────────────────────────────────────

@router.get("/reports", response_class=HTMLResponse)
async def reports_page(
    request: Request,
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    # Overall stats
    cursor = await db.execute("""
        SELECT
            COUNT(*)                        AS total_reviews,
            ROUND(AVG(overall_score), 1)    AS avg_score,
            SUM(CASE WHEN overall_score >= 75 THEN 1 ELSE 0 END) AS passing,
            SUM(CASE WHEN overall_score <  60 THEN 1 ELSE 0 END) AS failing,
            ROUND(SUM(COALESCE(tokens_cost_usd, 0)), 4) AS total_cost_usd,
            COALESCE(SUM(tokens_input), 0) + COALESCE(SUM(tokens_output), 0) AS total_tokens
        FROM qa_reviews
    """)
    team_stats = dict(await cursor.fetchone())

    # Per-agent leaderboard
    cursor = await db.execute("""
        SELECT
            agent_name, agent_email,
            COUNT(*)                        AS total,
            ROUND(AVG(overall_score), 1)    AS avg_score,
            MIN(overall_score)              AS min_score,
            MAX(overall_score)              AS max_score,
            ROUND(SUM(COALESCE(tokens_cost_usd, 0)), 4) AS total_cost_usd
        FROM qa_reviews
        WHERE agent_name IS NOT NULL AND agent_name != ''
        GROUP BY COALESCE(NULLIF(agent_email,''), agent_name)
        ORDER BY avg_score DESC
    """)
    agents = [dict(r) for r in await cursor.fetchall()]

    # SOP pass rates
    cursor = await db.execute("""
        SELECT
            sop_name,
            COUNT(*)                        AS total,
            ROUND(AVG(overall_score), 1)    AS avg_score
        FROM qa_reviews
        WHERE sop_name IS NOT NULL
        GROUP BY sop_name
        ORDER BY avg_score ASC
    """)
    sop_stats = [dict(r) for r in await cursor.fetchall()]

    # Score distribution buckets
    cursor = await db.execute("""
        SELECT
            SUM(CASE WHEN overall_score BETWEEN 90 AND 100 THEN 1 ELSE 0 END) AS excellent,
            SUM(CASE WHEN overall_score BETWEEN 75 AND  89 THEN 1 ELSE 0 END) AS good,
            SUM(CASE WHEN overall_score BETWEEN 60 AND  74 THEN 1 ELSE 0 END) AS acceptable,
            SUM(CASE WHEN overall_score BETWEEN 40 AND  59 THEN 1 ELSE 0 END) AS below,
            SUM(CASE WHEN overall_score  <  40             THEN 1 ELSE 0 END) AS poor
        FROM qa_reviews
    """)
    distribution = dict(await cursor.fetchone())

    # Sentiment summary
    cursor = await db.execute(
        "SELECT sentiment FROM qa_reviews WHERE sentiment IS NOT NULL AND sentiment != '' AND sentiment != '{}'"
    )
    sentiments = {"positive": 0, "neutral": 0, "negative": 0}
    for row in await cursor.fetchall():
        s = json.loads(row["sentiment"] or "{}")
        overall = s.get("overall", "neutral")
        sentiments[overall] = sentiments.get(overall, 0) + 1

    return templates.TemplateResponse("reports.html", {
        "request": request,
        "current_user": current_user,
        "team_stats": team_stats,
        "agents": agents,
        "sop_stats": sop_stats,
        "distribution": distribution,
        "sentiments": sentiments,
    })


# ── Health ─────────────────────────────────────────────────────────────────

@router.get("/health", response_class=HTMLResponse)
async def health_page(
    request: Request,
    current_user=Depends(require_user),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse): return current_user
    from app.config import settings
    config_items = [
        {"key": "ANTHROPIC_API_KEY",  "set": bool(settings.anthropic_api_key),  "required": True,
         "hint": "Required — get it at console.anthropic.com/settings/keys"},
        {"key": "ZENDESK_SUBDOMAIN",  "set": bool(settings.zendesk_subdomain),  "required": False,
         "hint": "Optional — e.g. 'acme' for acme.zendesk.com"},
        {"key": "ZENDESK_EMAIL",      "set": bool(settings.zendesk_email),      "required": False,
         "hint": "Optional — email of the Zendesk admin/agent account"},
        {"key": "ZENDESK_API_TOKEN",  "set": bool(settings.zendesk_api_token),  "required": False,
         "hint": "Optional — API token from Zendesk Admin"},
    ]
    missing = [i for i in config_items if not i["set"] and i["required"]]
    return templates.TemplateResponse("health.html", {
        "request": request, "current_user": current_user, "config_items": config_items, "missing": missing,
    })
