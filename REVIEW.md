# Review guide: openclaw-skills

A short reading path for people and AI reviewers. It says what this repository contains, what has been
demonstrated, where it runs, and what is not established. The capability table is generated from
[`evidence/claims.json`](./evidence/claims.json) and checked in CI by
[`scripts/check-claims-registry.mjs`](./scripts/check-claims-registry.mjs).

| Snapshot | |
|---|---|
| Commit checked | `c103eac1c3c832bdbe65f89e549d7f2193ae8686` (`main`, observed 2026-10-06 08:23 UTC) |
| npm registry checked | 2026-10-06 08:23 UTC (re-checked 09:32 UTC for x402-pay, payment-session, agent-passport) |
| Local fixes after the snapshot | `bcd45a4` (2026-10-06, not yet on GitHub): agent-passport drops the closed receipt_anchor id, payment-session 0.1.1 budget wording, fee-on-top wording, committed vault benchmark. Claims that cite it say so in `source_sha` |

Read in this order: this page, then the `src/` paths named in the table, then
[`docs/VAULT_APPLIANCE.md`](./docs/VAULT_APPLIANCE.md) for the Python appliance. Git versions and npm
versions are listed separately; several packages have unreleased changes in Git.

## What it is

Two independent products in one repository:

1. **TypeScript agent skills** for OpenClaw and MCP clients: pay x402 endpoints (`x402-pay`), charge for a
   service (`x402-gate`), track session spending (`payment-session`), compact long histories
   (`context-capsule`), read-only MCP tools (`mcp-server`), identity lookup (`agent-passport`,
   `web0-onboard`). Payments use the operator's own wallet; no skill holds a key.
2. **Liquefy**, a Python appliance that compresses, encrypts and hash-chains agent run folders into vaults,
   with optional Solana memo anchoring of a vault fingerprint.

The skills do not import Liquefy.

## Component boundaries

| Component | Path | Runs where | npm |
|---|---|---|---|
| x402-pay | `skills/x402-pay/` | Buyer agent; broadcasts the operator-signed transfer | git 2.0.1, npm 2.0.0 |
| x402-gate | `skills/x402-gate/` | Seller agent; verifies by RPC | git 2.0.1, npm 2.0.0 |
| payment-session | `plugins/payment-session/` | In memory | git 0.1.1, npm 0.1.0 |
| context-capsule | `skills/context-capsule/` | Local, no network; see [`docs/CONTEXT_CAPSULE_DATAFLOW.md`](./docs/CONTEXT_CAPSULE_DATAFLOW.md) | git 1.7.1, npm 1.7.0 |
| mcp-server | `skills/mcp-server/` | Local MCP process; read-only RPC | git 0.2.0, npm 0.2.0 |
| agent-passport | `plugins/agent-passport/` | Read-only lookups | git 0.2.0, npm 0.1.0 |
| web0-onboard | `plugins/web0-onboard/` | Identity and storefront config | git 0.2.0, npm 0.1.0 |
| Liquefy appliance | `api/`, `tools/` | Local Python | not on npm |

## Capability table

Columns: **Exists in source** is the implementation status and main path at the snapshot commit.
**Demonstrated** is what code or a recorded run shows. **Where it runs** names the network for anything
deployed. **Not established** lists what a reader should not infer.

