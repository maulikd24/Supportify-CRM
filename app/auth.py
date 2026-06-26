from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from app.database import get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


async def get_current_user(request: Request, db=Depends(get_db)):
    user_id = request.session.get("user_id")
    if not user_id:
        return None
    cursor = await db.execute(
        "SELECT * FROM users WHERE id=? AND is_active=1", (user_id,)
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


async def require_user(request: Request, db=Depends(get_db)):
    user = await get_current_user(request, db)
    if not user:
        return RedirectResponse("/login", status_code=302)
    return user


async def require_admin(request: Request, db=Depends(get_db)):
    user = await require_user(request, db)
    if isinstance(user, RedirectResponse):
        return user
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
