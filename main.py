from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse
from contextlib import asynccontextmanager
from starlette.middleware.sessions import SessionMiddleware
from app.database import init_db
from app.config import settings
from app.routers import sops, reviews, ui, dsat
from app.routers import auth as auth_router
from app.routers import admin as admin_router

templates = Jinja2Templates(directory="templates")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
    except Exception as e:
        import traceback
        print(f"[startup] init_db failed: {e}\n{traceback.format_exc()}")
    yield


app = FastAPI(title="QA Sentinel", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    detail = "; ".join(
        f"{' → '.join(str(l) for l in e['loc'])}: {e['msg']}"
        for e in exc.errors()
    )
    return templates.TemplateResponse(
        "error.html",
        {"request": request, "error": f"Missing required fields: {detail}"},
        status_code=422,
    )


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    return templates.TemplateResponse(
        "error.html",
        {"request": request, "error": "Page not found."},
        status_code=404,
    )


app.include_router(auth_router.router)
app.include_router(admin_router.router)
app.include_router(ui.router)
app.include_router(dsat.router)
app.include_router(sops.router, prefix="/api")
app.include_router(reviews.router, prefix="/api")
