# Skills catalog and stack map

Full catalog of the agent skills and plugins in this repository, the module contract
they follow, and where they sit in the Parad0x Labs stack. Moved here from the README.

> Commands and paths in code blocks are relative to the repository root.
> Back to the [README](../README.md).

## agent.null — what these skills add up to

Together they're an **agent-to-agent marketplace**: an agent publishes what it can do,
another discovers it by capability, pays per call in USDC, and both keep a verifiable
receipt — no human in the loop, no platform holding the funds.

- **Pay / charge** — `x402-pay` + `x402-gate` settle in USDC on Solana (public beta; devnet by
  default, mainnet-beta opt-in). Each payment carries a **0.05% protocol fee** in the same atomic
  transaction, verified on-chain by the gate (client-side, fail-closed; non-custodial).
- **Identity + reputation** — `agent-passport` reads a `.null` name's on-chain owner record, so an
  agent is identifiable by a verifiable on-chain identity, not a URL (legacy mainnet names are read-only).
- **Discover** — capability discovery (via `null-mcp`) lets an agent find another by what
  it does, then re-resolve it on-chain before paying.

Walkthrough: **[The Web0 agent loop](./WEB0_AGENT_LOOP.md)**.

## Why this stack is different

Every claim below is enforced by code or CI in this repo — none is aspirational:

- **Compression you can trust by construction.** MRTV (Mandatory Round-Trip
  Verification) re-decompresses and hash-checks every archive before it's accepted.
  A byte-imperfect result is never silently stored — the engine falls back or fails.
  Measured **103.9x vs zstd-19's 63.8x** on agent-trace fixtures, with golden
  byte-perfect profiles pinned in CI (`tests/golden/engine_profiles_v1.json`).
- **A test suite designed to be able to fail.** The red-team harness runs mutation
  invariants that deliberately corrupt engines to prove the suite catches breakage,
  plus crash-recovery campaigns and zero-flake stress runs — wired as a release gate,
  not a side badge. Most compression tools ship neither.
- **Fail-closed security posture.** Missing encryption keys stop the server instead of
  starting insecure; uploads are size-capped and path-sanitized; archive downloads are
  authenticated; AES-256-GCM with per-tenant PBKDF2 key derivation throughout.
- **Verifiable end to end.** Vaults carry tamper-evident hash chains, optional Ed25519
  signatures, and 80-byte Solana anchors anyone can check on a block explorer — without
  seeing a single byte of your data.
- **Non-custodial payments with no trusted middleman.** x402 settles in the same atomic
  transaction as the API call; wallets are bring-your-own; spend caps are hard-coded.

## The catalog

| Skill | What it does | Standalone? | Pairs with | Install |
|---|---|---|---|---|
| [`x402-pay`](../skills/x402-pay) | Your agent **pays** x402-gated APIs/agents in USDC on Solana (devnet by default, mainnet-beta opt-in) — BYO signer, never holds a key, hard spend cap | Yes — works against any x402 endpoint | `x402-gate` (the selling side) | `npm i @parad0x_labs/openclaw-x402-pay` |
| [`x402-gate`](../skills/x402-gate) | **Charge** other agents per call — mint a 402 challenge, verify (optionally on-chain-confirmed), serve; funds land in your own wallet | Yes — any x402 client can pay it | `x402-pay` (the buying side) | `npm i @parad0x_labs/openclaw-x402-gate` |
| [`context-capsule`](../skills/context-capsule) | Compresses long session history before the model call — bounded, deterministic, keeps decisions/errors/IDs/ports/values, no network, no chain (public fixture: 7,281 -> 2,061 tokens per call, answer keywords present for 21/40 questions vs 35/40 full history; see [benchmark](CONTEXT_CAPSULE_BENCHMARK.md)) | Yes — fully self-contained | everything — orthogonal | `npm i @parad0x_labs/openclaw-context-capsule` |
| [`mcp-server`](../skills/mcp-server) | **MCP server** for any MCP client (Claude Desktop/Cursor/Windsurf): x402 quote, receipt hashing, agent-identity lookup, `.null` resolution, stack status (receipt anchoring and nullifier checks return after the redeploy under a fresh key). Read-only by default; writes need an opt-in keypair + per-call confirm | Yes — standalone MCP server | pairs with `null-mcp` for the full loop | `npx @parad0x_labs/mcp-server` |
| [`web0-onboard`](../plugins/web0-onboard) | **One call** to stand up a paid `.null` agent: derives your identity, returns an x402 storefront config, reports the receipt-anchoring status, and includes `register_null_name` / `set_null_endpoint` / `set_null_stealth_meta` builders for the `.null` registrar — the mainnet registrar is retired, so these writes are unavailable until the relaunch; non-custodial | Yes — one-call web0 setup | `null-mcp`, `x402-gate` | `npm i @parad0x_labs/openclaw-web0-onboard` |
| [`agent-passport`](../plugins/agent-passport) | On-chain **agent identity** — `.null` name + ETH↔Solana wallet binding via `get_agent_passport` / `verify_agent_identity`, verified against the on-chain owner record (legacy mainnet records are readable) | Yes — identity lookup + verify | `web0-onboard`, `x402-pay` | `npm i @parad0x_labs/openclaw-agent-passport` |
| [`payment-session`](../plugins/payment-session) | **Streaming + recurring** x402 billing over `pay_x402` — metered and subscription charges with a hard per-session cap | Yes — wraps any x402 endpoint | `x402-pay`, `x402-gate` | `npm i @parad0x_labs/openclaw-payment-session` |
| [`liquefy-openclaw`](../skills/liquefy-openclaw) | Skill pack for the vault appliance: scan/pack flows, guarded runs, context gate, replay blocking, restore | needs the vault appliance below | vault appliance | copy skill dir / ClawHub |
| [`liquefy_archive`](../skills/liquefy_archive) | One-click compression, redaction & vault archival of OpenClaw workspaces | needs the vault appliance below | vault appliance | skill.json install |
| [`liquefy_token_guard`](../skills/liquefy_token_guard) | Token usage scan, waste audit, and budget guard for agent workspaces | needs the vault appliance below | vault appliance | skill.json install |

