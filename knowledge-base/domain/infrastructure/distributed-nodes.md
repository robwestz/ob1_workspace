---
title: "OpenClaw Distributed Nodes"
format: reference-article
layer: domain
category: "infrastructure"
status: verified
confidence: high
last_verified: 2026-04-05
tags: [openclaw, nodes, distributed, mesh, remote-execution, tailscale]
cross_refs:
  - knowledge-base/methods/infrastructure/node-mesh-setup.md
  - openclaw-seed/nodes-config.json
  - openclaw-seed/openclaw.json
sources:
  - url: "file://C:/Users/robin/Downloads/openclaw/docs/nodes/index.md"
    title: "OpenClaw Nodes Documentation"
    date: 2026-04-05
    reliability: high
  - url: "file://C:/Users/robin/Downloads/openclaw/docs/gateway/protocol.md"
    title: "Gateway WebSocket Protocol"
    date: 2026-04-05
    reliability: high
  - url: "file://C:/Users/robin/Downloads/openclaw/docs/gateway/tailscale.md"
    title: "Tailscale Integration"
    date: 2026-04-05
    reliability: high
  - url: "file://C:/Users/robin/Downloads/openclaw/docs/gateway/discovery.md"
    title: "Discovery and Transports"
    date: 2026-04-05
    reliability: high
  - url: "file://C:/Users/robin/Downloads/openclaw/docs/gateway/security/index.md"
    title: "Security Overview"
    date: 2026-04-05
    reliability: high
---

# OpenClaw Distributed Nodes

> Nodes are companion devices that connect to the OpenClaw Gateway over WebSocket and expose a command surface -- turning any collection of machines into a unified agent execution mesh.

## Core Concept

A **node** is any device -- macOS, iOS, Android, Linux, Windows -- that connects to the OpenClaw Gateway's WebSocket server with `role: "node"` and exposes capabilities the agent can invoke remotely. The Gateway remains the single source of truth for sessions, channels, and state; nodes are **peripherals** that extend the agent's reach to other machines.

This architecture separates concerns cleanly: the Gateway handles messaging (WhatsApp, Telegram, Discord), model invocation, and session management. Nodes handle **execution** -- running shell commands, capturing photos, recording screens, fetching GPS coordinates, or rendering canvas UIs on remote displays. The agent talks to the Gateway; the Gateway forwards capability calls to the appropriate node.

The result is a distributed execution mesh where a single agent conversation can run `git status` on a Mac, take a screenshot of a browser on Windows, snap a photo from an iPhone camera, get GPS location from an Android, and send an SMS -- all without the user switching contexts.

## Key Principles

1. **Nodes are peripherals, not gateways.** A node never runs the gateway service. It connects to an existing gateway and offers its capabilities. Telegram/WhatsApp/etc. messages land on the gateway, not on nodes. Only one gateway should run per host (unless intentionally using isolated profiles).

2. **Device-based identity and pairing.** Every node presents an Ed25519 keypair-derived device identity during the WebSocket `connect` handshake. New devices must be explicitly approved (paired) before they can execute commands. Local connections (loopback or same-host tailnet address) can be auto-approved; remote connections require explicit approval and must sign a challenge nonce.

3. **Capability declaration at connect time.** Nodes declare their capabilities (`caps`), specific commands (`commands`), and permission states (`permissions`) during the handshake. The Gateway treats these as claims and enforces server-side allowlists. A headless Linux node will declare `system.run` and `system.which`; a macOS companion app adds `canvas.*`, `camera.*`, `screen.record`, and `system.notify`; an iOS node adds `camera.*`, `canvas.*`, `location.get`.

4. **Exec approvals are per-node.** Each node enforces its own exec approval policy via `~/.openclaw/exec-approvals.json` on the node machine. The gateway can manage allowlists remotely via `openclaw approvals allowlist add --node <id>`, but enforcement happens locally on the node. This means a compromised gateway cannot bypass node-side approval gates.

5. **Per-agent node binding.** Each agent can target a different default node. The global default is set via `tools.exec.node`, and per-agent overrides via `agents.list[N].tools.exec.node`. This enables multi-agent architectures where a SysAdmin agent uses a Mac node for macOS-specific tools while an Ops agent uses a Linux droplet for server tasks.

## Capabilities by Node Type

### Headless Node Host (any OS: Linux, Windows, macOS)

The lightest node form. Runs via `openclaw node run` or `openclaw node install` as a background service.

| Capability | Command | Notes |
|-----------|---------|-------|
| Shell execution | `system.run` | Gated by local exec-approvals.json |
| Binary lookup | `system.which` | Check if a command exists on PATH |
| Exec approval management | `system.execApprovals.get/set` | Remote allowlist management |
| Browser proxy | automatic | Advertised if `browser.enabled` not disabled on node |

