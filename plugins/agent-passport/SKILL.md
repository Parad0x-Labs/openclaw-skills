---
name: Agent Passport
description: On-chain identity for OpenClaw agents — .null name, ETH↔Solana binding, verifiable agent identity without touching private keys
tags: identity, solana, web0, null, reputation, passport
requires_openclaw: ">=2026.6.1"
license: MIT
metadata:
  author: Parad0x-Labs
---

# Agent Passport

Gives an OpenClaw agent a verifiable on-chain identity backed by the web0 stack
on Solana. The agent can prove who it is (or confirm who another agent is) without
ever holding or requesting private keys.

## What it does

- Reads `solanaWallet`, `ethAddress`, and `nullName` from plugin config
- Derives PDAs on the legacy mainnet identity program (`dark_secp256k1_auth`) and
  checks whether the binding accounts exist (read-only)
- Returns the agent's full identity record so it can be injected into conversation
  context, payment routing, or audit trails
- Can also verify a DIFFERENT agent's identity by their wallet or ETH address

## Tools exposed

### `get_agent_passport`

Returns this agent's on-chain identity record:

```json
{
  "null_name": "myagent.null",
  "solana_wallet": "...",
  "eth_address": "0x...",
  "eth_binding_pda": "...",
  "eth_binding_registered": true,
  "network": "solana-mainnet",
  "programs": {
    "dark_secp256k1_auth": "AqwBbV13AoczhoELwP8oxT3nDqB6MsLWXauNzHkssZ9B",
    "receipt_anchor": "6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN"
  },
  "program_status": {
    "dark_secp256k1_auth": "retired (mainnet) — existing ETH↔Solana bindings readable; ...",
    "receipt_anchor": "retired 2026-07-14 (mainnet) — historical anchors readable; ..."
  }
}
```

No parameters required — reads from plugin config.

### `verify_agent_identity`

Verifies a DIFFERENT agent's on-chain identity. Supply at least one of:
- `target_solana_wallet` — base58 Solana public key
- `target_eth_address` — hex ETH address
- `target_null_name` — .null name (passed through; this tool checks identity PDAs, not name resolution)

Returns whether the ETH binding and/or Solana wallet PDAs are registered on-chain.

## Trust model

- **Read-only.** Both tools only query on-chain account existence — no transactions,
  no signing, no private key access of any kind.
- **Public RPC only.** Uses `https://solana-rpc.publicnode.com` by default
  (never `api.mainnet-beta.solana.com`). Override with `rpcUrl` in config.
- **No secrets in config.** `solanaWallet` and `ethAddress` are public keys/addresses.
  Private keys belong in the host signer, not here.
- **PDA derivation is deterministic.** Seeds are the same ones the on-chain programs
  use — no external oracle needed.

## Current status

The ETH↔Solana binding program (`dark_secp256k1_auth`) is a retired mainnet program: its
accounts stay readable, so both tools verify **existing** bindings, but nothing can be
invoked and no new bindings can be created. This plugin has no write path. Every result
carries `program_status`. The WebAuthn vault lookup was removed in 0.2.0 because that
program is attacker-controlled.

`nullName` is surfaced from config as-is. To resolve a legacy `.null` name (read-only —
the mainnet registrar was retired 2026-08-29, records stay readable), use the
mcp-server `resolve_null` tool or x402-pay pay-by-name.
