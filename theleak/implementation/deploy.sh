#!/bin/bash
# =============================================================================
# OB1 Agentic Architecture — Full Deployment Script
#
# Deploys the complete agentic architecture to Supabase:
#   1. Checks prerequisites (supabase CLI, psql, linked project)
#   2. Runs all 8 SQL migrations in order
#   3. Deploys all 7 Edge Functions
#   4. Sets required secrets (OB1_ACCESS_KEY, OPENAI_API_KEY)
#   5. Runs a quick smoke test (agent-doctor run_doctor)
#
# Usage:
#   ./deploy.sh                      # Interactive — prompts for secrets
#   ./deploy.sh --skip-migrations    # Skip SQL migrations (already applied)
#   ./deploy.sh --skip-secrets       # Skip secret prompts (already set)
#   ./deploy.sh --db-url <url>       # Provide DB URL for migrations
#
# Prerequisites:
#   - supabase CLI installed and logged in
#   - Project linked (supabase link --project-ref <ref>)
#   - psql available (for migrations)
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
SKIP_MIGRATIONS=false
SKIP_SECRETS=false
DB_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-migrations) SKIP_MIGRATIONS=true; shift ;;
    --skip-secrets)    SKIP_SECRETS=true; shift ;;
    --db-url)          DB_URL="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: ./deploy.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --skip-migrations    Skip SQL migrations (already applied)"
      echo "  --skip-secrets       Skip setting secrets (already configured)"
      echo "  --db-url <url>       Provide database URL for migrations"
      echo "  -h, --help           Show this help"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Script directory (resolve relative paths)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║   OB1 Agentic Architecture — Deploy           ║"
echo "  ║   7 Edge Functions · 8 Migrations · 1 Brain   ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo -e "${NC}"

# ---------------------------------------------------------------------------
# Step 0: Check prerequisites
# ---------------------------------------------------------------------------
echo -e "${CYAN}[Step 0] Checking prerequisites ...${NC}"

# supabase CLI
if ! command -v supabase >/dev/null 2>&1; then
  echo -e "${RED}Error: supabase CLI not found.${NC}"
  echo "Install it:"
  echo "  macOS:    brew install supabase/tap/supabase"
  echo "  npm:      npm install -g supabase"
  echo "  Windows:  scoop install supabase"
  echo "  Other:    https://supabase.com/docs/guides/cli/getting-started"
  exit 1
fi
echo -e "  ${GREEN}supabase CLI${NC} — $(supabase --version 2>&1 | head -1)"

# psql (needed for migrations)
if [ "$SKIP_MIGRATIONS" = false ]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo -e "${YELLOW}Warning: psql not found. Migrations will be skipped.${NC}"
    echo "Install PostgreSQL client to run migrations:"
    echo "  macOS:   brew install libpq && brew link --force libpq"
    echo "  Ubuntu:  sudo apt-get install postgresql-client"
    SKIP_MIGRATIONS=true
  else
    echo -e "  ${GREEN}psql${NC} — $(psql --version 2>&1 | head -1)"
  fi
fi

# curl (needed for smoke test)
if ! command -v curl >/dev/null 2>&1; then
  echo -e "${YELLOW}Warning: curl not found. Smoke test will be skipped.${NC}"
  SKIP_SMOKE=true
else
  SKIP_SMOKE=false
fi

# Check supabase is linked to a project
if ! supabase functions list >/dev/null 2>&1; then
  echo -e "${RED}Error: Supabase project not linked.${NC}"
  echo "Run:  supabase link --project-ref <your-project-ref>"
  echo "Find your project ref in the Supabase dashboard URL."
  exit 1
fi
echo -e "  ${GREEN}Supabase project linked${NC}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Run SQL migrations
# ---------------------------------------------------------------------------
if [ "$SKIP_MIGRATIONS" = true ]; then
  echo -e "${YELLOW}[Step 1] Skipping SQL migrations (--skip-migrations)${NC}"
  echo ""
