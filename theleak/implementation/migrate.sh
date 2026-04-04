#!/bin/bash
# =============================================================================
# OB1 Agentic Architecture — SQL Migration Runner
#
# Runs all 8 SQL migrations in order against a Supabase PostgreSQL database.
#
# Usage:
#   ./migrate.sh <supabase-db-url>
#   ./migrate.sh "postgresql://postgres.<ref>:<password>@aws-0-eu-north-1.pooler.supabase.com:6543/postgres"
#
# The DB URL can be found in Supabase Dashboard > Settings > Database > Connection string (URI).
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
if [ $# -lt 1 ]; then
  echo -e "${RED}Error: Missing database URL.${NC}"
  echo ""
  echo "Usage: ./migrate.sh <supabase-db-url>"
  echo ""
  echo "Example:"
  echo "  ./migrate.sh \"postgresql://postgres.abc123:yourpassword@aws-0-eu-north-1.pooler.supabase.com:6543/postgres\""
  echo ""
  echo "Find the URL in Supabase Dashboard > Settings > Database > Connection string (URI)."
  exit 1
fi

DB_URL="$1"

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
command -v psql >/dev/null 2>&1 || {
  echo -e "${RED}Error: psql not found.${NC}"
  echo "Install PostgreSQL client:"
  echo "  macOS:   brew install libpq && brew link --force libpq"
  echo "  Ubuntu:  sudo apt-get install postgresql-client"
  echo "  Windows: Install from https://www.postgresql.org/download/windows/"
  exit 1
}

# ---------------------------------------------------------------------------
# Locate migrations
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_DIR="$SCRIPT_DIR/sql/migrations"

if [ ! -d "$MIGRATION_DIR" ]; then
  echo -e "${RED}Error: Migration directory not found at $MIGRATION_DIR${NC}"
  exit 1
fi

# Collect and sort migration files
MIGRATIONS=($(ls "$MIGRATION_DIR"/*.sql 2>/dev/null | sort))

if [ ${#MIGRATIONS[@]} -eq 0 ]; then
  echo -e "${RED}Error: No .sql files found in $MIGRATION_DIR${NC}"
  exit 1
fi

echo -e "${CYAN}=== OB1 Agentic Architecture — SQL Migrations ===${NC}"
echo -e "Found ${GREEN}${#MIGRATIONS[@]}${NC} migration files."
echo ""

# ---------------------------------------------------------------------------
# Run each migration in order
# ---------------------------------------------------------------------------
PASSED=0
FAILED=0

for MIGRATION_FILE in "${MIGRATIONS[@]}"; do
  FILENAME="$(basename "$MIGRATION_FILE")"
  echo -n "  Running $FILENAME ... "

  # Run migration and capture output/errors
  if OUTPUT=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_FILE" 2>&1); then
    echo -e "${GREEN}OK${NC}"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}FAILED${NC}"
    echo -e "    ${RED}$OUTPUT${NC}" | head -5
    FAILED=$((FAILED + 1))
  fi
done

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All $PASSED migrations applied successfully.${NC}"
else
  echo -e "${YELLOW}Migrations complete: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}."
  echo -e "${RED}Fix the failed migrations and re-run.${NC}"
  exit 1
fi