**Cannot do:** Canvas rendering, camera, screen recording, location, notifications, SMS.

### macOS Companion App (node mode)

The macOS menubar app connects to the Gateway WS server as a node. It exposes everything the headless node does, plus:

| Capability | Command | Notes |
|-----------|---------|-------|
| Canvas WebView | `canvas.present`, `canvas.navigate`, `canvas.eval`, `canvas.snapshot`, `canvas.hide`, `canvas.a2ui` | Agent-controlled browser surface |
| Camera | `camera.list`, `camera.snap`, `camera.clip` | Photo + short video (up to 60s) |
| Screen recording | `screen.record` | Requires Screen Recording TCC permission |
| System notifications | `system.notify` | Supports priority levels |
| Shell execution | `system.run` | Gated by macOS app exec approvals (Settings) |

### iOS Node (companion app)

| Capability | Command | Notes |
|-----------|---------|-------|
| Canvas WebView | `canvas.*` | Foreground only |
| Camera | `camera.snap`, `camera.clip` | Front/back, photo/video, foreground only |
| Screen recording | `screen.record` | System prompt required |
| Location | `location.get` | Off by default; requires user permission selection |
| Voice wake | voice wake triggers | Global wake word list synced from Gateway |

### Android Node (companion app)

| Capability | Command | Notes |
|-----------|---------|-------|
| Canvas WebView | `canvas.*` | Foreground only |
| Camera | `camera.snap`, `camera.clip` | Requires CAMERA + RECORD_AUDIO permissions |
| Screen recording | `screen.record` | System capture prompt before recording |
| Location | `location.get` | Off by default; background needs special permission |
| SMS | `sms.send` | Requires SMS permission + telephony hardware |

## Discovery and Authentication

### How Nodes Find the Gateway

Nodes discover the gateway through three mechanisms (in priority order):

1. **Manual configuration** -- Explicit `--host <gateway-host> --port 18789` when starting the node.
2. **Bonjour/mDNS** (LAN only) -- The gateway advertises `_openclaw-gw._tcp` via Bonjour. iOS/Android nodes browse for this service. TXT records include `gatewayPort`, `gatewayTls`, `tailnetDns`, and other hints. These are **unauthenticated** and treated as UX hints only.
3. **Tailscale MagicDNS** -- For cross-network setups, nodes connect to the gateway's Tailscale hostname. The gateway publishes a `tailnetDns` hint when running under Tailscale.

### Authentication Flow

1. Node connects to the Gateway WebSocket endpoint.
2. Gateway sends a `connect.challenge` with a nonce and timestamp.
3. Node responds with a `connect` request containing:
   - `role: "node"` 
   - Device identity (deviceId, publicKey, signature over the challenge nonce)
   - Capability claims (caps, commands, permissions)
   - Auth token (gateway token for first connect, device token for subsequent connects)
4. Gateway validates the challenge signature, checks the gateway auth token, and evaluates the device identity.
5. If this is a **new device**, Gateway creates a pending pairing request. An operator must approve it.
6. On approval, Gateway issues a **device token** scoped to the `node` role. The node stores this in `~/.openclaw/node.json` for future connects.
7. Subsequent connects use the device token; no re-approval needed unless the token is revoked.

### Pairing States

- **Pending**: Node requested pairing; awaiting operator approval. Expires after 5 minutes.
- **Paired**: Approved node with an issued token. Can connect and expose capabilities.
- **Rejected**: Operator explicitly rejected the pairing request.

### Token Management

- `OPENCLAW_GATEWAY_TOKEN` environment variable on the node provides the initial gateway auth token.
- Device tokens are issued on pairing approval and stored in `~/.openclaw/node.json`.
- Tokens can be rotated via `device.token.rotate` or revoked via `device.token.revoke` (requires `operator.pairing` scope).
- Re-pairing always generates a fresh token.

## Network Requirements

### Connectivity Patterns

| Setup | Gateway Bind | Node Connection | Security |
|-------|-------------|-----------------|----------|
| Same machine | `loopback` (default) | `ws://127.0.0.1:18789` | Auto-approved, token auth |
| Same LAN | `lan` or `0.0.0.0` | `ws://<lan-ip>:18789` | Explicit pairing, token auth |
| Tailscale mesh | `loopback` + Tailscale Serve | `wss://<magicdns>/` | Explicit pairing, TLS, identity headers |
| Tailscale direct | `tailnet` | `ws://<tailscale-ip>:18789` | Explicit pairing, token auth |
| SSH tunnel | `loopback` (default) | `ws://127.0.0.1:<local-port>` via SSH `-L` | SSH auth + gateway token |

### Port Requirements

