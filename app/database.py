import json
import aiosqlite
from pathlib import Path

DB_PATH = Path("qa_tool.db")


# ── Row helper (shared by both backends) ─────────────────────────────────────

class _Row(dict):
    """Dict-based row that also supports integer index access like aiosqlite.Row."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


# ── Turso HTTP backend ────────────────────────────────────────────────────────

class _TursoConnection:
    """
    Talks to Turso via their HTTP pipeline API using httpx.
    No binary/Rust dependencies — works anywhere httpx is installed.
    """

    def __init__(self, url: str, token: str):
        # Accept both libsql:// and https:// prefixes
        self._url = url.replace("libsql://", "https://") + "/v2/pipeline"
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        self._last_insert_rowid = None

    async def _pipeline(self, stmts: list) -> list:
        import httpx
        requests = [{"type": "execute", "stmt": s} for s in stmts]
        requests.append({"type": "close"})
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(self._url, json={"requests": requests}, headers=self._headers)
            resp.raise_for_status()
        return resp.json()["results"]

    def _build_stmt(self, sql: str, params=()):
        args = []
        for p in params:
            if p is None:
                args.append({"type": "null", "value": None})
            elif isinstance(p, bool):
                args.append({"type": "integer", "value": str(int(p))})
            elif isinstance(p, int):
                args.append({"type": "integer", "value": str(p)})
            elif isinstance(p, float):
                args.append({"type": "float", "value": str(p)})
            else:
                args.append({"type": "text", "value": str(p)})
        return {"sql": sql, "args": args}

    def _parse_result(self, result: dict) -> "_TursoCursor":
        cols = [c["name"] for c in result.get("cols", [])]
        raw_rows = result.get("rows", [])
        rows = []
        for raw in raw_rows:
            vals = []
            for cell in raw:
                t, v = cell.get("type"), cell.get("value")
                if t == "null" or v is None:
                    vals.append(None)
                elif t == "integer":
                    vals.append(int(v))
                elif t == "float":
                    vals.append(float(v))
                else:
                    vals.append(v)
            rows.append(_Row(zip(cols, vals)))
        last_id = result.get("last_insert_rowid")
        if last_id is not None:
            self._last_insert_rowid = int(last_id)
        return _TursoCursor(cols, rows, self._last_insert_rowid)

    async def execute(self, sql: str, params=()):
        # Intercept last_insert_rowid() — return cached value without HTTP call
        if sql.strip().upper() == "SELECT LAST_INSERT_ROWID()":
            return _TursoCursor(["last_insert_rowid()"],
                                [_Row({"last_insert_rowid()": self._last_insert_rowid})],
                                self._last_insert_rowid)
        results = await self._pipeline([self._build_stmt(sql, params)])
        if results[0]["type"] == "error":
            raise Exception(results[0].get("error", {}).get("message", "Turso error"))
        return self._parse_result(results[0]["response"]["result"])

    async def executescript(self, sql: str):
        stmts = [s.strip() for s in sql.split(";") if s.strip()]
        if not stmts:
            return
        built = [self._build_stmt(s) for s in stmts]
        results = await self._pipeline(built)
        for i, r in enumerate(results[:-1]):  # last result is the "close" ack
            if r.get("type") == "error":
                msg = r.get("error", {}).get("message", "")
                # Swallow "already exists" / "duplicate column" — same as our try/except migrations
                if "already exists" not in msg and "duplicate column" not in msg:
                    raise Exception(f"Statement {i}: {msg}")
            elif r.get("type") == "ok":
                res = r.get("response", {}).get("result", {})
                last_id = res.get("last_insert_rowid")
                if last_id is not None:
                    self._last_insert_rowid = int(last_id)

    async def commit(self):
        pass  # Turso HTTP API auto-commits each statement

    async def close(self):
        pass  # Stateless HTTP — nothing to close


class _TursoCursor:
    def __init__(self, cols: list, rows: list, last_insert_rowid=None):
        self._cols = cols
        self._rows = rows
        self._last_insert_rowid = last_insert_rowid
        self._idx = 0
        self.description = [(c, None, None, None, None, None, None) for c in cols] if cols else None

    async def fetchone(self):
        if self._idx >= len(self._rows):
            return None
        row = self._rows[self._idx]
        self._idx += 1
        return row

    async def fetchall(self):
        rows = self._rows[self._idx:]
        self._idx = len(self._rows)
        return rows

    def __getitem__(self, key):
        if key == 0:
            return self._last_insert_rowid
        raise IndexError(key)


# ── Connection factory ────────────────────────────────────────────────────────

async def _connect():
    from app.config import settings
    url = settings.turso_database_url
    token = settings.turso_auth_token
    if url:
        return _TursoConnection(url, token)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def get_db():
    db = await _connect()
    try:
        yield db
    finally:
        await db.close()


# ── Schema init ───────────────────────────────────────────────────────────────

async def init_db():
    db = await _connect()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                hashed_password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL DEFAULT 'general',
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS qa_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT NOT NULL,
                ticket_subject TEXT,
                agent_name TEXT,
                agent_email TEXT,
                sop_id INTEGER,
                sop_name TEXT,
                overall_score INTEGER,
                criteria_scores TEXT,
                summary TEXT,
                strengths TEXT,
                improvements TEXT,
                raw_conversation TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_qa_reviews_ticket  ON qa_reviews(ticket_id);
            CREATE INDEX IF NOT EXISTS idx_qa_reviews_agent   ON qa_reviews(agent_email);
            CREATE INDEX IF NOT EXISTS idx_qa_reviews_created ON qa_reviews(created_at);

            CREATE TABLE IF NOT EXISTS dsat_analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT,
                ticket_subject TEXT,
                customer_name TEXT,
                context TEXT,
                raw_conversation TEXT,
                what_went_wrong TEXT,
                root_causes TEXT,
                customer_impact TEXT,
                csat_recovery_recommendations TEXT,
                follow_up_response TEXT,
                prevention_tips TEXT,
                recovery_probability TEXT,
                recovery_rationale TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_dsat_ticket ON dsat_analyses(ticket_id);
        """)

        for sql in [
            "ALTER TABLE dsat_analyses ADD COLUMN agent_name TEXT",
            "ALTER TABLE dsat_analyses ADD COLUMN improvements_comment TEXT",
            "ALTER TABLE qa_reviews ADD COLUMN sop_ids   TEXT",
            "ALTER TABLE qa_reviews ADD COLUMN sop_names TEXT",
            "ALTER TABLE qa_reviews ADD COLUMN sentiment TEXT",
            "ALTER TABLE qa_reviews ADD COLUMN sop_violations TEXT",
            "ALTER TABLE qa_reviews ADD COLUMN auditor_comment TEXT",
            "ALTER TABLE qa_reviews ADD COLUMN auditor_updated_at TIMESTAMP",
            "ALTER TABLE qa_reviews ADD COLUMN excluded_criteria TEXT",
            "ALTER TABLE qa_reviews ADD COLUMN score_edited_at TIMESTAMP",
            "ALTER TABLE qa_reviews ADD COLUMN tokens_input INTEGER",
            "ALTER TABLE qa_reviews ADD COLUMN tokens_output INTEGER",
            "ALTER TABLE qa_reviews ADD COLUMN tokens_cost_usd REAL",
            "ALTER TABLE qa_reviews ADD COLUMN dismissed_violations TEXT",
        ]:
            try:
                await db.execute(sql)
            except Exception:
                pass

        await db.commit()
    finally:
        await db.close()
