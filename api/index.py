import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from main import app
except Exception as _import_err:
    import traceback
    from fastapi import FastAPI

    app = FastAPI()
    _tb = traceback.format_exc()

    @app.get("/{path:path}")
    async def _diag(path: str):
        return {"error": str(_import_err), "traceback": _tb, "python": sys.version, "cwd": os.getcwd(), "syspath": sys.path}