<!-- claims-table:start (generated from evidence/claims.json; edit the registry, then run scripts/check-claims-registry.mjs --write) -->
| ID | Capability | Exists in source | Demonstrated | Where it runs | Not established |
|---|---|---|---|---|---|
| `x402-pay.capped-payments` | x402-pay pays x402 endpoints in USDC through the operator's own signer and refuses a seller amount above maxAmountUsdc before building a transaction. | implemented: `skills/x402-pay/src/client.ts` | mainnet payments refused unless allowMainnet=true; seller amount above maxAmountUsdc refused before a transaction is built; own payment confirmed at finalized commitment; README and SKILL.md state that the 5 bps fee leg is added on top of the capped seller amount (test: pass 2026-10-06) | local / off-chain; `@parad0x_labs/openclaw-x402-pay` git 2.0.1, npm 2.0.0 | a cap on the total debit: the fee leg can take it up to 0.05% above maxAmountUsdc; a mainnet payment in this review pass |
| `x402-gate.onchain-verification` | x402-gate verifies a USDC payment on-chain at finalized commitment before serving, with a durable replay store required on mainnet. | implemented: `skills/x402-gate/src/onchain.ts` | exactly one SPL Memo carrying the receipt hash required; recipient balance increase of at least the amount; 5 bps fee leg to the pinned treasury; signature and nonce consumed in a file-backed replay store (required on mainnet); payer ed25519 presenter authentication mandatory on mainnet (test: pass 2026-10-06) | local / off-chain; `@parad0x_labs/openclaw-x402-gate` git 2.0.1, npm 2.0.0 | a signed receipt: the receipt is an unsigned SHA-256 hash both sides can compute; on-chain anchoring or netting (neither is done by this skill) |
| `payment-session.metered-billing` | payment-session tracks metered and subscription charges for an agent session and suggests when to pay. | prototype: `plugins/payment-session/src/session.ts` | in-memory per-session accounting; check_settlement_due never suggests more than the remaining budget; record_settled refuses an amount above the remaining budget (test: pass 2026-10-06) | local / off-chain; `@parad0x_labs/openclaw-payment-session` git 0.1.1, npm 0.1.0 | enforcement of the session budget on pay_x402: pay_x402 pays the seller's quote, bounded only by x402-pay's maxAmountUsdc (README, SKILL.md and plugin description say so from 0.1.1); on-chain verification of settled amounts; persistence across restarts |
| `mcp-server.read-tools` | The MCP server exposes quote, receipt hashing, identity lookup, .null resolution and stack status tools without submitting transactions. | implemented: `skills/mcp-server/src/index.ts` | no sendTransaction or sendRawTransaction call in src/ (test: pass 2026-10-06) | local / off-chain; `@parad0x_labs/mcp-server` git 0.2.0, npm 0.2.0 | receipt anchoring (unavailable until a receipt_anchor deployment is configured) |
| `agent-passport.identity-lookup` | agent-passport resolves an agent's .null name and ETH to Solana wallet binding against the on-chain owner record. | implemented: `plugins/agent-passport/src/passport.ts` | read-only lookups; PROGRAMS lists only dark_secp256k1_auth; the closed mainnet receipt_anchor id and the RECEIPT_ANCHOR export are removed (Git 0.2.0) (test: pass 2026-10-06) | local / off-chain; `@parad0x_labs/openclaw-agent-passport` git 0.2.0, npm 0.1.0 | writes: .null write builders are unavailable until the registrar relaunch; a live lookup in this review pass |
| `liquefy.vault-compression` | Liquefy packs agent run folders into vaults with format-aware engines and keeps an archive only after a byte-exact round-trip check. | implemented: `api/orchestrator/orchestrator.py` | round-trip verification with fallback to plain zstd (MRTV); committed CI benchmark (benchmarks/latest_ci.csv, 2026-02-26): 114.7x versus zstd -19 45.3x on a repetitive JSON fixture; 5.86x (default) and 6.95x (ratio profile) versus 5.86x on VPC flow logs; docs/VAULT_APPLIANCE.md and docs/SKILLS_CATALOG.md now cite these numbers | local / off-chain | the earlier 103.9x versus 63.8x figure (no committed result file; no longer cited); near-parity on dense prose (1.02x versus 1.06x): from the same earlier pass, no committed result file; ratios on customer data |
| `liquefy.vault-encryption` | Liquefy vaults are encrypted with AES-256-GCM by default and packing stops when no secret is configured. | implemented: `api/liquefy_security.py` | AES-256-GCM with a PBKDF2-SHA256 per-tenant key (300k iterations) and the header as associated data; --no-encrypt is an explicit opt-out | local / off-chain | key rotation or escrow |
| `liquefy.vault-anchor` | A vault fingerprint can be posted to Solana as an SPL Memo so a third party can check that the vault existed. | implemented: `tools/liquefy_vault_anchor.py` | memo text LQFY\|<16 hex>\|<16 hex>\|<key fingerprint>: a 55-byte memo with 64-bit prefixes of the vault hash and chain tip; the module docstring and docs/VAULT_TOOLS.md now say so | local / off-chain | full 32-byte hashes on-chain (only 64-bit prefixes are posted); an anchor transaction in this review pass |
| `context-capsule.openclaw-skill` | The OpenClaw context-capsule skill replaces older turns with an extractive summary and keeps the most recent messages verbatim, locally and without network access. | implemented: `skills/context-capsule` | deterministic extractive capsule (up to 1,400 tokens by default) plus the last 10 messages verbatim; no model call; no network | local / off-chain; `@parad0x_labs/openclaw-context-capsule` git 1.7.1, npm 1.7.0 | retrieval of omitted details (the skill has none); end-to-end task token or cost savings |
<!-- claims-table:end -->

## What the payment skills do and do not do

- `x402-pay` caps the seller amount per payment; the 0.05% protocol fee is added on top of that cap.
- `x402-gate` verifies the transfer at finalized commitment, requires a memo with the receipt hash and the
  fee leg, and consumes each signature once. The receipt is a SHA-256 hash both sides can compute; it is not
  signed and is not anchored by this skill.
- No skill nets obligations or settles them on-chain. `payment-session` is bookkeeping: it trusts the
  amounts reported to it, caps only what it suggests and records, and does not limit what `pay_x402` pays.
- Receipt anchoring through `receipt_anchor` is not wired into these skills: none names a default program and `mcp-server`, `web0-onboard` and `agent-passport` refuse to anchor. A devnet `receipt_anchor` is available at `HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs` (2026-10-06, fresh key) for clients that take the program ID explicitly.

## Reproduce

```bash
git clone https://github.com/Parad0x-Labs/openclaw-skills && cd openclaw-skills
node scripts/check-claims-registry.mjs                       # registry and this table
cd skills/x402-gate && npm ci --ignore-scripts && npm test   # same for skills/* and plugins/*
cd ../.. && pip install -r requirements.txt pytest && pytest tests/
python benchmarks/run_ci_subset.py --out /tmp/latest_ci.csv --runs 3   # compare with benchmarks/latest_ci.csv
```

A green CI run shows the tests pass at a commit. It is not an external security review, and none is claimed.
