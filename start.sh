#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "  🔍  Zendesk QA Tool"
echo "  ────────────────────────────────"

# ── 1. Check .env ──────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo -e "  ${YELLOW}⚠  No .env file found — copying from .env.example${NC}"
  cp .env.example .env
  echo -e "  ${YELLOW}   Edit .env and add your API keys, then re-run this script.${NC}"
  echo ""
fi

# ── 2. Check Python ────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo -e "  ${RED}✗  python3 not found. Install Python 3.9+ and try again.${NC}"
  exit 1
fi
PYTHON=$(command -v python3)
echo -e "  ${GREEN}✓${NC}  Python: $($PYTHON --version)"

# ── 3. Install / verify dependencies ──────────────────────────────────────
echo -e "  ${YELLOW}…${NC}  Checking dependencies…"
if ! $PYTHON -c "import fastapi, uvicorn, anthropic, aiosqlite, jinja2" &>/dev/null; then
  echo -e "  ${YELLOW}…${NC}  Installing requirements…"
  $PYTHON -m pip install -q -r requirements.txt
  echo -e "  ${GREEN}✓${NC}  Dependencies installed"
else
  echo -e "  ${GREEN}✓${NC}  Dependencies already installed"
fi

# ── 4. Kill any existing instance on port 8000 ─────────────────────────────
if lsof -ti:8000 &>/dev/null; then
  echo -e "  ${YELLOW}…${NC}  Port 8000 in use — stopping existing process"
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── 5. Start the server ────────────────────────────────────────────────────
echo -e "  ${GREEN}✓${NC}  Starting server on http://localhost:8000"
echo ""
echo "  Press Ctrl+C to stop."
echo "  ────────────────────────────────"
echo ""

$PYTHON -m uvicorn main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --loop asyncio \
  --http h11