- **Gateway port** (default `18789`): Single port for WebSocket control plane, HTTP API, canvas host, and node connections.
- **No additional ports needed** for nodes -- everything multiplexes over the gateway WS.
- For SSH tunnels: one SSH connection (port 22) per remote node.

### Tailscale Integration (Recommended for Multi-Network)

Tailscale provides the simplest cross-network connectivity:

```json5
// Gateway config (on the gateway host)
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "serve" }
  }
}
```

This keeps the gateway bound to loopback while Tailscale provides HTTPS routing on the tailnet. Nodes connect via `wss://<magicdns>/`. Serve mode also enables identity-header-based auth for the Control UI.

### SSH Tunnel Fallback

When the gateway binds to loopback (default), remote nodes cannot connect directly. Create an SSH tunnel:

```bash
# On the node machine: forward local port 18790 to gateway's 127.0.0.1:18789
ssh -N -L 18790:127.0.0.1:18789 user@gateway-host

# Then start the node host pointing at the local tunnel end
export OPENCLAW_GATEWAY_TOKEN="<gateway-token>"
openclaw node run --host 127.0.0.1 --port 18790 --display-name "Build Node"
```

## Security Model

### What a Remote Node CAN Do

- Execute shell commands that pass the node's local exec-approvals policy.
- Expose camera, screen, canvas, location, SMS capabilities (based on node type and permissions).
- Browser proxy (if enabled on the node).

### What a Remote Node CANNOT Do

- Access gateway state (sessions, memory, config) directly.
- Modify other nodes' exec approvals.
- Bypass its own local exec-approvals.json.
- Run commands without gateway-mediated invocation.
- Access the model API directly -- all model interactions go through the gateway.

### Security Layers (Defense in Depth)

1. **Network layer**: Gateway defaults to loopback bind. Non-loopback requires explicit configuration.
2. **Gateway auth**: All connections require a valid gateway token or device token.
3. **Device pairing**: New devices must be explicitly approved by an operator.
4. **Challenge-response**: Non-local connections must sign a cryptographic challenge.
5. **Exec approvals**: Per-node, per-command allowlists enforced locally on the node machine.
6. **Per-agent binding**: Agents can only invoke capabilities on nodes they are bound to.
7. **Capability claims**: Nodes declare what they can do; the gateway enforces server-side validation.
8. **TLS pinning**: Optional TLS with certificate fingerprint pinning for WS connections (`--tls-fingerprint`).

### Threat Vectors

| Threat | Mitigation |
|--------|-----------|
| Rogue node joins mesh | Device pairing requires explicit operator approval |
| Lateral movement via node | Exec approvals enforced locally; nodes cannot access gateway state |
| Eavesdropping on WS | TLS + pinning; Tailscale provides WireGuard encryption |
| Stolen device token | Revoke via `device.token.revoke`; rotate via `device.token.rotate` |
| Bonjour spoofing | Bonjour is UX hint only; TLS pinning prevents MITM |
| Compromised gateway | Nodes enforce local exec approvals independently |

## Performance Characteristics

### Latency

- **Same machine / loopback**: Sub-millisecond overhead. Effectively instantaneous.
- **Same LAN**: 1-5ms typical. No perceptible delay for shell commands.
- **Tailscale mesh (same region)**: 5-20ms typical. WireGuard overhead is minimal.
- **Tailscale mesh (cross-region)**: 20-100ms depending on geography. Acceptable for command execution; noticeable for interactive canvas operations.
- **SSH tunnel**: Adds SSH encryption overhead (~2-5ms) on top of network latency.

### Bandwidth

- **Shell commands** (`system.run`): Minimal. Request/response payloads are small (typically < 10KB).
- **Camera photos** (`camera.snap`): 100KB-5MB per photo (recompressed to stay under 5MB base64).
- **Video clips** (`camera.clip`): Up to several MB for short clips. Capped at 60s. Transmitted as base64 in the WS payload.
- **Screen recordings** (`screen.record`): Similar to video clips. Capped at 60s.
- **Canvas snapshots** (`canvas.snapshot`): Typically 100KB-2MB depending on resolution and format.

### Reliability

- Node connections auto-reconnect on transient failures.
- If a node goes offline, the gateway marks it as disconnected but preserves pairing state.
- Commands to offline nodes fail immediately with a clear error (not timeout).
- No message queuing for offline nodes -- commands are real-time only.

## Limitations and Edge Cases

### Foreground Requirements

`canvas.*`, `camera.*`, and `screen.*` commands are **foreground-only** on iOS and Android. If the node app is backgrounded, these commands return `NODE_BACKGROUND_UNAVAILABLE`. The headless node host does not have this limitation for `system.run`.

### Platform Differences

