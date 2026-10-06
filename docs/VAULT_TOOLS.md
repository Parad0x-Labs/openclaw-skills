# Vault appliance tools — CLI guide

One section per tool in the vault appliance: guards, redaction, de-noise, flight recorder,
cloud sync, policy enforcement, context gate, safe run, anchoring. Install first via
[VAULT_APPLIANCE.md](./VAULT_APPLIANCE.md). Moved here from the README.

> Commands and paths in code blocks are relative to the repository root.
> Back to the [README](../README.md).

## Agent Blueprints — Catalog, Chains & Scaffolding

15 ready-made agent templates with built-in guardrails, interaction chains, and one-command scaffolding. Each template comes with safe defaults (draft-only mode, action caps, quiet hours, content deny-lists) so high-risk agents like email campaigns or social publishers can't go rogue out of the box.

```bash
liquefy agents list                                          # Browse 15 templates
liquefy agents show inbox-triage-agent                       # Inspect guardrails & I/O contract
liquefy agents map                                           # Show all interaction chains
liquefy agents scaffold email-campaign-agent --runtime openclaw --out ./agents  # Generate workspace
```

- **Interaction chains** — pre-wired multi-agent flows (research-to-publish, support-resolution, communications-ops, etc.)
- **Handoff contracts** — machine-readable JSON defining inputs, outputs, and peer agents
- **Safe defaults** — communications agents ship `draft_only` with approval gates, action throttles, and recipient allowlists
- **Runtime agnostic** — scaffolds for OpenClaw, NanoClaw, or generic Python runners

See [`docs/OPENCLAW_AGENT_BLUEPRINTS.md`](./OPENCLAW_AGENT_BLUEPRINTS.md) for the full catalog and chain documentation.

---

## State Guard — Session Reset Protection

An agent crashes, the session resets, and suddenly it doesn't know there's $450K in the wallet. State Guard prevents this by declaring critical state files, verifying them before every run, and checkpointing them after. If state goes missing or drifts, the agent cannot act until recovery.

```bash
liquefy state-guard init ~/.openclaw --files wallet-state.json positions.json --strict
liquefy state-guard check ~/.openclaw --json          # Pre-flight: PASS or BLOCK
liquefy state-guard checkpoint ~/.openclaw             # Post-flight: hash + backup state
liquefy state-guard status ~/.openclaw                 # Dashboard: file health at a glance
liquefy state-guard recover ~/.openclaw                # Restore last checkpointed state
```

- **Drift detection** — SHA-256 comparison between checkpointed and current state; catches silent corruption or unintended writes
- **Strict mode** — blocks the agent from running if any declared state file is missing or drifted (`--strict`)
- **Auto-discovery** — detects common state file patterns (`*-state.json`, `*-history.jsonl`) in the workspace
- **Checkpoint + recover** — full file backups with one-command restore after crashes or resets
- **Staleness checks** — warns when state files haven't been updated within the configured window

---

## History Guard — Continuous Backup + Destructive-Action Gate

Agents with access to email, calendar, Telegram, Discord, or social accounts can go rogue and delete everything. History Guard continuously pulls authorized exports from configured providers, vaults them with compression + encryption, and gates risky commands behind approval tokens and pre-action snapshots.

```bash
liquefy history-guard init --workspace ~/.openclaw                       # Create config with provider templates
liquefy history-guard set-approval-token --workspace ~/.openclaw         # Set approval hash for risky ops
liquefy history-guard pull-once --workspace ~/.openclaw --json           # One-shot pull + vault cycle
liquefy history-guard watch --workspace ~/.openclaw --poll-seconds 60    # Continuous pull daemon
liquefy history-guard gate-action --workspace ~/.openclaw --command "python purge_inbox.py" --json
liquefy history-guard status --workspace ~/.openclaw --json              # Provider health dashboard
```

