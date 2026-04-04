#!/bin/bash
set -euo pipefail

# ============================================
# Bacowr SaaS — Deploy Script
# ============================================
# Deploys: Supabase schema + Edge Function + Worker
# Usage: ./deploy.sh [--skip-schema] [--skip-function] [--skip-worker]

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SKIP_SCHEMA=false
SKIP_FUNCTION=false
SKIP_WORKER=false

for arg in "$@"; do
  case $arg in
    --skip-schema) SKIP_SCHEMA=true ;;
    --skip-function) SKIP_FUNCTION=true ;;
    --skip-worker) SKIP_WORKER=true ;;
  esac
done

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Bacowr SaaS — Deploy               ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# ---- Step 1: Prerequisites ----
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"

if ! command -v supabase &>/dev/null; then
  echo -e "${RED}✗ supabase CLI not found${NC}"
  echo "  Install: brew install supabase/tap/supabase"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo -e "${YELLOW}⚠ docker not found — worker deploy will be skipped${NC}"
  SKIP_WORKER=true
fi

echo -e "${GREEN}✓ Prerequisites OK${NC}"

# ---- Step 2: Schema ----
if [ "$SKIP_SCHEMA" = false ]; then
  echo ""
  echo -e "${YELLOW}[2/5] Running Bacowr schema migration...${NC}"

  MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/001_bacowr_saas.sql"

  if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}✗ Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
  fi

  # Try psql first, fall back to supabase db push
  if command -v psql &>/dev/null && [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_FILE"
    echo -e "${GREEN}✓ Schema migration complete (via psql)${NC}"
  else
    echo "  No DATABASE_URL set. Run manually in Supabase SQL Editor:"
    echo "  File: $MIGRATION_FILE"
    echo -e "${YELLOW}⚠ Schema migration skipped (manual step needed)${NC}"
  fi
else
  echo -e "${YELLOW}[2/5] Schema migration skipped${NC}"
fi

# ---- Step 3: Edge Function ----
if [ "$SKIP_FUNCTION" = false ]; then
  echo ""
  echo -e "${YELLOW}[3/5] Deploying bacowr-api Edge Function...${NC}"

  FUNCTION_DIR="$(dirname "$0")/../supabase/functions/bacowr-api"

  if [ ! -d "$FUNCTION_DIR" ]; then
    echo -e "${RED}✗ Function directory not found: $FUNCTION_DIR${NC}"
    exit 1
  fi

  cd "$(dirname "$0")/.."
  supabase functions deploy bacowr-api --no-verify-jwt 2>&1 || {
    echo -e "${YELLOW}⚠ Edge Function deploy failed. Is Supabase linked?${NC}"
    echo "  Run: supabase link --project-ref <your-project-ref>"
  }
  cd - >/dev/null

  echo -e "${GREEN}✓ Edge Function deployed${NC}"
else
  echo -e "${YELLOW}[3/5] Edge Function deploy skipped${NC}"
fi

# ---- Step 4: Worker ----
if [ "$SKIP_WORKER" = false ]; then
  echo ""
  echo -e "${YELLOW}[4/5] Building worker Docker image...${NC}"

  cd "$(dirname "$0")/.."
  docker build -t bacowr-worker -f worker/Dockerfile . 2>&1 | tail -5
  cd - >/dev/null

  echo -e "${GREEN}✓ Worker image built: bacowr-worker${NC}"
  echo ""
  echo "  To run locally:"
  echo "    docker run -p 8080:8080 --env-file worker/.env bacowr-worker"
  echo ""
  echo "  To run without Docker:"
  echo "    cd worker && pip install -r requirements.txt && uvicorn main:app --port 8080"
else
  echo -e "${YELLOW}[4/5] Worker build skipped${NC}"
fi

# ---- Step 5: Smoke Test ----
echo ""
echo -e "${YELLOW}[5/5] Smoke test...${NC}"

# Test worker health (if running)
if curl -s http://localhost:8080/health >/dev/null 2>&1; then
  HEALTH=$(curl -s http://localhost:8080/health)
  echo -e "${GREEN}✓ Worker health: $HEALTH${NC}"
else
  echo -e "${YELLOW}⚠ Worker not running (start it to test)${NC}"
fi

# Test Edge Function (if configured)
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${BACOWR_API_KEY:-}" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${SUPABASE_URL}/functions/v1/bacowr-api" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${BACOWR_API_KEY}" \
    -d '{"action": "get_profile"}')

  if [ "$STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Edge Function responding${NC}"
  else
    echo -e "${YELLOW}⚠ Edge Function returned HTTP $STATUS${NC}"
  fi
else
  echo -e "${YELLOW}⚠ Set SUPABASE_URL + BACOWR_API_KEY to test Edge Function${NC}"
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════${NC}"
echo -e "${GREEN}Deploy complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Run schema migration in Supabase SQL Editor (if not done via psql)"
echo "  2. Start worker: cd worker && uvicorn main:app --port 8080"
echo "  3. Test: curl http://localhost:8080/health"
echo "  4. Submit a test job via the Edge Function API"