- **macOS node host**: Prefers the companion app exec host when reachable; falls back to local execution. Control via `OPENCLAW_NODE_EXEC_HOST=app` or `OPENCLAW_NODE_EXEC_FALLBACK=0`.
- **Node hosts ignore PATH overrides**: `tools.exec.pathPrepend` is not applied to node hosts. Install tools in standard locations or configure the node host service environment.
- **Location is off by default**: Requires explicit user permission selection (Off / While Using / Always) on the node device.
- **SMS is Android-only**: Requires telephony hardware and SMS permission grant.

### Pairing Expiration

Pending pairing requests expire after **5 minutes**. If the operator does not approve in time, the node must reconnect to generate a new request.

### Canvas Limitations

- Only A2UI v0.8 JSONL is supported (v0.9/createSurface is rejected).
- Canvas present accepts URLs or local file paths with optional positioning (`--x/--y/--width/--height`).

### No Multi-Gateway Mesh

Nodes connect to a **single gateway**. There is no built-in node-to-node communication or multi-gateway mesh. Each node has exactly one gateway parent.

## Patterns

### Pattern: Dedicated Agent Nodes

**When:** You have different agents that need to execute on different machines.
**How:** Bind each agent to a specific node via per-agent config.
**Example:**
```json5
{
  agents: {
    list: [
      {
        id: "sysadmin",
        tools: { exec: { host: "node", node: "Mac Agent" } }
      },
      {
        id: "ops",
        tools: { exec: { host: "node", node: "DO Droplet" } }
      }
    ]
  }
}
```
**Pitfalls:** Each node must have appropriate exec approvals for the commands that agent will run.

### Pattern: Gateway + Remote Build Server

**When:** The gateway runs on a desktop but builds should happen on a dedicated server.
**How:** Run a headless node host on the build server, approve it, and set `tools.exec.host: "node"` globally.
**Example:**
```bash
# On build server
openclaw node install --host <gateway-tailscale-ip> --port 18789 --display-name "Build Server"

# On gateway host
openclaw nodes approve <requestId>
openclaw config set tools.exec.host node
openclaw config set tools.exec.node "Build Server"
```
**Pitfalls:** Ensure the build server has all required toolchains installed. Node hosts ignore `pathPrepend`.

### Pattern: Mobile Sensor Network

**When:** You want the agent to access phone cameras, GPS, and sensors.
**How:** Pair iOS/Android devices as nodes. The agent invokes camera, location, and screen capabilities through the gateway.
**Example:**
```bash
# Agent can take a photo from the iPhone
openclaw nodes camera snap --node "iPhone" --facing back

# Agent can get GPS location
openclaw nodes location get --node "iPhone" --accuracy precise
```
**Pitfalls:** Mobile nodes require foreground state for camera/canvas/screen. Location requires explicit user permission.

## Decision Framework

| If you need... | Use... | Because... | Trade-off |
|---------------|--------|------------|-----------|
| Shell commands on remote Linux/Windows | Headless node host | Lightest weight, no UI needed | No camera/canvas/screen capabilities |
| Full macOS integration | macOS companion app in node mode | Canvas, camera, screen, notifications | Requires macOS app running |
| Mobile sensor access | iOS/Android companion app | Camera, GPS, screen recording, SMS | Foreground requirement for most capabilities |
| Cross-network connectivity | Tailscale mesh | WireGuard encryption, MagicDNS, no port forwarding | Requires Tailscale on all machines |
| Air-gapped / no VPN | SSH tunnels | Works anywhere with SSH access | Manual tunnel management |
| Agent-specific routing | Per-agent node binding | Different agents target different machines | More complex config management |

## Open Questions

- [ ] **Node-to-node communication**: Can nodes invoke capabilities on each other, or must everything route through the gateway? (Current evidence: gateway-mediated only.)
- [ ] **Offline command queuing**: Is there any mechanism to queue commands for nodes that are temporarily offline? (Current evidence: no queuing, commands fail immediately.)
- [ ] **Node health monitoring**: Beyond `nodes status`, is there a heartbeat or health check mechanism for nodes? (The gateway tracks connect/disconnect but details on monitoring intervals are sparse.)
- [ ] **Browser proxy details**: The headless node host auto-advertises a browser proxy. What is the exact protocol and capability surface for remote browser automation via nodes?
- [ ] **Multi-gateway scenarios**: When running multiple isolated gateways, can a node connect to more than one gateway simultaneously?

## Sources & Evidence

All sources listed in frontmatter. Primary research conducted against the OpenClaw source repository at `C:\Users\robin\Downloads\openclaw\docs\` with cross-reference to the live configuration at `~/.openclaw/`. Protocol details verified against `docs/gateway/protocol.md`. Security model verified against `docs/gateway/security/index.md`.