- **Risky command detection** — regex pattern matching (delete, remove, purge, wipe, ban, revoke, etc.) blocks dangerous commands without approval
- **Approval token gate** — SHA-256 hashed token stored in config, verified via environment variable at runtime (HMAC-safe comparison)
- **Pre-action snapshots** — full workspace vault created before any risky command executes, with tar.gz fallback if pack fails
- **Auto-recovery** — if the gated command fails, workspace is automatically restored from the pre-action snapshot
- **Provider framework** — pluggable exporters for Gmail, Calendar, Discord, Telegram, X, Instagram (bring your own pull script)

See [`docs/OPENCLAW_HISTORY_GUARD.md`](./OPENCLAW_HISTORY_GUARD.md) for architecture, approval model, and provider contract.

---

## PII Redaction — Strip Before LLM Ingestion

Agents process emails, logs, and user data that contain PII (emails, IPs, API keys, phone numbers, SSNs, wallet addresses). The Redact tool strips sensitive values and replaces them with typed redaction markers BEFORE data enters an LLM context window or leaves your network. Unlike LeakHunter (which blocks), Redact produces a clean, usable copy.

```bash
liquefy redact scan ./agent-output --json                    # Dry-run: report PII without changes
liquefy redact apply ./agent-output --out ./clean --json     # Redact to output directory
liquefy redact apply ./agent-output                          # Redact in-place
liquefy redact profile ./agent-output --json                 # PII density + impact estimate
```

- **20+ PII patterns** — emails, IPv4/IPv6, phone numbers, SSNs, credit cards, AWS/GitHub/OpenAI/Anthropic/Stripe/Slack keys, bearer tokens, PEM blocks, ETH addresses
- **Category filtering** — redact only specific types (`--categories email ipv4`)
- **Wallet opt-in** — Solana address detection disabled by default (high false-positive risk), enable with `--include-wallets`
- **Profile mode** — estimate PII density and byte impact before committing to redaction

---

## Log De-Noise — Context Window Tax Killer

Logs are mostly noise (heartbeats, health checks, status 200s, metrics scrapes). The De-Noise tool strips routine noise and keeps only signal lines (errors, warnings, crashes, security events, state changes, payment activity) plus configurable context around them. Can cut LLM context token cost by 60-95% depending on log composition — run `denoise stats` first to see yours.

```bash
liquefy denoise stats ./logs --json                          # Estimate noise ratio
liquefy denoise filter ./logs --out ./signal --json          # Filter noise, keep signal + context
liquefy denoise filter ./logs --context 5 --keep-neutral     # More context, keep neutral lines
liquefy denoise extract ./logs --trace-id abc-123 --json     # Extract error clusters for a trace ID
```

- **Signal detection** — errors, warnings, HTTP 4xx/5xx, crashes, security events, payment activity, state changes, data loss
- **Noise detection** — HTTP 200/204/304, heartbeats, health endpoints, debug traces, metrics scrapes, cache hits, static assets, session refreshes
- **Context preservation** — keeps N lines before/after each signal so you don't lose stack traces
- **Trace extraction** — pull error/warning clusters around a specific trace ID for targeted debugging

---

## Vision — Screenshot Dedup (Engine #24)

AI agents capture redundant screenshots (10-50 shots of the same static window). The Vision engine deduplicates near-identical images using perceptual hashing, storing only unique frames.

```bash
make vision-scan DIR=./agent-screenshots         # Report dedup potential
make vision-pack DIR=./agent-screenshots          # Pack into VSNX vault (deduplicated)
make vision-restore SRC=./vault/vision.vsnx       # Restore all images from vault
make vision-stats SRC=./vault/vision.vsnx         # Show dedup stats
```

- **Perceptual hashing** — 8x8 average-hash (aHash) detects visually identical frames even with minor pixel differences
- **Exact dedup** — SHA-256 catches byte-identical files (zero-cost)
- **VSNX container** — compact binary format with manifest + compressed unique blobs
- Install Pillow for full perceptual mode: `pip install Pillow`

## Cryptographic Flight Recorder (Forensic Replay & Tamper-Evidence)

