import json
import aiosqlite
from pathlib import Path

DB_PATH = Path("qa_tool.db")


async def _connect():
    from app.config import settings
    url, token = settings.turso_database_url, settings.turso_auth_token
    if url:
        import libsql_experimental as libsql
        conn = libsql.connect(database=url, auth_token=token)
        conn.row_factory = _libsql_row_factory(conn)
        return _LibSQLWrapper(conn)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


class _LibSQLRow(dict):
    """Makes libsql rows subscriptable like aiosqlite.Row."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def _libsql_row_factory(conn):
    def factory(cursor, row):
        cols = [d[0] for d in cursor.description]
        return _LibSQLRow(zip(cols, row))
    return factory


class _LibSQLWrapper:
    """Wraps a synchronous libsql connection with an aiosqlite-compatible async API."""
    def __init__(self, conn):
        self._conn = conn
        self._conn.row_factory = None  # we handle this in execute

    async def execute(self, sql, params=()):
        cursor = self._conn.execute(sql, params)
        cursor._cols = [d[0] for d in (cursor.description or [])]
        return _LibSQLCursorWrapper(cursor)

    async def executescript(self, sql):
        self._conn.executescript(sql)

    async def commit(self):
        self._conn.commit()

    async def close(self):
        self._conn.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        self.close()


class _LibSQLCursorWrapper:
    def __init__(self, cursor):
        self._cursor = cursor

    async def fetchone(self):
        row = self._cursor.fetchone()
        if row is None:
            return None
        cols = [d[0] for d in self._cursor.description] if self._cursor.description else []
        return _LibSQLRow(zip(cols, row)) if cols else row

    async def fetchall(self):
        rows = self._cursor.fetchall()
        cols = [d[0] for d in self._cursor.description] if self._cursor.description else []
        return [_LibSQLRow(zip(cols, r)) for r in rows] if cols else rows

    @property
    def description(self):
        return self._cursor.description


async def get_db():
    db = await _connect()
    try:
        yield db
    finally:
        await db.close()


async def init_db():
    db = await _connect()
    try:
        # Users table (must come first — referenced by sessions)
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
        """)

        # Core tables
        await db.executescript("""
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
                sop_id INTEGER REFERENCES sops(id),
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
        """)

        # DSAT analyses table
        await db.executescript("""
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

        # ── DSAT additive migrations ──────────────────────────────────────
        dsat_migrations = [
            "ALTER TABLE dsat_analyses ADD COLUMN agent_name TEXT",
            "ALTER TABLE dsat_analyses ADD COLUMN improvements_comment TEXT",
        ]
        for sql in dsat_migrations:
            try:
                await db.execute(sql)
            except Exception:
                pass

        # ── Additive migrations ───────────────────────────────────────────
        migrations = [
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
        ]
        for sql in migrations:
            try:
                await db.execute(sql)
            except Exception:
                pass

        await db.commit()
    finally:
        await db.close()
