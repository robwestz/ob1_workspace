#!/bin/bash
set -euo pipefail

SEED_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/.openclaw"
TIMESTAMP_ISO="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
TIMESTAMP_MS="$(date +%s)000"

echo ""
echo "======================================================"
echo "  OB1 OpenClaw Seed Installer"
echo "  Pre-configured for autonomous IT ops"
echo "======================================================"
echo ""

# -------------------------------------------------------
# 1. Back up existing ~/.openclaw if present
# -------------------------------------------------------
if [ -d "$TARGET_DIR" ]; then
  BACKUP_DIR="${TARGET_DIR}.backup.$(date +%Y%m%d%H%M%S)"
  echo "[1/7] Backing up existing $TARGET_DIR -> $BACKUP_DIR"
  cp -r "$TARGET_DIR" "$BACKUP_DIR"
  echo "       Backup complete."
else
  echo "[1/7] No existing $TARGET_DIR found. Fresh install."
fi

# -------------------------------------------------------
# 2. Copy seed files to ~/.openclaw/
# -------------------------------------------------------
echo "[2/7] Copying seed files to $TARGET_DIR ..."

mkdir -p "$TARGET_DIR/agents/main/agent"
mkdir -p "$TARGET_DIR/agents/main/sessions"
mkdir -p "$TARGET_DIR/gateway"
mkdir -p "$TARGET_DIR/sync/data"
mkdir -p "$TARGET_DIR/sync/staging"
mkdir -p "$TARGET_DIR/devices"
mkdir -p "$TARGET_DIR/cron"
mkdir -p "$TARGET_DIR/subagents"
mkdir -p "$TARGET_DIR/identity"
mkdir -p "$TARGET_DIR/workspace/.openclaw"
mkdir -p "$TARGET_DIR/workspace/memory"
mkdir -p "$TARGET_DIR/continuum/checkpoints"
mkdir -p "$TARGET_DIR/skills"
mkdir -p "$TARGET_DIR/media/inbound"
mkdir -p "$TARGET_DIR/completions"

cp "$SEED_DIR/openclaw.json"                          "$TARGET_DIR/openclaw.json"
cp "$SEED_DIR/exec-approvals.json"                    "$TARGET_DIR/exec-approvals.json"
cp "$SEED_DIR/agents/main/agent/auth-profiles.json"   "$TARGET_DIR/agents/main/agent/auth-profiles.json"
cp "$SEED_DIR/gateway/schedules.json"                 "$TARGET_DIR/gateway/schedules.json"
cp "$SEED_DIR/sync/sync-config.json"                  "$TARGET_DIR/sync/sync-config.json"
cp "$SEED_DIR/sync/manifest.json"                     "$TARGET_DIR/sync/manifest.json"
cp "$SEED_DIR/devices/paired.json"                    "$TARGET_DIR/devices/paired.json"
cp "$SEED_DIR/cron/jobs.json"                         "$TARGET_DIR/cron/jobs.json"
cp "$SEED_DIR/subagents/runs.json"                    "$TARGET_DIR/subagents/runs.json"
cp "$SEED_DIR/workspace-state.json"                   "$TARGET_DIR/workspace/.openclaw/workspace-state.json"

# Create empty sessions store
cat > "$TARGET_DIR/agents/main/sessions/sessions.json" << 'SESSIONS'
{}
SESSIONS

# Create empty devices pending
cat > "$TARGET_DIR/devices/pending.json" << 'PENDING'
[]
PENDING

echo "       Files copied."

# -------------------------------------------------------
# 3. Generate crypto materials (device.json) if CLI available
# -------------------------------------------------------
echo "[3/7] Checking for openclaw CLI ..."

if command -v openclaw &>/dev/null; then
  echo "       openclaw CLI found. Generating device identity ..."
  openclaw identity generate 2>/dev/null || {
    echo "       WARNING: identity generation failed. You may need to run 'openclaw onboard' manually."
  }
else
  echo "       openclaw CLI not found. Generating placeholder device identity ..."
  # Generate a placeholder -- real crypto should come from the CLI
  DEVICE_ID="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(32))' 2>/dev/null || echo 'PLACEHOLDER_DEVICE_ID_RUN_OPENCLAW_ONBOARD')"
  cat > "$TARGET_DIR/identity/device.json" << DEVICE
{
  "version": 1,
  "deviceId": "$DEVICE_ID",
  "publicKeyPem": "<GENERATE_WITH_OPENCLAW_ONBOARD>",
  "privateKeyPem": "<GENERATE_WITH_OPENCLAW_ONBOARD>",
  "createdAtMs": ${TIMESTAMP_MS}
}
DEVICE
  echo "       Placeholder device identity written. Run 'openclaw onboard' to generate real keys."
fi

# -------------------------------------------------------
# 4. Replace timestamp placeholders with actual values
# -------------------------------------------------------
echo "[4/7] Replacing timestamp placeholders ..."

# List of files that contain placeholders
PLACEHOLDER_FILES=(
  "$TARGET_DIR/openclaw.json"
  "$TARGET_DIR/agents/main/agent/auth-profiles.json"
  "$TARGET_DIR/sync/manifest.json"
  "$TARGET_DIR/workspace/.openclaw/workspace-state.json"
)

for f in "${PLACEHOLDER_FILES[@]}"; do
  if [ -f "$f" ]; then
    sed -i "s|__TIMESTAMP_ISO__|${TIMESTAMP_ISO}|g" "$f"
    sed -i "s|__TIMESTAMP_MS__|${TIMESTAMP_MS}|g" "$f"
  fi
