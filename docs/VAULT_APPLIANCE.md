# Vault appliance (Liquefy)

Install, quick start, decoder, benchmarks and policies for the vault appliance — the
Python module at the repository root. Feature-by-feature CLI guides live in
[VAULT_TOOLS.md](./VAULT_TOOLS.md). Moved here from the README.

> Commands and paths in code blocks are relative to the repository root.
> Back to the [README](../README.md).

## The vault appliance (resident module)

The rest of this README documents the repo's largest module: the **vault
appliance** — an entropy-native compression + security layer for agent
infrastructure. Trace vaults, bit-perfect verification, tamper-evident audit
trails, policy enforcement, and Solana anchoring. The `liquefy-*` skills in the
catalog are thin front-ends over these tools.

### Why teams deploy Liquefy

- **24 compression engines** — domain-aware compressors for JSON, logs, SQL, network captures, images, and more. Not a wrapper around zstd — each engine exploits the structure of its data type for ratios generic tools can't touch.
- **Bit-perfect verification (MRTV)** — every compress/decompress cycle is verified. Zero silent corruption. What goes in comes out identical, provably.
- **Cryptographic Flight Recorder** — SHA-256 hash-chained audit trails with on-chain anchoring (Solana). Automatic secret redaction. One-click HTML forensic reports. When the auditor, regulator, or lawyer arrives, you have mathematically verifiable proof — not just logs.
- **Active agent protection** — policy enforcement with kill switches, context-gated runs, token budget caps, sentinel file monitoring, replay blocking, and automated rollback. If an agent goes rogue or keeps re-running the same expensive context bundle, Liquefy halts it before damage is done.
- **One layer for all frameworks** — OpenClaw, NanoClaw, LangChain, CrewAI, Claude Agent SDK, or any agent that touches the filesystem.

---

## Trace Vault for agent runs

Agent frameworks produce trace explosions: JSONL logs, tool call outputs, HTML reports.
Trace Vault packs an entire run folder into verified `.null` archives with optional per-org encryption.
Restore is bit-perfect.

## Quick Start (30 seconds)

**macOS / Linux:**
```bash
git clone https://github.com/Parad0x-Labs/openclaw-skills
cd openclaw-skills
make setup
make quick DIR=~/openclaw/sessions
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/Parad0x-Labs/openclaw-skills
cd openclaw-skills
.\setup.ps1
.venv\Scripts\python tools\tracevault_pack.py .\your\data --org default --out .\vault\output --json
```

**pip install (add to existing project):**
```bash
pip install git+https://github.com/Parad0x-Labs/openclaw-skills.git
pip install "liquefy-openclaw[all] @ git+https://github.com/Parad0x-Labs/openclaw-skills.git"  # with all extras
```

Optional extras: `vision` (Pillow), `cloud` (boto3), `anchor` (solders), `api` (FastAPI server), `all` (everything).

**Docker:**
```bash
git clone https://github.com/Parad0x-Labs/openclaw-skills
cd openclaw-skills
docker compose run liquefy tools/tracevault_pack.py ./data --org default --out ./vault/output --json
```

See `AGENTS.md` for presets, full commands, and agent integration.

### Benchmark snapshot (default profile, post-fix)

Default profile is the production-oriented baseline. The scoreboard below is the current headline benchmark view (green/yellow/red = win/tie/loss by repo policy bands).

![Liquefy Scoreboard (Default Profile)](../liquefy_scoreboard_default.png)

Scoreboard source of truth (generated locally by the bench runner — `bench/results/`
is gitignored, so these files are **not** present in a fresh clone; regenerate them
with the bench scripts before quoting numbers):
- `./bench/results/SCOREBOARD.csv`
- `./bench/results/SCOREBOARD_SUMMARY.md`

Scoreboard summary from the reference run behind the image above:
- `WIN_SPEED`: `16`
- `WIN_RATIO`: `7`
- `WIN_RATIO+SPEED`: `2`
- `TIE_OK`: `17`
- `FAIL`: `0`

This scoreboard combines:
- realistic format matrix rows
- CI subset regression rows
- OpenClaw benchmark rows (50MB/200MB)

Note: engine-core tuning has moved since some previously generated benchmark artifacts. Regenerate `SCOREBOARD.csv` / `SCOREBOARD_SUMMARY.md` and the scoreboard image after major engine changes before publishing fresh numeric claims.

### Smoke fixtures (routing sanity only)

