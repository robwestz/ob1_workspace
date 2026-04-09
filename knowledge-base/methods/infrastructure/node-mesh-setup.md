---
title: "Three-Node Agent Mesh Setup"
format: method-guide
layer: methods
category: "infrastructure"
status: verified
confidence: high
last_verified: 2026-04-05
tags: [openclaw, nodes, mesh, tailscale, distributed, setup]
prerequisites:
  - OpenClaw installed on all three machines
  - Tailscale installed and logged in on all three machines (same tailnet)
  - SSH access to the DigitalOcean droplet
  - Gateway token from the primary gateway host
outputs:
  - Three-node execution mesh with verified connectivity
  - Per-node exec approval policies
  - Per-agent node bindings
  - Seed configuration files for reproducibility
quality_gate: "All three nodes paired, connected, and passing verification commands"
---

# Three-Node Agent Mesh Setup

> Connect a DigitalOcean droplet, MacBook Air M2, and Windows PC into a unified OpenClaw agent execution mesh where any agent can run commands on any machine.

## Purpose

This method sets up a production-grade distributed node mesh that gives OpenClaw agents access to three physically separate machines as a single execution surface. Without this, agents are limited to running commands on whichever machine hosts the gateway -- meaning you lose access to macOS-specific tooling, server-side compute, and cross-platform capabilities.

## When to Use

- You have multiple machines that agents need to access (development, build, deployment)
- You want agents to run macOS-specific commands (Xcode, brew, macOS APIs) from a Windows-hosted gateway
- You want a dedicated always-on server for agent execution (overnight work, CI)
- You want to separate the gateway (messaging/state) from execution (commands/builds)

## When NOT to Use

- Single-machine setups where the gateway and execution target are the same host
- Situations where SSH-only access is sufficient (one-off remote commands)
- When network latency between machines exceeds acceptable thresholds for interactive use (>200ms)

## Prerequisites

### All Machines

- [ ] OpenClaw CLI installed (latest version)
- [ ] Tailscale installed, authenticated, and connected to the same tailnet
- [ ] Tailscale MagicDNS enabled on the tailnet
- [ ] `ANTHROPIC_API_KEY` set (or equivalent model provider auth)

### Node 1: DigitalOcean Droplet (Primary Gateway)

- [ ] Ubuntu 22.04+ or Debian 12+
- [ ] Node.js 20+ or Bun installed
- [ ] OpenClaw gateway configured and running
- [ ] `~/.openclaw/openclaw.json` with valid gateway config
- [ ] Tailscale IP reachable from other machines (verify with `tailscale status`)
- [ ] Firewall allows Tailscale traffic (UDP 41641)

### Node 2: MacBook Air M2 (Agent Execution Host)

- [ ] macOS 14+ (Sonoma or later)
- [ ] OpenClaw CLI installed via `brew` or direct download
- [ ] Xcode Command Line Tools installed (for macOS-specific build tools)
- [ ] Tailscale for macOS installed and connected

### Node 3: Windows PC (Development Node)

- [ ] Windows 11
- [ ] OpenClaw CLI installed
- [ ] Git, Node.js, and development tools available on PATH
- [ ] Tailscale for Windows installed and connected

## Process

### Step 1: Verify Tailscale Mesh Connectivity

**Action:** Confirm all three machines can reach each other via Tailscale.

**On each machine, run:**

```bash
tailscale status
```

**Verify** you see all three machines listed with their Tailscale IPs and MagicDNS names.

**Test connectivity from each machine to the others:**

```bash
# From each machine, ping the other two
tailscale ping <droplet-magicdns>
tailscale ping <macbook-magicdns>
tailscale ping <windows-magicdns>
```

**Decision point:** If any machine is not visible or pings fail, fix Tailscale connectivity before proceeding. Common issues: firewall blocking UDP 41641, Tailscale not logged in, different tailnets.

**Outputs:** Three Tailscale IPs/MagicDNS names confirmed reachable.

---

### Step 2: Configure the Gateway (DigitalOcean Droplet)

**Action:** Set up the OpenClaw gateway to accept node connections via Tailscale.

**On the droplet**, edit `~/.openclaw/openclaw.json`:

```json5
{
  gateway: {
    port: 18789,
    mode: "local",
    // Bind to Tailscale IP so nodes on the tailnet can connect directly
    bind: "tailnet",
    auth: {
      mode: "token",
      token: "<GATEWAY_TOKEN_48HEX>"
    },
    tailscale: {
      mode: "serve",
      resetOnExit: false
    }
  }
}
```