Plus the **resident module**: the [vault appliance](./VAULT_APPLIANCE.md)
(Python, repo root) — trace vaults, policy enforcement, flight recorder,
state/history guards. The three liquefy skills above are its front-ends.

**Start here →** [**The Web0 agent loop**](./WEB0_AGENT_LOOP.md): pay and get
paid in USDC on Solana (public beta; devnet by default, mainnet-beta opt-in) and keep
long sessions cheap — non-custodial at every step.

## The modularity contract

Every entry under `skills/` is a **self-contained module**:

- **No imports across skills.** A skill never references a sibling's code —
  shared constants are vendored. Updating or deleting one skill cannot break
  another.
- **Own version, own README, own SKILL.md.** Each module documents what it
  does, whether it works standalone, and what it pairs with.
- **Own CI lane.** Workflows are path-filtered to `skills/<name>/**` — a change
  to one skill builds and tests only that skill.
- **Trust model up front.** Skills that can touch money state it bluntly
  (custody, caps, network defaults) before the install instructions.

> Everything here is MIT. Money-touching skills are non-custodial by design —
> your own wallet signs, the skill never holds a key — and capped on the paying side.

### How this fits the Parad0x stack

Parad0x Labs builds Web0 on Solana — money and agents that settle themselves. **You are here: Skills — the OpenClaw-facing distribution of the stack below.**

| Layer | Repo | Does |
|---|---|---|
| Payments | [dna-x402](https://github.com/Parad0x-Labs/dna-x402) | x402 rail: quote → pay → verify → receipt (on-chain anchoring after the redeploy under a fresh key) |
| Build | dna-x402-builders (private repository) | Hosted kit: turn any API/bot into a paid agent |
| Privacy | [Dark-Null-Protocol](https://github.com/Parad0x-Labs/Dark-Null-Protocol) | Groth16 privacy settlement — devnet (no mainnet deployment today); published proofs |
| Data | liquefy (private repository) | Columnar compression that beats Zstd |
| Audit | this repository ([vault appliance](./VAULT_APPLIANCE.md)) | Flight recorder: 24 engines + Solana-anchored audit trails |
| Media | nebula-media (private repository) | Proof-carrying media compression — scene-aware + on-chain receipts |
| Runtime | [VOOL](https://github.com/Parad0x-Labs/vool) | Daily-user AI runtime — local-first, cloud when you choose |

**See it live** (a consumer app running on these rails): **[parad0xlabs.com](https://parad0xlabs.com)**

## LLM / Agent Quick Parse

```yaml
product: openclaw-skills
category: modular agent skills for OpenClaw and *claw-family runtimes
skills:
  x402-pay: pay x402-gated APIs on Solana — devnet default, mainnet-beta opt-in (BYO signer, capped)
  x402-gate: charge other agents per call (no custody, on-chain verify option)
  context-capsule: compress long session history (no network, no chain)
  mcp-server: MCP server — x402 quote / receipt hashing / identity lookup / stack status (any MCP client)
  liquefy-openclaw: guardrail flows for the vault appliance
  liquefy_archive: one-click workspace vaulting
  liquefy_token_guard: token waste audit + budgets
plugins:
  web0-onboard: one-call web0 setup — identity + x402 storefront config (npm; .null registration frozen on mainnet)
  agent-passport: on-chain agent identity — .null + ETH<->Solana binding, verified vs on-chain owner record
  payment-session: streaming + recurring x402 billing (hard per-session cap)
resident_module: vault appliance (Python, repo root — trace vaults, policy, flight recorder)
contract: skills are self-contained — no cross-skill imports, path-filtered CI
agent_loop: docs/WEB0_AGENT_LOOP.md (name + x402 endpoint + get paid); PUBLISH_RUNBOOK.md
companions:
  null-mcp: "@parad0x_labs/null-mcp — .null domains MCP (read-only resolution)"
entrypoints:
  catalog: ./README.md
  skills: ./skills/
  agent_guide: ./AGENTS.md
  stack_map: ./docs/PARADOX_STACK.md
not_for:
  - the x402 rail itself (see dna-x402)
  - privacy settlement protocol (see Dark-Null-Protocol)
related_repos:
  payment_rail: https://github.com/Parad0x-Labs/dna-x402
  privacy_settlement: https://github.com/Parad0x-Labs/Dark-Null-Protocol
  audit_layer: https://github.com/Parad0x-Labs/openclaw-skills
```