Every agent run is captured into a cryptographically signed, tamper-evident "black box." If an agent goes rogue — drops a database, leaks customer data, burns $50K in API calls — you don't grep through JSON. You open an HTML report and see exactly what happened, verified by an unbroken SHA-256 hash chain that proves the logs were not altered after the fact.

```bash
make compliance VAULT=./vault ORG=acme TITLE="Q1 Audit"  # HTML forensic report
make compliance-verify VAULT=./vault                       # Verify chain integrity (pass/fail)
make compliance-timeline VAULT=./vault                     # Chronological event replay
make vault-anchor VAULT=./vault                            # Anchor proof to Solana blockchain
```

- **SHA-256 hash chain** — every audit event links to the previous via cryptographic hash. Tamper with one entry and the entire chain breaks. Verified per-entry by `compliance verify`.
- **On-chain anchoring** — vault integrity proofs (file hashes, chain tip, key fingerprint) can be anchored to Solana. Third parties can independently verify your logs existed at a specific point in time without seeing the data.
- **One-click HTML reports** — professional forensic dashboards designed for CTOs, compliance officers, and legal teams who need answers without touching a terminal.
- **Intended to support audit/regulatory review** — or incident investigation. The combination of hash-chained logs + on-chain timestamp proofs gives you cryptographically verifiable evidence, not just "trust us."

## Cloud Sync (S3 / R2 / MinIO)

Sync encrypted vaults to any S3-compatible storage. The cloud provider sees only opaque blobs — "sovereign" means encrypted everywhere, not just local.

```bash
make cloud-push VAULT=./vault BUCKET=my-backups           # Incremental push
make cloud-pull VAULT=./vault BUCKET=my-backups           # Restore from cloud
make cloud-status VAULT=./vault BUCKET=my-backups         # Compare local vs remote
make cloud-verify VAULT=./vault BUCKET=my-backups         # Verify remote integrity
```

- **Incremental sync** — only uploads changed/new vaults (SHA-256 manifest tracking)
- **Any S3-compatible** — AWS S3, Cloudflare R2, MinIO, etc.
- **Integrity verification** — confirms remote files match local hashes
- Install boto3: `pip install boto3`

## Policy Enforcer (Active Kill Switch)

Three levels: audit (report), enforce (block), kill (halt signal + SIGTERM).

```bash
make policy-audit DIR=./agent-output      # Report violations
make policy-enforce DIR=./agent-output    # Block on critical/high
make policy-kill DIR=./agent-output       # Write halt signal to stop agent
```

- **Secret detection** — API keys, tokens, AWS creds, private keys, JWTs
- **Forbidden files** — `.exe`, `.dll`, `.vbs`, executables rejected
- **Watch mode** — continuous monitoring with auto-halt on critical violations
- **Hardened halt** — HMAC-signed signals, nonce replay protection, TTL expiry, process group kill
- **Custom policies** — configurable size limits, extensions, patterns

## Content-Addressed Storage (Cross-Run Dedup)

Blobs stored once by SHA-256, vaults become lightweight manifests over shared blobs:

```bash
make cas-ingest DIR=./agent-run-1    # First run: stores all blobs
make cas-ingest DIR=./agent-run-2    # Second run: only new blobs stored
make cas-status                      # Show dedup savings
make cas-gc                          # Clean orphan blobs
```

- Same screenshots, prompts, configs across runs are never stored twice
- Sharded blob directory (first 2 chars) for filesystem friendliness
- Manifest-based restore: `make cas-restore MANIFEST=<id> OUT=./restored`

## Unified CLI

One entry point for all operations:

```bash
liquefy pack       --workspace ~/.openclaw --out ./vault --apply
liquefy restore    ./vault/run_001 --out ./restored
liquefy policy     audit --dir ./agent-output --json
liquefy safe-run   --workspace ~/.openclaw --cmd "openclaw run"
liquefy context-gate compile --workspace ~/.openclaw --cmd "openclaw run" --block-replay
liquefy cas        ingest --dir ./agent-output
liquefy tokens     scan --dir ./agent-output
liquefy telemetry  push --webhook https://my-siem/api
liquefy events     emit --agent-id a1 --session-id s1 --event model_call
liquefy guard      save --dir .
liquefy anchor     --vault-dir ./vault
```