**Alternative (loopback + Tailscale Serve):** If you prefer keeping the gateway on loopback with Tailscale Serve handling HTTPS:

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "serve" }
  }
}
```

This is more secure (gateway never listens on a network interface directly) but requires Tailscale HTTPS to be enabled on your tailnet.

**Start the gateway (or restart if already running):**

```bash
openclaw gateway
```

**Verify:**

```bash
openclaw health
openclaw status --deep
```

**Record the gateway token** -- you will need it for node connections:

```bash
openclaw config get gateway.auth.token
```

**Outputs:** Gateway running and accessible via Tailscale.

---

### Step 3: Set Up Node 2 (MacBook Air M2)

**Action:** Install and start a headless node host on the Mac, connecting to the droplet gateway.

**3a. Export the gateway token:**

```bash
export OPENCLAW_GATEWAY_TOKEN="<gateway-token-from-step-2>"
```

**3b. Start the node host (foreground first, for testing):**

```bash
openclaw node run \
  --host <droplet-tailscale-ip-or-magicdns> \
  --port 18789 \
  --display-name "Mac Agent"
```

If using Tailscale Serve (wss):

```bash
openclaw node run \
  --host <droplet-magicdns> \
  --port 443 \
  --tls \
  --display-name "Mac Agent"
```

**3c. Approve the node on the gateway (droplet):**

```bash
# On the droplet (or any machine with CLI access to the gateway)
openclaw nodes pending
# You should see "Mac Agent" in the pending list
openclaw nodes approve <requestId>
```

**3d. Verify the node is connected:**

```bash
openclaw nodes status
openclaw nodes describe --node "Mac Agent"
```

You should see the node listed as connected with capabilities including `system.run` and `system.which`.

**3e. Test execution:**

```bash
openclaw nodes run --node "Mac Agent" -- uname -a
openclaw nodes run --node "Mac Agent" -- sw_vers
```

**3f. Install as a background service (production):**

```bash
openclaw node install \
  --host <droplet-tailscale-ip-or-magicdns> \
  --port 18789 \
  --display-name "Mac Agent"
```

Manage the service:

```bash
openclaw node status
openclaw node restart
openclaw node stop
```

**3g. Configure exec approvals on the Mac:**

Edit `~/.openclaw/exec-approvals.json` on the Mac, or add entries remotely:

```bash
# From the gateway
openclaw approvals allowlist add --node "Mac Agent" "/usr/bin/uname"
openclaw approvals allowlist add --node "Mac Agent" "/usr/bin/sw_vers"
openclaw approvals allowlist add --node "Mac Agent" "/usr/bin/git"
openclaw approvals allowlist add --node "Mac Agent" "/usr/local/bin/brew"
openclaw approvals allowlist add --node "Mac Agent" "/bin/sh"
```

**Outputs:** Mac node paired, connected, and executing commands.

---

### Step 4: Set Up Node 3 (Windows PC)

**Action:** Install and start a headless node host on the Windows PC.

**4a. Open a terminal (Git Bash, PowerShell, or WSL) and export the gateway token:**

```bash
export OPENCLAW_GATEWAY_TOKEN="<gateway-token-from-step-2>"
```

Or in PowerShell:

```powershell
$env:OPENCLAW_GATEWAY_TOKEN = "<gateway-token-from-step-2>"
```

**4b. Start the node host (foreground first):**

```bash
openclaw node run \
  --host <droplet-tailscale-ip-or-magicdns> \
  --port 18789 \
  --display-name "Windows Dev"
```

**4c. Approve on the gateway:**

```bash
openclaw nodes pending
openclaw nodes approve <requestId>
```

**4d. Verify:**

```bash
openclaw nodes status
openclaw nodes describe --node "Windows Dev"
openclaw nodes run --node "Windows Dev" -- hostname
```

**4e. Install as background service:**

```bash
openclaw node install \
  --host <droplet-tailscale-ip-or-magicdns> \
  --port 18789 \
  --display-name "Windows Dev"