done

echo "       Timestamps set to $TIMESTAMP_ISO"

# -------------------------------------------------------
# 5. Generate exec-approvals socket token
# -------------------------------------------------------
echo "[5/7] Generating exec-approvals token ..."

EXEC_TOKEN="$(openssl rand -base64 24 2>/dev/null | tr -d '/+=' | head -c 32 || python3 -c 'import secrets; print(secrets.token_urlsafe(24)[:32])' 2>/dev/null || echo 'REPLACE_ME_WITH_RANDOM_TOKEN')"

# Determine socket path based on OS
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  SOCKET_PATH="$(cygpath -w "$TARGET_DIR/exec-approvals.sock" 2>/dev/null || echo "$TARGET_DIR/exec-approvals.sock")"
else
  SOCKET_PATH="$TARGET_DIR/exec-approvals.sock"
fi

# Use a temp file for the replacement to handle the socket path safely
python3 -c "
import json, sys
with open('$TARGET_DIR/exec-approvals.json', 'r') as f:
    data = json.load(f)
data['socket']['token'] = '$EXEC_TOKEN'
data['socket']['path'] = '$SOCKET_PATH'
with open('$TARGET_DIR/exec-approvals.json', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || {
  sed -i "s|<GENERATED_AT_INSTALL>|${EXEC_TOKEN}|g" "$TARGET_DIR/exec-approvals.json"
}

echo "       Token generated."

# -------------------------------------------------------
# 6. Prompt for API keys
# -------------------------------------------------------
echo "[6/7] API key configuration ..."
echo ""

# Gateway token
GATEWAY_TOKEN="$(openssl rand -hex 24 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(24))' 2>/dev/null || echo 'REPLACE_WITH_48_HEX_CHARS')"
sed -i "s|<GATEWAY_TOKEN_48HEX>|${GATEWAY_TOKEN}|g" "$TARGET_DIR/openclaw.json"

# Anthropic API key
read -rp "  Anthropic API key (or press Enter to skip): " ANTHROPIC_KEY
if [ -n "$ANTHROPIC_KEY" ]; then
  sed -i "s|<ANTHROPIC_API_KEY>|${ANTHROPIC_KEY}|g" "$TARGET_DIR/agents/main/agent/auth-profiles.json"
  # Write agent auth.json
  cat > "$TARGET_DIR/agents/main/agent/auth.json" << AUTH
{
  "anthropic": {
    "type": "api_key",
    "key": "${ANTHROPIC_KEY}"
  }
}
AUTH
  echo "  -> Anthropic key saved."
else
  echo "  -> Skipped. Set ANTHROPIC_API_KEY env var or run 'openclaw auth add anthropic' later."
fi

# OpenAI API key (for skills)
read -rp "  OpenAI API key for skills (or press Enter to skip): " OPENAI_KEY
if [ -n "$OPENAI_KEY" ]; then
  sed -i "s|<OPENAI_API_KEY>|${OPENAI_KEY}|g" "$TARGET_DIR/openclaw.json"
  echo "  -> OpenAI key saved to skill config."
else
  echo "  -> Skipped. Image gen and whisper skills will need keys configured later."
fi

# Google API key
read -rp "  Google API key (or press Enter to skip): " GOOGLE_KEY
if [ -n "$GOOGLE_KEY" ]; then
  sed -i "s|<GOOGLE_API_KEY>|${GOOGLE_KEY}|g" "$TARGET_DIR/agents/main/agent/auth-profiles.json"
  echo "  -> Google key saved."
else
  echo "  -> Skipped. Add later via 'openclaw auth add google'."
fi

# WhatsApp phone number
read -rp "  WhatsApp phone number with country code (e.g. +1234567890, or Enter to skip): " PHONE
if [ -n "$PHONE" ]; then
  sed -i "s|<YOUR_PHONE_NUMBER>|${PHONE}|g" "$TARGET_DIR/openclaw.json"
  echo "  -> Phone number configured."
else
  echo "  -> Skipped. Update channels.whatsapp.allowFrom in openclaw.json later."
fi

echo ""

# -------------------------------------------------------
# 7. Run openclaw doctor to verify
# -------------------------------------------------------
echo "[7/7] Verifying installation ..."

if command -v openclaw &>/dev/null; then
  echo "       Running 'openclaw doctor' ..."
  openclaw doctor || echo "       WARNING: doctor reported issues. Check output above."
else
  echo "       openclaw CLI not on PATH. Skipping verification."
  echo "       Install openclaw and run 'openclaw doctor' to verify."
fi

echo ""
echo "======================================================"
echo "  Installation complete!"
echo "======================================================"
echo ""
echo "  Config location:  $TARGET_DIR"
echo "  Workspace:        $TARGET_DIR/workspace"
echo ""
echo "  Next steps:"
echo "    1. Install openclaw if not already: npm i -g openclaw"
echo "    2. Run 'openclaw onboard' to complete device setup"
echo "    3. Run 'openclaw doctor' to verify everything"
echo "    4. Run 'openclaw gateway' to start the gateway"
echo "    5. Open webchat at http://localhost:18789"
echo ""
echo "  Scheduled tasks configured:"
echo "    - morning-report  : daily at 06:30"
echo "    - health-check    : every 4 hours"
echo "    - doc-gardening   : Mondays at 10:00"
echo ""
echo "  Model: anthropic/claude-opus-4-6"
echo "  Heartbeat: every 30 minutes"
echo "  Max concurrent agents: 4 (subagents: 8)"
echo ""