## Agent Event Schema

Structured traces with parent/child span trees:

```bash
make event-emit AGENT_ID=a1 SESSION_ID=s1 EVENT=model_call MODEL=gpt-4o
make event-query SESSION_ID=s1
make event-spans SESSION_ID=s1       # parent->child span tree
make event-stats SESSION_ID=s1       # tokens, cost, duplicate prompts
```

- `agent_id`, `session_id`, `span_id`, `parent_span_id`, `trace_id`
- Model call metadata: model, tokens, cost, duration
- Tool call I/O refs, prompt hash, context hash
- Error/retry/escalation markers
- Duplicate prompt detection in stats

## Context Gate (Bounded Prompt Compiler + Replay Barrier)

Move context discipline into the hot path instead of pretending post-run reports are prevention.

```bash
# Compile the next run's runtime context under a hard token budget
liquefy context-gate compile \
  --workspace ~/.openclaw \
  --cmd "openclaw run" \
  --token-budget 2400 \
  --block-replay

# Inspect replay history for the workspace
liquefy context-gate history --workspace ~/.openclaw --json

# Guarded OpenClaw run: capsule -> context gate -> snapshot -> execute
python tools/liquefy_openclaw.py run \
  --workspace ~/.openclaw \
  --cmd "openclaw run" \
  --context-budget-tokens 2400 \
  --json
```

- **Hard token budget** - ranks optional context blocks and refuses runs when the required identity/bootstrap set cannot fit (`required_context_exceeds_budget`)
- **Exact replay barrier** - blocks the same command + compiled-context bundle for 24 hours by default on `liquefy_openclaw.py run`; use `--allow-replay` only when you mean it
- **Explainable artifacts** - writes `.liquefy/context/current/context_gate_prompt.md`, `.liquefy/context/current/context_gate.json`, and `.liquefy/context/history/context_gate_history.json`
- **Secret-aware summaries** - includes redacted provider profile summaries instead of blindly stuffing raw config into the prompt

## Safe Run (Context Gate + Automated Rollback + Cost Cap + Watchdog)

Wrap agent execution with snapshot + auto-restore on violations:

```bash
make safe-run WORKSPACE=~/.openclaw CMD="openclaw run" SENTINELS=SOUL.md,HEARTBEAT.md

# With bounded context, replay blocking, cost cap, and heartbeat watchdog
python tools/liquefy_safe_run.py \
    --workspace ~/.openclaw --cmd "python agent.py" \
    --context-budget-tokens 2400 \
    --block-replay \
    --max-cost 5.00 --heartbeat --sentinels SOUL.md --json
```

- **Context gate first** - compiles the primed workspace context under budget before the agent gets a chance to run
- **Snapshot** workspace before run, **restore** if policy violation or crash
- **Replay guard** - rejects unchanged command + context replays inside the configured replay window
- **Token cost cap** (`--max-cost`) — auto-rollback if agent burns more than your USD limit (prevents economic DoS)
- **Dead Man's Switch** (`--heartbeat`) — writes `.liquefy-heartbeat` every 5s; agent or watcher self-halts if monitoring dies
- **Sentinel monitoring** — detect tampering of SOUL.md, HEARTBEAT.md, auth-profiles.json
- **Docker jail** pattern documented for host-isolated agent execution

## Multi-Agent Chain of Custody

Trace prompts across agent handoffs (researcher -> executor -> verifier):

```bash
python tools/liquefy_openclaw.py --workspace ~/.openclaw --out ./vault --apply --trace-id "task-42"
python tools/liquefy_policy_enforcer.py enforce --dir ./vault --trace-id "task-42" --json
```

- `--trace-id` or `LIQUEFY_TRACE_ID` env var on all tools
- Logged in audit chain, written to vault, forwarded to SIEM