```

**4f. Configure exec approvals for Windows:**

```bash
openclaw approvals allowlist add --node "Windows Dev" "git"
openclaw approvals allowlist add --node "Windows Dev" "node"
openclaw approvals allowlist add --node "Windows Dev" "npm"
openclaw approvals allowlist add --node "Windows Dev" "cmd.exe"
```

**Outputs:** Windows node paired, connected, and executing commands.

---

### Step 5: Configure Node Routing in Gateway Config

**Action:** Update the gateway's `openclaw.json` to route exec to nodes and bind agents to specific nodes.

**On the droplet**, update `~/.openclaw/openclaw.json`:

```json5
{
  tools: {
    exec: {
      host: "node",
      security: "allowlist",
      ask: "on-miss",
      node: "Mac Agent",          // Default node for exec
      notifyOnExit: true,
      applyPatch: { enabled: true }
    },
    agentToAgent: { enabled: true }
  },
  agents: {
    list: [
      {
        id: "main",
        tools: {
          exec: { host: "node", node: "Mac Agent" }
        }
      },
      {
        id: "ops",
        tools: {
          exec: { host: "node", node: "Mac Agent" }
        }
      },
      {
        id: "dev",
        tools: {
          exec: { host: "node", node: "Windows Dev" }
        }
      }
    ]
  }
}
```

Or via CLI:

```bash
openclaw config set tools.exec.host node
openclaw config set tools.exec.security allowlist
openclaw config set tools.exec.node "Mac Agent"
```

**Outputs:** Gateway configured to route execution to appropriate nodes per agent.

---

### Step 6: Verify the Complete Mesh

**Action:** Run a comprehensive verification sequence to confirm all nodes are operational.

**6a. Node status overview:**

```bash
openclaw nodes status
```

Expected output: Three nodes listed (including the droplet itself if running a local node, or two remote nodes).

**6b. Describe each node:**

```bash
openclaw nodes describe --node "Mac Agent"
openclaw nodes describe --node "Windows Dev"
```

Verify capabilities include `system.run` and `system.which` for each.

**6c. Cross-node execution test:**

```bash
# Run on Mac
openclaw nodes run --node "Mac Agent" -- echo "Hello from Mac" && uname -s

# Run on Windows
openclaw nodes run --node "Windows Dev" --raw "echo Hello from Windows && hostname"
```

**6d. Verify exec approvals:**

```bash
openclaw approvals get --node "Mac Agent"
openclaw approvals get --node "Windows Dev"
```

**6e. Full diagnostic:**

```bash
openclaw doctor
openclaw status --deep
openclaw security audit
```

**Outputs:** Verified three-node mesh with passing health checks.

---

### Step 7: Add Node-Aware Heartbeat and Boot

**Action:** Update workspace files to make the agent aware of the node mesh.

**Update `HEARTBEAT.md`** on the gateway workspace:

```markdown
# Heartbeat Checklist
- Check gateway health (openclaw health)
- Monitor node connectivity (openclaw nodes status)
- Check for pending node pairing requests (openclaw nodes pending)
- Scan memory for unfinished tasks from today's notes
- If daytime (08:00-22:00 CET): brief check-in if quiet for 4+ hours
- Check cron job run history for failures
```

**Update `BOOT.md`** on the gateway workspace:

```markdown
# Boot Routine
1. Run `openclaw health` and report status
2. Run `openclaw nodes status` and verify all nodes are connected
3. If any node is disconnected, note it in memory and alert via WhatsApp
4. Run `openclaw nodes run --node "Mac Agent" -- uptime` to verify Mac responsiveness
5. Generate morning briefing if before 09:00 CET
```

**Outputs:** Agent-aware monitoring of the node mesh.

## Quality Checks

- [ ] All three machines visible in `tailscale status`
- [ ] Gateway `openclaw health` returns healthy
- [ ] `openclaw nodes status` shows all nodes as connected
- [ ] `openclaw nodes describe` for each node shows expected capabilities
- [ ] Shell commands execute successfully on each node via `openclaw nodes run`
- [ ] Exec approvals are configured and enforced on each node
- [ ] `openclaw security audit` passes without critical findings
- [ ] Per-agent node bindings route correctly (test with each agent ID)
- [ ] Node reconnects automatically after brief network interruption
- [ ] `openclaw doctor` reports no issues

## Common Failures

| Failure | Symptom | Prevention |
|---------|---------|-----------|
| Gateway binds to loopback, nodes cannot connect | `connection refused` on node start | Set `gateway.bind: "tailnet"` or use Tailscale Serve |
| Missing gateway token on node | `auth failed` during node connect | Export `OPENCLAW_GATEWAY_TOKEN` before `openclaw node run` |
| Pairing request expired | Node connects but is not paired | Approve within 5 minutes, or have node reconnect |
| Exec approval denied | `SYSTEM_RUN_DENIED: allowlist miss` | Add commands to node's exec-approvals allowlist |
| Tailscale not connected | Node cannot reach gateway IP | Check `tailscale status`, ensure same tailnet |
| Node host ignores PATH overrides | Commands not found on node | Install tools in standard locations on the node machine |
| TLS mismatch | Connection fails with TLS error | Use `--tls-fingerprint` to pin the correct certificate |
| macOS node host routing confusion | Commands run on wrong exec target | Set `OPENCLAW_NODE_EXEC_HOST` explicitly |
| Windows node with wrong shell | Unix commands fail | Use `--raw` flag for shell strings on Windows nodes |
| Multiple gateways competing | Node pairs with wrong gateway | Ensure only one gateway runs per intended mesh |

## Troubleshooting Runbook

### Node shows "connected" but commands fail

```bash
openclaw nodes status
openclaw nodes describe --node <name>
openclaw approvals get --node <name>
openclaw logs --follow
```

Check: Is the capability (`system.run`) listed in describe output? Are exec approvals configured?

### Node disconnects frequently

```bash
# Check Tailscale connectivity
tailscale ping <gateway-magicdns>

