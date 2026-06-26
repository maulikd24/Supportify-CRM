from fastapi import FastAPI

app = FastAPI()

@app.get("/api/ping")
async def ping():
    import sys, os
    return {"ok": True, "python": sys.version, "cwd": os.getcwd()}