## Telemetry Forwarder (SIEM Streaming)

Push audit events to Splunk, Datadog, ELK, Slack, or any SIEM in real-time.

```bash
make telemetry-push WEBHOOK=https://splunk:8088/services/collector
make telemetry-stream SYSLOG=10.0.0.1:514 INTERVAL=10
make telemetry-test FILE=/var/log/liquefy.jsonl
```

- **Webhook** — HTTP POST JSON to any endpoint
- **Syslog** — RFC 5424 UDP/TCP for enterprise log collectors
- **Cursor-based** — only forwards new events, no duplicates

## Token Ledger [EXPERIMENTAL]

Track where your tokens go, set budgets, and catch waste before the bill arrives.

```bash
make token-scan  DIR=./agent-output                   # Extract usage from logs
make token-budget ORG=acme DAILY=500000               # Set daily limit
make token-report ORG=acme PERIOD=today               # Usage breakdown
make token-audit DIR=./agent-output                   # Find waste
```

- **Multi-provider** — parses OpenAI, Anthropic, LangChain, generic JSONL
- **Waste detection** — duplicate prompts, oversized context, expensive models for trivial tasks
- **Budgets** — daily/monthly token + cost limits with warnings
- **Auto-detect** — flags unknown models and model switches with fix commands
- **28 built-in models** — GPT-5, Claude 4.6, Gemini 2.0, DeepSeek R1, etc. User-expandable via `make token-models --add`
- **Experimental** — cost estimates are approximate; use provider billing for exact amounts

## Config Guard (Update Protection)

Framework update overwrites your configs? Not anymore.

```bash
make guard-save DIR=./my-agent LABEL="pre-v2.0"    # Snapshot before update
# ...run your update...
make guard-diff DIR=./my-agent                       # See what changed
make guard-restore DIR=./my-agent                    # Restore your customizations
```

- **Auto-detects** configs, skills, prompts, env files, Dockerfiles, Makefiles
- **Conflict-safe** — saves `.update-backup` copies when both you and the update changed a file
- **Framework-agnostic** — works with any project directory
- **Dry-run** mode to preview without touching anything

## On-Chain Vault Anchoring (Solana)

Anchor vault integrity proofs on Solana. ~80 bytes of hashes go on-chain via SPL Memo — no data, no keys, just a fingerprint that proves your vault existed in a specific state at a specific time. Anyone with a Solana explorer can verify it.

```bash
make vault-proof  VAULT=./vault                   # Compute proof (free, offline)
make vault-anchor VAULT=./vault KEYPAIR=~/.config/solana/id.json  # Anchor on Solana
make vault-verify VAULT=./vault                   # Verify vault vs anchor
make vault-show   PROOF=./vault/.anchor-proof.json  # Display proof
```

- **Cost:** ~0.000005 SOL per anchor
- **What's anchored:** vault file hash, audit chain tip hash, signing-key fingerprint (the Ed25519 **public-key** fingerprint when the vault is signed — publicly reproducible; falls back to the encryption-key fingerprint for unsigned vaults)
- **What's NOT anchored:** your data, your private key, anything readable
- Install solders + httpx: `pip install solders httpx` (proof generation works without them)

### Publicly verifiable vault signatures

Signed vaults carry an **Ed25519** signature (`.liquefy/signature.json`) and the
**public key** (`.liquefy/signing_pubkey.ed25519`). Verification needs *only* the
public key — no secret — so any third party can confirm a vault, and the
key fingerprint anchored on-chain pins which key is authentic. (A legacy
HMAC-SHA256 mode exists for local-only integrity; it is **not** publicly
verifiable and isn't used for anything claimed to be.)

```bash
make vault-sign VAULT=./vault                                  # Ed25519-sign (default)
make vault-verify-signature VAULT=./vault                      # verify with the published public key
```

See [`docs/VERIFY_VAULT_SIGNATURE.md`](./VERIFY_VAULT_SIGNATURE.md) for the trust model and how to pin verification to the on-chain fingerprint.
