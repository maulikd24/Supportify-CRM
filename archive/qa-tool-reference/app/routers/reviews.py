import json
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.database import get_db
from app.zendesk_client import ZendeskClient
from app.assessor import assess_ticket

router = APIRouter(prefix="/reviews", tags=["Reviews"])


class ReviewRequest(BaseModel):
    ticket_id: str
    sop_id: int


@router.post("/")
async def create_review(req: ReviewRequest, db: aiosqlite.Connection = Depends(get_db)):
    # Fetch SOP
    cursor = await db.execute("SELECT * FROM sops WHERE id = ?", (req.sop_id,))
    sop_row = await cursor.fetchone()
    if not sop_row:
        raise HTTPException(404, "SOP not found")
    sop = dict(sop_row)

    # Fetch ticket from Zendesk
    zd = ZendeskClient()
    try:
        ticket_data = await zd.get_ticket_with_conversation(req.ticket_id)
    except Exception as e:
        raise HTTPException(502, f"Zendesk error: {e}")

    # Run LLM assessment
    try:
        result = await assess_ticket(ticket_data, sop["name"], sop["content"])
    except Exception as e:
        raise HTTPException(502, f"Assessment error: {e}")

    ticket = ticket_data["ticket"]
    conversation_text = json.dumps(ticket_data["conversation"])

    await db.execute(
        """INSERT INTO qa_reviews
           (ticket_id, ticket_subject, agent_name, agent_email, sop_id, sop_name,
            overall_score, criteria_scores, summary, strengths, improvements, raw_conversation)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            str(req.ticket_id),
            ticket.get("subject", ""),
            ticket_data["agent_name"],
            ticket_data["agent_email"],
            sop["id"],
            sop["name"],
            result["overall_score"],
            json.dumps(result.get("criteria_scores", {})),
            result.get("summary", ""),
            json.dumps(result.get("strengths", [])),
            json.dumps(result.get("improvements", [])),
            conversation_text,
        ),
    )
    await db.commit()
    cursor = await db.execute("SELECT last_insert_rowid()")
    row = await cursor.fetchone()
    review_id = row[0]

    return {
        "review_id": review_id,
        "ticket_id": req.ticket_id,
        "overall_score": result["overall_score"],
        "summary": result.get("summary"),
        "criteria_scores": result.get("criteria_scores"),
        "strengths": result.get("strengths", []),
        "improvements": result.get("improvements", []),
        "sop_violations": result.get("sop_violations", []),
    }


@router.get("/")
async def list_reviews(
    agent_email: str = None,
    ticket_id: str = None,
    limit: int = 50,
    db: aiosqlite.Connection = Depends(get_db),
):
    query = "SELECT * FROM qa_reviews WHERE 1=1"
    params = []
    if agent_email:
        query += " AND agent_email = ?"
        params.append(agent_email)
    if ticket_id:
        query += " AND ticket_id = ?"
        params.append(ticket_id)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    results = []
    for r in rows:
        d = dict(r)
        d["criteria_scores"] = json.loads(d["criteria_scores"] or "{}")
        d["strengths"] = json.loads(d["strengths"] or "[]")
        d["improvements"] = json.loads(d["improvements"] or "[]")
        results.append(d)
    return results


@router.get("/{review_id}")
async def get_review(review_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT * FROM qa_reviews WHERE id = ?", (review_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(404, "Review not found")
    d = dict(row)
    d["criteria_scores"] = json.loads(d["criteria_scores"] or "{}")
    d["strengths"] = json.loads(d["strengths"] or "[]")
    d["improvements"] = json.loads(d["improvements"] or "[]")
    d["raw_conversation"] = json.loads(d["raw_conversation"] or "[]")
    return d


@router.get("/agent/{agent_email}/summary")
async def agent_summary(agent_email: str, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        """SELECT
               COUNT(*) as total_reviews,
               ROUND(AVG(overall_score), 1) as avg_score,
               MIN(overall_score) as min_score,
               MAX(overall_score) as max_score
           FROM qa_reviews WHERE agent_email = ?""",
        (agent_email,),
    )
    row = await cursor.fetchone()
    stats = dict(row)

    cursor = await db.execute(
        "SELECT overall_score, ticket_subject, created_at FROM qa_reviews WHERE agent_email = ? ORDER BY created_at DESC LIMIT 10",
        (agent_email,),
    )
    recent = [dict(r) for r in await cursor.fetchall()]
    return {"agent_email": agent_email, "stats": stats, "recent_reviews": recent}