| Fixture | Purpose | Expected route |
|---|---|---|
| `apache.log` | Apache log routing smoke | `liquefy-apache-rep-v1` |
| `cloudtrail.jsonl` | CloudTrail/JSONL routing smoke | `liquefy-cloudtrail-v1` or JSON family engine |
| `dump.sql` | SQL routing smoke | `liquefy-sql-velocity-v1` |
| `sample.json` | JSON routing smoke | JSON family engine (`hypernebula` / cascade candidate) |
| `syslog_3164.log` | RFC3164 syslog routing smoke | `liquefy-syslog-rep-v1` |
| `syslog_5424.log` | RFC5424 syslog routing smoke | `liquefy-syslog-rep-v1` |
| `vpcflow.log` | VPC flow routing smoke | `liquefy-vpcflow-v1` |

These tiny fixtures are routing/correctness smoke examples only. Do not use them as headline performance numbers.

### Local development install

```bash
# One-command local install (macOS/Linux, Apple Silicon-friendly source path)
./install.sh

# Activate the local environment
source .venv/bin/activate

# Sanity-check the installed CLI surface
liquefy self-test --json

# Pack a run folder
python tools/tracevault_pack.py ./runs/latest --org dev --out ./vault/latest

# Restore
python tools/tracevault_restore.py ./vault/latest --out ./restored/latest
```

The activated venv exposes `liquefy`, `liquefy-safe-run`, and `liquefy-context-gate`.

### Runtime checks (binary-friendly)

```bash
# Build/runtime metadata
python tools/tracevault_pack.py --version --json

# Crypto + zstd + policy smoke checks
python tools/liquefy_openclaw.py --self-test --json

# Environment checks (paths, perms, secret requirements)
python tools/tracevault_restore.py --doctor --json
```

All three wrappers support `--version`, `--self-test`, and `--doctor` (machine-readable with `--json`).

### Framework-Agnostic — Works With Any Agent Stack

Liquefy doesn't care which framework runs your agents. If it produces files, we compress, verify, and audit them.

| Framework | Status | Notes |
|---|---|---|
| **OpenClaw** | Native plugin + skill pack | Full integration, benchmarked |
| **NanoClaw** | Works out of the box | Container output → `make quick` |
| **LangChain** | Works out of the box | JSONL/JSON traces routed automatically |
| **CrewAI** | Works out of the box | Agent run folders pack directly |
| **Claude Agent SDK** | Works out of the box | Structured JSON output, ideal match |
| **Custom / scripts** | Works out of the box | Any directory with logs/data |

```bash
# At end of any agent run, pack the output folder
python tools/tracevault_pack.py ./agent-output --org dev --out ./vault/latest
```

### One-command OpenClaw workspace pack

```bash
# Fastest OpenClaw source install + self-test + first safe scan (macOS/Linux)
git clone https://github.com/Parad0x-Labs/openclaw-skills.git && \
  cd openclaw-skills && \
  ./install.sh && \
  ./.venv/bin/python tools/liquefy_openclaw.py --self-test --json && \
  ./.venv/bin/python tools/liquefy_openclaw.py --workspace ~/.openclaw --out ./openclaw-vault --json

# Then (optional) use the bundled wrapper after install:
# Whole-workspace pack with built-in credential denylist + report
./liquefy openclaw --workspace ~/.openclaw --out ./openclaw-vault --verify-mode full --workers 8
```

The repo wrapper prefers `./.venv/bin/python` automatically when it exists, so `./liquefy ...` works immediately after source bootstrap.

This command writes `OPENCLAW_LIQUEFY_REPORT.md` inside the vault output folder and keeps compressed search available via:

```bash
./liquefy search ./openclaw-vault --query "trace_id"
```

### Policy audit & safe overrides (OpenClaw + TraceVault)

```bash
# Inspect the active effective policy before packing (human-readable)
python tools/liquefy_openclaw.py --workspace ~/.openclaw --out ./openclaw-vault \
  --print-effective-policy

# Explain why a path is allowed/denied (JSON, plugin-friendly)
python tools/liquefy_openclaw.py --workspace ~/.openclaw --out ./openclaw-vault \
  --json --explain credentials/api.pem

# Use a shared policy file for TraceVault scans
python tools/tracevault_pack.py ./runs/latest --org dev --out ./vault/latest \
  --scan-only --policy ./policies/balanced.yml --json

# Explicit risky override (loud, logged, recorded in JSON/report)
python tools/liquefy_openclaw.py --workspace ~/.openclaw --out ./openclaw-vault \
  --json --include-secrets "I UNDERSTAND THIS MAY LEAK SECRETS"
```

Policy examples:
- `./policies/strict.yml`
- `./policies/balanced.yml`
- `./policies/demo_risky.yml`

Security docs:
- `./docs/policy.md`
- `./docs/sdk.md`
- `./SECURITY.md`
- `./THREAT_MODEL.md`

JSON schemas (plugin / SDK integration contracts):
- `./schemas/liquefy.tracevault.cli.v1.json`
- `./schemas/liquefy.tracevault.restore.cli.v1.json`
- `./schemas/liquefy.openclaw.cli.v1.json`
- `./schemas/liquefy.cli.v1.json`

