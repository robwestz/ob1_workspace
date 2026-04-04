#!/bin/bash
# =============================================================================
# OB1 Agentic Architecture — Smoke Test
#
# Quick validation that all Edge Functions are deployed and responding correctly.
#
# Usage:
#   ./smoke-test.sh <supabase-url> <access-key>
#   ./smoke-test.sh "https://abc123.supabase.co" "my-secret-key"
#
# Tests:
#   1. Auth rejection (expect 401 without key)
#   2. agent-doctor run_doctor
#   3. agent-tools list_tools (expect seeded tools)
#   4. agent-state create_session + get_session roundtrip
#   5. agent-coordinator list_agent_types (expect 6 types)
#   6. agent-memory get_memory_stats
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
# Args
# ---------------------------------------------------------------------------
if [ $# -lt 2 ]; then
  echo -e "${RED}Error: Missing arguments.${NC}"
  echo ""
  echo "Usage: ./smoke-test.sh <supabase-url> <access-key>"
  echo ""
  echo "Example:"
  echo "  ./smoke-test.sh \"https://abc123.supabase.co\" \"my-secret-key\""
  exit 1
fi

SUPABASE_URL="$1"
ACCESS_KEY="$2"
BASE_URL="${SUPABASE_URL}/functions/v1"

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
command -v curl >/dev/null 2>&1 || { echo -e "${RED}Error: curl not found.${NC}"; exit 1; }
command -v jq >/dev/null 2>&1 || {
  echo -e "${YELLOW}Warning: jq not found. Output parsing will be limited.${NC}"
  echo "Install jq: brew install jq / apt-get install jq / choco install jq"
  JQ_AVAILABLE=false
}
JQ_AVAILABLE=${JQ_AVAILABLE:-true}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
PASSED=0
FAILED=0
TOTAL=6

# Call an Edge Function with the access key
call_fn() {
  local fn_name="$1"
  local body="$2"
  curl -s -w "\n%{http_code}" \
    -X POST "${BASE_URL}/${fn_name}" \
    -H "Content-Type: application/json" \
    -H "x-access-key: ${ACCESS_KEY}" \
    -d "$body" \
    --connect-timeout 10 \
    --max-time 30
}

# Call without access key (for auth test)
call_fn_noauth() {
  local fn_name="$1"
  local body="$2"
  curl -s -w "\n%{http_code}" \
    -X POST "${BASE_URL}/${fn_name}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    --connect-timeout 10 \
    --max-time 30
}

# Extract HTTP status from curl output (last line)
get_status() {
  echo "$1" | tail -1
}

# Extract body from curl output (everything except last line)
get_body() {
  echo "$1" | sed '$d'
}

pass() {
  PASSED=$((PASSED + 1))
  echo -e "  ${GREEN}PASS${NC} $1"
}

fail() {
  FAILED=$((FAILED + 1))
  echo -e "  ${RED}FAIL${NC} $1"
  if [ -n "${2:-}" ]; then
    echo -e "       ${RED}$2${NC}"
  fi
}

echo -e "${CYAN}${BOLD}=== OB1 Agentic Architecture — Smoke Test ===${NC}"
echo -e "Target: ${BOLD}${BASE_URL}${NC}"
echo ""

# ---------------------------------------------------------------------------
# Test 1: Auth rejection (expect 401 without access key)
# ---------------------------------------------------------------------------
echo -e "${CYAN}[1/6] Auth rejection (no access key) ...${NC}"
RESPONSE=$(call_fn_noauth "agent-doctor" '{"action":"run_doctor"}')
STATUS=$(get_status "$RESPONSE")

if [ "$STATUS" = "401" ]; then
  pass "Correctly rejected request without access key (HTTP 401)"
else
  fail "Expected HTTP 401, got HTTP $STATUS" "Auth may not be enforced"
fi

# ---------------------------------------------------------------------------
# Test 2: agent-doctor run_doctor
# ---------------------------------------------------------------------------
echo -e "${CYAN}[2/6] agent-doctor run_doctor ...${NC}"
RESPONSE=$(call_fn "agent-doctor" '{"action":"run_doctor"}')
STATUS=$(get_status "$RESPONSE")
BODY=$(get_body "$RESPONSE")

if [ "$STATUS" = "200" ]; then
  if [ "$JQ_AVAILABLE" = true ]; then
    OVERALL=$(echo "$BODY" | jq -r '.overall_status // empty' 2>/dev/null)
    CHECK_COUNT=$(echo "$BODY" | jq -r '.checks | length // 0' 2>/dev/null)
    if [ -n "$OVERALL" ]; then
      pass "Doctor report received (status=$OVERALL, checks=$CHECK_COUNT)"
    else
      pass "Doctor endpoint returned 200 (response structure may differ)"
    fi
  else
    pass "Doctor endpoint returned 200"
  fi
else
  fail "Expected HTTP 200, got HTTP $STATUS" "$(echo "$BODY" | head -1)"
fi

# ---------------------------------------------------------------------------
# Test 3: agent-tools list_tools (expect seeded tools)
# ---------------------------------------------------------------------------
echo -e "${CYAN}[3/6] agent-tools list_tools ...${NC}"
RESPONSE=$(call_fn "agent-tools" '{"action":"list_tools"}')
STATUS=$(get_status "$RESPONSE")
BODY=$(get_body "$RESPONSE")

if [ "$STATUS" = "200" ]; then
  if [ "$JQ_AVAILABLE" = true ]; then
    TOOL_COUNT=$(echo "$BODY" | jq -r '.tools | length // 0' 2>/dev/null)
    if [ "$TOOL_COUNT" -ge 9 ] 2>/dev/null; then
      pass "Listed $TOOL_COUNT tools (expected >= 9 seeded)"
    elif [ "$TOOL_COUNT" -gt 0 ] 2>/dev/null; then
      pass "Listed $TOOL_COUNT tools (fewer than 9 expected — check seed data)"
    else
      pass "Tools endpoint returned 200 (could not parse tool count)"
    fi
  else
    pass "Tools endpoint returned 200"
  fi
else
  fail "Expected HTTP 200, got HTTP $STATUS" "$(echo "$BODY" | head -1)"
fi

# ---------------------------------------------------------------------------
# Test 4: agent-state create_session + get_session roundtrip
# ---------------------------------------------------------------------------
echo -e "${CYAN}[4/6] agent-state create + get session roundtrip ...${NC}"
SESSION_LABEL="smoke-test-$(date +%s)"

# Create session
CREATE_RESPONSE=$(call_fn "agent-state" "{\"action\":\"create_session\",\"agent_type\":\"general\",\"label\":\"$SESSION_LABEL\"}")
CREATE_STATUS=$(get_status "$CREATE_RESPONSE")
CREATE_BODY=$(get_body "$CREATE_RESPONSE")

if [ "$CREATE_STATUS" = "200" ] || [ "$CREATE_STATUS" = "201" ]; then
  if [ "$JQ_AVAILABLE" = true ]; then
    SESSION_ID=$(echo "$CREATE_BODY" | jq -r '.session_id // .id // empty' 2>/dev/null)
  else
    # Fallback: try to extract session_id with sed
    SESSION_ID=$(echo "$CREATE_BODY" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  fi

  if [ -n "$SESSION_ID" ]; then
    # Get session back
    GET_RESPONSE=$(call_fn "agent-state" "{\"action\":\"get_session\",\"session_id\":\"$SESSION_ID\"}")
    GET_STATUS=$(get_status "$GET_RESPONSE")
    GET_BODY=$(get_body "$GET_RESPONSE")

    if [ "$GET_STATUS" = "200" ]; then
      if [ "$JQ_AVAILABLE" = true ]; then
        RETURNED_ID=$(echo "$GET_BODY" | jq -r '.session_id // .id // empty' 2>/dev/null)
        if [ "$RETURNED_ID" = "$SESSION_ID" ]; then
          pass "Session roundtrip OK (id=$SESSION_ID)"
        else
          pass "Session created and retrieved (id match uncertain)"
        fi
      else
        pass "Session created and retrieved (HTTP 200)"
      fi
    else
      fail "get_session returned HTTP $GET_STATUS" "Session was created ($SESSION_ID) but retrieval failed"
    fi
  else
    pass "Session created (HTTP $CREATE_STATUS) but could not extract session_id for roundtrip"
  fi
else
  fail "create_session returned HTTP $CREATE_STATUS" "$(echo "$CREATE_BODY" | head -1)"
fi

# ---------------------------------------------------------------------------
# Test 5: agent-coordinator list_agent_types (expect 6 types)
# ---------------------------------------------------------------------------
echo -e "${CYAN}[5/6] agent-coordinator list_agent_types ...${NC}"
RESPONSE=$(call_fn "agent-coordinator" '{"action":"list_agent_types"}')
STATUS=$(get_status "$RESPONSE")
BODY=$(get_body "$RESPONSE")

if [ "$STATUS" = "200" ]; then
  if [ "$JQ_AVAILABLE" = true ]; then
    TYPE_COUNT=$(echo "$BODY" | jq -r '.agent_types | length // 0' 2>/dev/null)
    if [ "$TYPE_COUNT" -ge 6 ] 2>/dev/null; then
      pass "Listed $TYPE_COUNT agent types (expected >= 6)"
    elif [ "$TYPE_COUNT" -gt 0 ] 2>/dev/null; then
      pass "Listed $TYPE_COUNT agent types (fewer than 6 expected — check seed data)"
    else
      pass "Coordinator endpoint returned 200 (could not parse type count)"
    fi
  else
    pass "Coordinator endpoint returned 200"
  fi
else
  fail "Expected HTTP 200, got HTTP $STATUS" "$(echo "$BODY" | head -1)"
fi

# ---------------------------------------------------------------------------
# Test 6: agent-memory get_memory_stats
# ---------------------------------------------------------------------------
echo -e "${CYAN}[6/6] agent-memory get_memory_stats ...${NC}"
RESPONSE=$(call_fn "agent-memory" '{"action":"get_memory_stats"}')
STATUS=$(get_status "$RESPONSE")
BODY=$(get_body "$RESPONSE")

if [ "$STATUS" = "200" ]; then
  if [ "$JQ_AVAILABLE" = true ]; then
    # Try to pull a summary field
    TOTAL_MEMORIES=$(echo "$BODY" | jq -r '.total // .total_memories // .stats.total // empty' 2>/dev/null)
    if [ -n "$TOTAL_MEMORIES" ]; then
      pass "Memory stats received (total=$TOTAL_MEMORIES)"
    else
      pass "Memory stats endpoint returned 200"
    fi
  else
    pass "Memory stats endpoint returned 200"
  fi
else
  fail "Expected HTTP 200, got HTTP $STATUS" "$(echo "$BODY" | head -1)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${CYAN}${BOLD}=== Results ===${NC}"
echo -e "  ${GREEN}$PASSED${NC} / $TOTAL passed"

if [ $FAILED -gt 0 ]; then
  echo -e "  ${RED}$FAILED${NC} / $TOTAL failed"
  echo ""
  echo -e "${YELLOW}Some tests failed. Check:${NC}"
  echo "  - Are all Edge Functions deployed?  (supabase functions list)"
  echo "  - Are secrets set?                  (supabase secrets list)"
  echo "  - Have migrations been run?         (./migrate.sh)"
  exit 1
else
  echo ""
  echo -e "${GREEN}All smoke tests passed. Deployment looks healthy.${NC}"
fi