# Check node host logs
openclaw node status
journalctl --user -u openclaw-node  # Linux
```

Common cause: Tailscale re-key, network interface change, or node host service crash.

### "NODE_BACKGROUND_UNAVAILABLE" on mobile nodes

Bring the iOS/Android app to the foreground. `canvas.*`, `camera.*`, and `screen.*` commands only work when the app is in the foreground.

### Fresh install, node won't connect

1. Verify gateway is running: `openclaw health`
2. Verify network: `tailscale ping <gateway>`
3. Verify token: `echo $OPENCLAW_GATEWAY_TOKEN` (should match `gateway.auth.token`)
4. Check gateway bind mode: `openclaw config get gateway.bind`
5. If loopback, either change to `tailnet` or set up Tailscale Serve

## Example: Complete Setup Session

This walkthrough assumes Tailscale is already configured on all machines.

```bash
# === ON THE DROPLET (gateway host) ===

# 1. Configure gateway for tailnet access
openclaw config set gateway.bind tailnet
openclaw config set gateway.auth.mode token

# 2. Note the gateway token
openclaw config get gateway.auth.token
# Output: abc123def456...

# 3. Start gateway
openclaw gateway &

# 4. Verify
openclaw health
# Output: Gateway healthy


# === ON THE MACBOOK (node) ===

# 5. Connect as node
export OPENCLAW_GATEWAY_TOKEN="abc123def456..."
openclaw node run --host droplet-name.tailnet-name.ts.net --port 18789 --display-name "Mac Agent"
# Output: Connecting to gateway... Pairing requested.


# === BACK ON THE DROPLET ===

# 6. Approve the Mac
openclaw nodes pending
# Output: Mac Agent (pending, requestId: req_abc123)
openclaw nodes approve req_abc123
# Output: Approved. Token issued.

# 7. Verify
openclaw nodes status
# Output: Mac Agent - connected - system.run, system.which

# 8. Test
openclaw nodes run --node "Mac Agent" -- uname -a
# Output: Darwin MacBook-Air.local 23.4.0 ...

# 9. Set as default exec node
openclaw config set tools.exec.host node
openclaw config set tools.exec.node "Mac Agent"


# === ON THE MACBOOK (install as service) ===

# 10. Install permanently
openclaw node install --host droplet-name.tailnet-name.ts.net --port 18789 --display-name "Mac Agent"
openclaw node status
# Output: running (pid 12345)


# === ON WINDOWS (repeat for third node) ===

# 11. Connect Windows
export OPENCLAW_GATEWAY_TOKEN="abc123def456..."
openclaw node run --host droplet-name.tailnet-name.ts.net --port 18789 --display-name "Windows Dev"

# 12. Approve on droplet
openclaw nodes approve <requestId>

# 13. Install as service on Windows
openclaw node install --host droplet-name.tailnet-name.ts.net --port 18789 --display-name "Windows Dev"
```

## Related

- Domain knowledge: [[distributed-nodes]] (knowledge-base/domain/infrastructure/distributed-nodes.md)
- Seed config: [[nodes-config]] (openclaw-seed/nodes-config.json)
- OpenClaw docs: C:\Users\robin\Downloads\openclaw\docs\nodes\index.md
- Gateway protocol: C:\Users\robin\Downloads\openclaw\docs\gateway\protocol.md
- Tailscale setup: C:\Users\robin\Downloads\openclaw\docs\gateway\tailscale.md