Restore safety:
- `tracevault_restore.py` defaults to a `2 GiB` total output cap to prevent disk-filling accidents.
- Use `--max-output-bytes 0` to disable the cap (power-user override).
- This protects local machines/CI runners when restoring untrusted or shared vaults.

Status artifacts (generated):
- `./bench/results/LIQUEFY_STATUS_REPORT.md`
- `./bench/results/LIQUEFY_STATUS_REPORT.json`

Free for any use under the MIT License — personal, nonprofit, academic, and commercial alike, including monetized hosted/API offerings and paid wrappers. No separate commercial license, no change date.

**Decoder is always available.** Decompression and verification never require a license, a running service, or access to this repo. Archives are self-contained. Your data is never hostage.

Not affiliated with OpenClaw, NanoClaw, or any agent framework vendor. See [docs/TRACE_VAULT.md](./TRACE_VAULT.md) for details.

### OpenClaw integration (1 minute)

```bash
# Legacy agent-scoped workflow (still supported)
python tools/openclaw_tracevault.py list
python tools/openclaw_tracevault.py pack --agent <agentId> --out ./vault/openclaw/<agentId>
python tools/openclaw_tracevault.py pack --agent <agentId> --since-days 7 --out ./vault/openclaw/<agentId>
```

<p align="center">
  <img src="./assets/github-footer-parad0xlabs.png" alt="NULL — Parad0x Labs open source systems" width="100%" />
</p>

## License
Licensed under the **MIT License** — free for any use, commercial or not, with no change date and no separate commercial tier. See [`LICENSE`](../LICENSE).
- **Free for everyone, everywhere.** Use it, embed it, run it in production, build a paid product on it — MIT permits all of it.
- **Decode-only recovery**: Always free and self-contained. Decompression and verification never require a license, a running service, or access to this repo.

---

## Bit-Perfect Restoration
Liquefy is internally tested for **bit-perfect round-trip across the suite**. Our test suite covers 24 engine combinations and validates integrity against the Golden-Rule standard.

*   [**View Enterprise Evaluation Notes**](./enterprise-evaluation.md)
*   [**View Technical Specification**](./technical-specification.md)

---

## Decoder CLI (Offline Recovery)

The Liquefy decoder CLI/appliance path provides offline data recovery and verification for production `.null` archives in hardened environments.

**This repository + Docker is sufficient for offline decompression and verification. No license is required for decode-only recovery.**

### One-Command Installation
```bash
# Fastest source install (macOS/Linux, Apple Silicon-friendly)
git clone https://github.com/Parad0x-Labs/openclaw-skills.git && cd openclaw-skills && ./install.sh

# Equivalent step-by-step:
git clone https://github.com/Parad0x-Labs/openclaw-skills.git
cd openclaw-skills
# Source install (works today)
./install.sh

# Or use the decoder wrapper directly (Docker-backed path for decode/verify)
chmod +x ./liquefy
```

### Verify Downloads (checksums)

Release binaries include `SHA256SUMS.txt`. Verify downloads before running them:

- See `./docs/VERIFY_DOWNLOADS.md` for macOS/Linux/Windows commands.
- The current release workflow generates `SHA256SUMS.txt` automatically in GitHub Releases.

### Usage (Linux/macOS)
```bash
# Decompress a production archive
./liquefy decompress archive.null restored.log

# Verify bit-perfect integrity
./liquefy verify archive.null
```

### Windows (PowerShell)
```powershell
.\liquefy decompress archive.null restored.log
```

---

## Complete Source-Available Engine

Unlike our previous black-box releases, this repository now contains the **complete source code** for the Liquefy compression engines, orchestrator, and safety valves.

You can inspect, compile, and run the entire source-available stack locally:

### Using the Open-Source Engines

See the `api/engines` folder for the Python implementations. Under the MIT License you can run compressions directly, with or without Docker, for any use — personal or production.

### OpenClaw Plugin Wrapper (Node.js scaffold)

A Node.js OpenClaw plugin wrapper scaffold is included under:

- `./plugins/openclaw-plugin`

It exposes `liquefy_scan` (read-only) and `liquefy_pack_apply` (optional) by shelling out to the Liquefy CLI JSON contracts.
It also includes a ClawHub/OpenClaw skill pack scaffold under:

- `./plugins/openclaw-plugin/skills/liquefy-openclaw/SKILL.md`

A standalone ClawHub-ready skill bundle also lives under:

- `./skills/liquefy-openclaw`

Publish/install trust notes (pinned plugin versions, checksums, safe defaults):

- `./docs/openclaw-plugin-publish.md`
- `./docs/clawhub-skill-publish.md`

### DNA x402 Payment Bridge Plugin