else
  echo -e "${CYAN}[Step 1] Running SQL migrations ...${NC}"

  # Get DB URL
  if [ -z "$DB_URL" ]; then
    echo -e "${YELLOW}Enter your Supabase database URL:${NC}"
    echo "  (Dashboard > Settings > Database > Connection string > URI)"
    echo -n "  DB URL: "
    read -r DB_URL
    echo ""

    if [ -z "$DB_URL" ]; then
      echo -e "${RED}Error: No database URL provided. Cannot run migrations.${NC}"
      echo "Use --skip-migrations to skip, or --db-url to provide inline."
      exit 1
    fi
  fi

  MIGRATION_DIR="$SCRIPT_DIR/sql/migrations"
  MIGRATIONS=($(ls "$MIGRATION_DIR"/*.sql 2>/dev/null | sort))

  if [ ${#MIGRATIONS[@]} -eq 0 ]; then
    echo -e "${RED}Error: No migration files found in $MIGRATION_DIR${NC}"
    exit 1
  fi

  MIGRATION_PASSED=0
  MIGRATION_FAILED=0

  for MIGRATION_FILE in "${MIGRATIONS[@]}"; do
    FILENAME="$(basename "$MIGRATION_FILE")"
    echo -n "  $FILENAME ... "

    if OUTPUT=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_FILE" 2>&1); then
      echo -e "${GREEN}OK${NC}"
      MIGRATION_PASSED=$((MIGRATION_PASSED + 1))
    else
      echo -e "${RED}FAILED${NC}"
      echo -e "    ${RED}$(echo "$OUTPUT" | head -3)${NC}"
      MIGRATION_FAILED=$((MIGRATION_FAILED + 1))
    fi
  done

  echo -e "  Migrations: ${GREEN}$MIGRATION_PASSED passed${NC}"
  if [ $MIGRATION_FAILED -gt 0 ]; then
    echo -e "  ${RED}$MIGRATION_FAILED failed — continuing with deployment${NC}"
  fi
  echo ""
fi

# ---------------------------------------------------------------------------
# Step 2: Deploy Edge Functions
# ---------------------------------------------------------------------------
echo -e "${CYAN}[Step 2] Deploying 7 Edge Functions ...${NC}"

FUNCTIONS_DIR="$SCRIPT_DIR/functions"
FUNCTIONS=(
  "agent-tools"
  "agent-state"
  "agent-stream"
  "agent-doctor"
  "agent-memory"
  "agent-skills"
  "agent-coordinator"
)

DEPLOY_PASSED=0
DEPLOY_FAILED=0

for FN in "${FUNCTIONS[@]}"; do
  FN_DIR="$FUNCTIONS_DIR/$FN"

  if [ ! -d "$FN_DIR" ]; then
    echo -e "  ${RED}SKIP${NC} $FN — directory not found at $FN_DIR"
    DEPLOY_FAILED=$((DEPLOY_FAILED + 1))
    continue
  fi

  echo -n "  Deploying $FN ... "

  if OUTPUT=$(supabase functions deploy "$FN" --no-verify-jwt 2>&1); then
    echo -e "${GREEN}OK${NC}"
    DEPLOY_PASSED=$((DEPLOY_PASSED + 1))
  else
    echo -e "${RED}FAILED${NC}"
    echo -e "    ${RED}$(echo "$OUTPUT" | tail -3)${NC}"
    DEPLOY_FAILED=$((DEPLOY_FAILED + 1))
  fi
done

echo -e "  Functions: ${GREEN}$DEPLOY_PASSED deployed${NC}"
if [ $DEPLOY_FAILED -gt 0 ]; then
  echo -e "  ${RED}$DEPLOY_FAILED failed${NC}"
fi
echo ""

# ---------------------------------------------------------------------------
# Step 3: Set secrets
# ---------------------------------------------------------------------------
if [ "$SKIP_SECRETS" = true ]; then
  echo -e "${YELLOW}[Step 3] Skipping secrets (--skip-secrets)${NC}"
  echo ""
else
  echo -e "${CYAN}[Step 3] Setting Edge Function secrets ...${NC}"
  echo ""
  echo "  The following secrets are required by the Edge Functions:"
  echo "    - OB1_ACCESS_KEY   — Shared secret for x-access-key auth header"
  echo "    - OPENAI_API_KEY   — OpenAI key for embedding generation"
  echo ""

  # OB1_ACCESS_KEY
  echo -n "  OB1_ACCESS_KEY: "
  read -rs OB1_KEY
  echo ""

  if [ -z "$OB1_KEY" ]; then
    echo -e "  ${YELLOW}Skipped OB1_ACCESS_KEY (empty input)${NC}"
  else
    if supabase secrets set OB1_ACCESS_KEY="$OB1_KEY" 2>&1; then
      echo -e "  ${GREEN}OB1_ACCESS_KEY set${NC}"
    else
      echo -e "  ${RED}Failed to set OB1_ACCESS_KEY${NC}"
    fi
  fi

  # OPENAI_API_KEY
  echo -n "  OPENAI_API_KEY: "
  read -rs OPENAI_KEY
  echo ""

  if [ -z "$OPENAI_KEY" ]; then
    echo -e "  ${YELLOW}Skipped OPENAI_API_KEY (empty input)${NC}"
  else
    if supabase secrets set OPENAI_API_KEY="$OPENAI_KEY" 2>&1; then
      echo -e "  ${GREEN}OPENAI_API_KEY set${NC}"
    else
      echo -e "  ${RED}Failed to set OPENAI_API_KEY${NC}"
    fi
  fi

  echo ""
fi

# ---------------------------------------------------------------------------
# Step 4: Smoke test (agent-doctor run_doctor)
# ---------------------------------------------------------------------------
if [ "$SKIP_SMOKE" = true ]; then
  echo -e "${YELLOW}[Step 4] Skipping smoke test (curl not available)${NC}"
else
  echo -e "${CYAN}[Step 4] Smoke test — calling agent-doctor run_doctor ...${NC}"

  # Get the project URL from supabase status or functions list
  PROJECT_URL=""

  # Try to extract from supabase status
  if STATUS_OUTPUT=$(supabase status 2>&1); then
    PROJECT_URL=$(echo "$STATUS_OUTPUT" | grep -i "API URL" | sed 's/.*: *//' | tr -d '[:space:]')
  fi

  # If we still don't have it, ask
  if [ -z "$PROJECT_URL" ]; then
    echo -e "  ${YELLOW}Could not detect project URL automatically.${NC}"
    echo -n "  Enter your Supabase project URL (e.g., https://abc123.supabase.co): "
    read -r PROJECT_URL
  fi

  if [ -z "$PROJECT_URL" ]; then
    echo -e "  ${YELLOW}No project URL — skipping smoke test${NC}"
  else
    # We need the access key for the smoke test
    if [ -z "${OB1_KEY:-}" ]; then
      echo -n "  Enter OB1_ACCESS_KEY for smoke test: "
      read -rs OB1_KEY
      echo ""
    fi

    if [ -z "$OB1_KEY" ]; then
      echo -e "  ${YELLOW}No access key — skipping smoke test${NC}"
    else
      SMOKE_URL="${PROJECT_URL}/functions/v1/agent-doctor"
      echo -e "  Calling ${BOLD}$SMOKE_URL${NC} ..."

      RESPONSE=$(curl -s -w "\n%{http_code}" \
        -X POST "$SMOKE_URL" \
        -H "Content-Type: application/json" \
        -H "x-access-key: $OB1_KEY" \
        -d '{"action":"run_doctor"}' \
        --connect-timeout 10 \
        --max-time 30 2>&1) || true

      HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
      BODY=$(echo "$RESPONSE" | sed '$d')

      if [ "$HTTP_STATUS" = "200" ]; then
        echo -e "  ${GREEN}Smoke test PASSED${NC} (HTTP 200)"
        # Try to show overall status if jq is available
        if command -v jq >/dev/null 2>&1; then
          OVERALL=$(echo "$BODY" | jq -r '.overall_status // empty' 2>/dev/null)
          if [ -n "$OVERALL" ]; then
            echo -e "  Doctor overall status: ${BOLD}$OVERALL${NC}"
          fi
        fi
      else
        echo -e "  ${RED}Smoke test FAILED${NC} (HTTP $HTTP_STATUS)"
        echo -e "  ${RED}$(echo "$BODY" | head -3)${NC}"
        echo ""
        echo -e "  ${YELLOW}The deployment completed but the doctor check failed.${NC}"
        echo "  Run the full smoke test for details: ./smoke-test.sh \"$PROJECT_URL\" <access-key>"
      fi
    fi
  fi
fi

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo -e "${CYAN}${BOLD}=== Deployment Summary ===${NC}"
echo ""

if [ "$SKIP_MIGRATIONS" = false ]; then
  echo -e "  SQL Migrations:  ${GREEN}${MIGRATION_PASSED:-0}${NC} / ${#MIGRATIONS[@]} applied"
fi
echo -e "  Edge Functions:  ${GREEN}$DEPLOY_PASSED${NC} / ${#FUNCTIONS[@]} deployed"
if [ "$SKIP_SECRETS" = false ]; then
  echo -e "  Secrets:         configured"
fi

echo ""

if [ $DEPLOY_FAILED -gt 0 ] || [ "${MIGRATION_FAILED:-0}" -gt 0 ]; then
  echo -e "${YELLOW}Deployment completed with some issues. Review the output above.${NC}"
else
  echo -e "${GREEN}Deployment completed successfully.${NC}"
fi

echo ""
echo "Next steps:"
echo "  1. Run the full smoke test:  ./smoke-test.sh <supabase-url> <access-key>"
echo "  2. Start the local runtime:  cd runtime && npm start"
echo "  3. Check the doctor report:  curl -X POST <url>/functions/v1/agent-doctor \\"
echo "       -H 'x-access-key: <key>' -d '{\"action\":\"run_doctor\"}'"
echo ""
