from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from app.database import get_db
from app.auth import hash_password, require_admin

router = APIRouter(prefix="/admin", tags=["Admin"])
templates = Jinja2Templates(directory="templates")


@router.get("/users", response_class=HTMLResponse)
async def users_page(
    request: Request,
    current_user=Depends(require_admin),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse):
        return current_user
    cursor = await db.execute("SELECT * FROM users ORDER BY created_at")
    users = [dict(r) for r in await cursor.fetchall()]
    msg = request.session.pop("admin_msg", None)
    return templates.TemplateResponse("admin_users.html", {
        "request": request,
        "current_user": current_user,
        "users": users,
        "msg": msg,
    })


@router.post("/users/new")
async def create_user(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    role: str = Form("member"),
    current_user=Depends(require_admin),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse):
        return current_user
    if len(password) < 8:
        request.session["admin_msg"] = "error:Password must be at least 8 characters."
        return RedirectResponse("/admin/users", status_code=303)
    try:
        await db.execute(
            "INSERT INTO users (name, email, hashed_password, role) VALUES (?,?,?,?)",
            (name.strip(), email.strip().lower(), hash_password(password), role),
        )
        await db.commit()
        request.session["admin_msg"] = f"ok:{name} added successfully."
    except Exception:
        request.session["admin_msg"] = f"error:A user with email {email} already exists."
    return RedirectResponse("/admin/users", status_code=303)


@router.post("/users/{user_id}/toggle")
async def toggle_user(
    user_id: int,
    request: Request,
    current_user=Depends(require_admin),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse):
        return current_user
    if user_id == current_user["id"]:
        request.session["admin_msg"] = "error:You cannot deactivate your own account."
        return RedirectResponse("/admin/users", status_code=303)
    cursor = await db.execute("SELECT is_active, name FROM users WHERE id=?", (user_id,))
    row = await cursor.fetchone()
    if row:
        new_state = 0 if row["is_active"] else 1
        await db.execute("UPDATE users SET is_active=? WHERE id=?", (new_state, user_id))
        await db.commit()
        action = "activated" if new_state else "deactivated"
        request.session["admin_msg"] = f"ok:{row['name']} {action}."
    return RedirectResponse("/admin/users", status_code=303)


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    request: Request,
    new_password: str = Form(...),
    current_user=Depends(require_admin),
    db=Depends(get_db),
):
    if isinstance(current_user, RedirectResponse):
        return current_user
    if len(new_password) < 8:
        request.session["admin_msg"] = "error:Password must be at least 8 characters."
        return RedirectResponse("/admin/users", status_code=303)
    cursor = await db.execute("SELECT name FROM users WHERE id=?", (user_id,))
    row = await cursor.fetchone()
    if row:
        await db.execute(
            "UPDATE users SET hashed_password=? WHERE id=?",
            (hash_password(new_password), user_id),
        )
        await db.commit()
        request.session["admin_msg"] = f"ok:Password reset for {row['name']}."
    return RedirectResponse("/admin/users", status_code=303)