[DNA](https://github.com/Parad0x-Labs/dna-x402) is our open-source payment rail for AI agents (x402 protocol on Solana). The DNA payment bridge plugin archives micropayment audit logs and cryptographic receipts into Liquefy `.null` vaults.

- `./plugins/dna-payment`

**What it does:**
- Exports DNA payment audit events as Liquefy telemetry (NDJSON)
- Converts signed payment receipts into verifiable proof artifacts
- Preserves DNA Guard events for spend caps, replay alerts, quality disputes, and receipt verification trails
- Packs everything into `.null` vaults with bit-perfect verification

**Quick usage:**

```bash
# Export DNA payment data to a Liquefy-ready directory
python plugins/dna-payment/dna_bridge.py export \
  --server http://localhost:8080 \
  --out ./vault-staging/dna-payments

# Status / audit summary from the running DNA node
python plugins/dna-payment/dna_bridge.py status \
  --server http://localhost:8080

# Pack into a .null vault
python tools/tracevault_pack.py ./vault-staging/dna-payments \
  --org dna --out ./vault/dna-payments --json
```

DNA can also run as a live sidecar, streaming payment events directly into vault directories in real-time. See [`plugins/dna-payment/README.md`](../plugins/dna-payment/README.md) for full integration docs.

---

---

## Execution & Maintenance Policy

The decoder CLI/appliance path is built to fail closed rather than guess. To ensure secure conduction and data sovereignty, the following policies are enforced:

1.  **Maintenance & Compatibility:** This build is optimized for archives generated by the engine cores in this repo. While decompression is never paywalled, newer archive formats may require pulling the latest version.
2.  **Execution Safety:** To prevent runtime instability, the appliance requires a standard execution environment. If unauthorized runtime hooks (e.g. `LD_PRELOAD`) are detected, the appliance fails closed.
3.  **Data Sovereignty:** All operations happen locally. No data is ever transmitted back to Parad0x Labs.

## Benchmark Notes (Read This Before Comparing)

- Liquefy results are **profile- and workload-dependent** (`default`, `ratio`, `speed`).
- `default` / `ratio` profiles are judged against zstd high-compression behavior (zstd-22 class), not zstd speed-first settings.
- `speed` profile is the fair comparison point for zstd-3/zstd-6 throughput claims.
- See the committed visuals for a public-safe summary:
  - `./liquefy_scoreboard_default.png`
  - `./liquefy_vs_zstd_openclaw_50_200.png`

### Post-hardening verification (API auth/traversal fixes)

The API hardening changes (auth enforcement, upload sanitization, raw-blob decompress
routing) touched only the HTTP boundary and blob routing — **no codec or engine output
changed**. Verified by:

- `tests/test_roundtrip_byteperfect.py` against `tests/golden/engine_profiles_v1.json`
  (output byte sizes and hashes identical to golden profiles) — full suite green.
- Red-team harness (`bash tests/redteam/run_all.sh`) — ALL PASS.

Committed CI benchmark: [`benchmarks/latest_ci.csv`](../benchmarks/latest_ci.csv), produced by
`benchmarks/run_ci_subset.py` (median of 3 runs, committed 2026-02-26) on two fixtures from
`tests/fixtures/golden_inputs/`. Every row passed the byte-perfect round trip.

| Fixture | Liquefy `default` | Liquefy `ratio` | zstd -19 | zstd -3 |
|---|---|---|---|---|
| `generic_json_hyperfriendly_1024` (191,018 bytes of deliberately repetitive JSON) | **114.7x** | 114.7x | 45.3x | 24.3x |
| `vpcflow_canonical_256` (26,502 bytes of VPC flow logs) | 5.86x | **6.95x** | 5.86x | 4.87x |

Scope: these are two small fixtures, one built to be highly repetitive; ratios on other data, including
customer agent traces, will differ. The earlier README figure of 103.9x versus 63.8x for zstd -19 (a
19-file, 1.9 MB set) has no committed result file and is not used. On dense non-target text
(docs/schemas/markdown, ~1 MB) Liquefy measured 1.02x versus 1.06x for zstd -19 in the same earlier pass,
also without a committed result file. The engines are format specialists: feed them agent traces and
machine logs, not prose.

Reproduce (needs the Python dependencies from `requirements.txt`):

```bash
python benchmarks/run_ci_subset.py --out /tmp/latest_ci.csv --runs 3
python benchmarks/compare.py --baseline benchmarks/latest_ci.csv --latest /tmp/latest_ci.csv
```

---

## Contact

openclaw-skills is MIT-licensed — there's no license to buy. For managed/hosted deployments, support, or partnership:

*   **Email:** [hello@parad0xlabs.com](mailto:hello@parad0xlabs.com)
*   **X (Twitter):** [@Parad0x_Labs](https://x.com/Parad0x_Labs)

© 2026 Parad0x Labs.
