from pathlib import Path
from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from app.database import get_db
from app.auth import hash_password, verify_password

router = APIRouter(tags=["Auth"])
templates = Jinja2Templates(directory=str(Path(__file__).parent.parent.parent / "templates"))


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, db=Depends(get_db)):
    # Already logged in → dashboard
    if request.session.get("user_id"):
        return RedirectResponse("/", status_code=302)
    # No users yet → first-run setup
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    count = (await cursor.fetchone())[0]
    if count == 0:
        return RedirectResponse("/setup", status_code=302)
    error = request.session.pop("login_error", None)
    return templates.TemplateResponse("login.html", {"request": request, "error": error})


@router.post("/login")
async def login_submit(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db=Depends(get_db),
):
    cursor = await db.execute(
        "SELECT * FROM users WHERE email=? AND is_active=1", (email.strip().lower(),)
    )
    row = await cursor.fetchone()
    user = dict(row) if row else None
    if not user or not verify_password(password, user["hashed_password"]):
        request.session["login_error"] = "Invalid email or password."
        return RedirectResponse("/login", status_code=303)
    request.session["user_id"] = user["id"]
    return RedirectResponse("/", status_code=302)


@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=302)


@router.get("/setup", response_class=HTMLResponse)
async def setup_page(request: Request, db=Depends(get_db)):
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    count = (await cursor.fetchone())[0]
    if count > 0:
        return RedirectResponse("/login", status_code=302)
    error = request.session.pop("setup_error", None)
    return templates.TemplateResponse("setup.html", {"request": request, "error": error})


@router.post("/setup")
async def setup_submit(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    db=Depends(get_db),
):
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    count = (await cursor.fetchone())[0]
    if count > 0:
        return RedirectResponse("/login", status_code=302)
    if len(password) < 8:
        request.session["setup_error"] = "Password must be at least 8 characters."
        return RedirectResponse("/setup", status_code=303)
    try:
        await db.execute(
            "INSERT INTO users (name, email, hashed_password, role) VALUES (?,?,?,?)",
            (name.strip(), email.strip().lower(), hash_password(password), "admin"),
        )
        await db.commit()
    except Exception as e:
        request.session["setup_error"] = f"Could not create account: {e}"
        return RedirectResponse("/setup", status_code=303)
    return RedirectResponse("/login", status_code=302)
