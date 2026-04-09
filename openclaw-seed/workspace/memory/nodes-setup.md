# Node Mesh Configuration

## What We Set Up

Three-node mesh connecting all our machines into a unified agent execution surface via Tailscale:

- **DO Droplet** (Ubuntu, `droplet.tailnet-name.ts.net`) -- Primary gateway host. Runs the OpenClaw gateway service, handles all messaging channels (WhatsApp, Telegram), model invocation, session management, and state. This is the always-on hub that nodes connect to. Does NOT run as a node itself -- it is the central coordinator.

- **Mac Agent** (MacBook Air M2, `macbook.tailnet-name.ts.net`) -- Primary agent execution host. Runs as a headless node service (`openclaw node install`). All `main` and `ops` agents route exec calls here by default. Has macOS-specific tooling (brew, Xcode CLT, sw_vers), plus git, node, bun, python3, docker, cargo. Exec approvals set to allowlist mode with on-miss prompting. The Mac is always on and connected via Tailscale.

- **Windows Dev** (Windows 11 PC, `windows-pc.tailnet-name.ts.net`) -- Secondary dev node. Runs as a headless node service. The `dev` and `coding` agents route here. Has the full Windows development environment (VS Code, git, node, npm, python, docker). This node is optional -- it disconnects when the PC is off, and agents fall back gracefully.

## What We Learned

### Tailscale is non-negotiable for multi-network mesh
We tried SSH tunnels first and they were a maintenance nightmare -- tunnels dropping, reconnection scripts failing at 3am during night shifts. Tailscale Serve on the droplet with `gateway.bind: "tailnet"` was the clean solution. Zero port forwarding, zero tunnel management, WireGuard encryption out of the box. The gateway stays on loopback from the internet's perspective but is reachable on the tailnet.

### Node hosts ignore PATH overrides
Spent an embarrassing amount of time debugging why `node` and `bun` were "not found" on the Mac node. Turns out `tools.exec.pathPrepend` is NOT applied to node hosts. The fix: install tools in standard locations (`/usr/local/bin/`) or configure the node host's launchd service environment. Added full absolute paths to the exec-approvals allowlist to be safe.

### Exec approvals are LOCAL to each node
This tripped us up initially. We configured allowlists on the gateway thinking they would propagate to nodes. They don't. Each node enforces its own `~/.openclaw/exec-approvals.json`. The gateway can add entries remotely via `openclaw approvals allowlist add --node <name> <command>`, but enforcement is always local. This is actually a good security property -- a compromised gateway can't bypass node-side gates.

### Per-agent node binding is the killer feature
Setting `agents.list[0].tools.exec.node = "Mac Agent"` and `agents.list[2].tools.exec.node = "Windows Dev"` means the SysAdmin agent naturally runs macOS commands on the Mac, and the Dev agent runs Windows commands on the PC. No context switching, no "run this on the other machine" instructions. The agent just executes and the gateway routes to the right node.

### Pairing requests expire in 5 minutes
Learned this the hard way during initial setup. Started the Mac node, went to get coffee, came back -- pairing had expired. The node reconnects automatically but generates a new pairing request, so just approve it promptly.

### Windows node needs `--raw` for shell commands
Unix-style commands don't work on the Windows node. Use `openclaw nodes run --node "Windows Dev" --raw "dir /b"` instead of trying to pass Unix args. The node host uses `cmd.exe /c` on Windows.

### Browser proxy is automatic
Both the Mac and Windows node hosts automatically advertise a browser proxy. We didn't need to configure anything extra -- the agent can drive browsers on either machine through the node. Useful for testing web apps on both platforms.

## Current Status

**Active nodes (as of 2026-04-05):**

| Node | Status | Uptime | Last Verified |
|------|--------|--------|---------------|
| DO Droplet (gateway) | Running | Always-on | 2026-04-05 |
| Mac Agent | Connected | Service running | 2026-04-05 |
| Windows Dev | Connected (when PC is on) | Intermittent | 2026-04-05 |

**Routing configuration:**
- Default exec host: `node`
- Default node: `Mac Agent`
- `main` agent -> Mac Agent
- `ops` agent -> Mac Agent
- `dev` agent -> Windows Dev

**Exec approval mode:** `allowlist` with `ask: "on-miss"` on all nodes.

**Network:** All three machines on the same Tailscale tailnet. MagicDNS enabled. Gateway uses Tailscale Serve for HTTPS access to the Control UI.

**Monitoring:** HEARTBEAT.md includes `openclaw nodes status` check every 30 minutes. BOOT.md verifies all nodes on gateway startup. Disconnect alerts go to WhatsApp.

## Configuration Files

- Gateway config: `~/.openclaw/openclaw.json` (on droplet)
- Mac node config: `~/.openclaw/node.json` (on MacBook)
- Windows node config: `~/.openclaw/node.json` (on Windows PC)
- Mac exec approvals: `~/.openclaw/exec-approvals.json` (on MacBook)
- Windows exec approvals: `~/.openclaw/exec-approvals.json` (on Windows PC)
- Seed reference: `D:\OB1\openclaw-seed\nodes-config.json`

## Key Commands

```bash
# Check mesh status
openclaw nodes status
openclaw nodes status --connected

# Describe a node
openclaw nodes describe --node "Mac Agent"
openclaw nodes describe --node "Windows Dev"

# Run commands on specific nodes
openclaw nodes run --node "Mac Agent" -- uname -a
openclaw nodes run --node "Windows Dev" --raw "hostname"

# Manage exec approvals
openclaw approvals get --node "Mac Agent"
openclaw approvals allowlist add --node "Mac Agent" "/usr/local/bin/newcommand"

# Pairing workflow (for new nodes)
openclaw nodes pending
openclaw nodes approve <requestId>
openclaw nodes rename --node <id> --name "Friendly Name"

# Diagnostics
openclaw doctor
openclaw security audit
openclaw logs --follow
```
