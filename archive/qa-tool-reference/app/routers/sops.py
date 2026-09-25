import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Form
from fastapi.responses import RedirectResponse
from app.database import get_db
from pydantic import BaseModel

router = APIRouter(prefix="/sops", tags=["SOPs"])


class SOPCreate(BaseModel):
    name: str
    category: str = "general"
    content: str


@router.get("/")
async def list_sops(db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT * FROM sops ORDER BY category, name")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("/")
async def create_sop(sop: SOPCreate, db: aiosqlite.Connection = Depends(get_db)):
    try:
        await db.execute(
            "INSERT INTO sops (name, category, content) VALUES (?, ?, ?)",
            (sop.name, sop.category, sop.content),
        )
        await db.commit()
        cursor = await db.execute("SELECT last_insert_rowid()")
        row = await cursor.fetchone()
        return {"id": row[0], "name": sop.name}
    except aiosqlite.IntegrityError:
        raise HTTPException(400, f"SOP named '{sop.name}' already exists")


@router.get("/{sop_id}")
async def get_sop(sop_id: int, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT * FROM sops WHERE id = ?", (sop_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(404, "SOP not found")
    return dict(row)


@router.put("/{sop_id}")
async def update_sop(sop_id: int, sop: SOPCreate, db: aiosqlite.Connection = Depends(get_db)):
    await db.execute(
        "UPDATE sops SET name=?, category=?, content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (sop.name, sop.category, sop.content, sop_id),
    )
    await db.commit()
    return {"status": "updated"}


@router.delete("/{sop_id}")
async def delete_sop(sop_id: int, db: aiosqlite.Connection = Depends(get_db)):
    await db.execute("DELETE FROM sops WHERE id = ?", (sop_id,))
    await db.commit()
    return {"status": "deleted"}
