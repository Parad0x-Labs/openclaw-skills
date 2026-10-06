---
name: parad0x-mcp-server
description: MCP server exposing the Parad0x Labs stack — x402 payment quotes, receipt hashing (no on-chain anchoring in this server; a devnet receipt_anchor is available for explicit use), read-only .null resolution and Dark Passport lookup, outcome receipts, receipt compression, and program status discovery. Runs over stdio, works with Claude Desktop and any MCP client.
license: MIT
metadata:
  author: Parad0x-Labs
---

# Parad0x Labs MCP Server

Exposes the Parad0x Labs web0 stack as MCP tools. Works with Claude Desktop,
Cursor, Windsurf, and any MCP-compatible agent runtime.

## When to use

- Your agent needs a payment quote for an x402-gated API call (paying is done by your
  own x402 client, e.g. `openclaw-x402-pay`).
- You want to compute receipt hashes locally (this server does not anchor on-chain).
- You need to resolve a legacy `.null` name or read an existing Dark Passport binding.
- You want to compress a batch of receipts or check program addresses and status.

## Tools

| Tool | Does |
|---|---|
| `x402_get_quote` | Get a payment quote for an x402-gated API endpoint |
| `anchor_receipt` | Validate a 32-byte receipt hash; refuses with "receipt anchoring is not done by this server and no default anchor program is configured", names the devnet `receipt_anchor` for explicit use, and sends nothing |
| `lookup_passport` | Read whether an ETH address or Solana wallet has a Dark Passport binding on the legacy mainnet program (retired; existing bindings readable) |
| `build_outcome_receipt` | Build a signed outcome receipt with PnL, accuracy, or delivery result |
| `compress_receipts` | Compress a batch of receipts (Liquefy format) |
| `resolve_null` | Resolve a `.null` name (read-only) on the legacy mainnet registrar |
| `check_nullifier` | Validate a privacy-proof nullifier; refuses with a clear error and makes no lookup (a devnet `dark_nullifier_record` runs at `CPMfXL73v9PDmxyPLTM97bzrNa5eg2AEpsac9XKzX9et`) |
| `private_compute` | Encrypt locally, send ciphertext to an executor, return input/result hashes; `anchor:true` computes the commitment locally and refuses the on-chain anchor |
| `get_stack_status` | Program addresses and their current status |
| `create_wallet` | Generate a new Solana keypair file on this machine (preview unless `confirm:true`); returns only the public key and path |
| `get_scope_status` / `grant_write_consent` / `revoke_write_consent` | Show and manage the per-session write consent for `anchor_receipt` and `private_compute` |

## Deployment status

- **This server does not anchor receipts.** `anchor_receipt` and `private_compute`
  anchoring refuse with a clear error and send nothing; hashes are still computed
  locally. A devnet `receipt_anchor` is available at `HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs`
  (2026-10-06, fresh key); pass it explicitly to a client that anchors. The mainnet `receipt_anchor`
  (`6HSRGivd…`) was retired 2026-07-14; historical mainnet anchors remain readable.
- **`.null` resolution is read-only.** The legacy mainnet registrar (`NXgQhepF…`) was
  retired 2026-08-29 — records resolve, registration/updates/transfers are frozen.
- **Dark Passport lookup is read-only** against the retired mainnet identity program;
  existing bindings stay readable.
- **x402 USDC payments** (plain SPL transfers) work on devnet by default and on
  mainnet when opted in.

## Install

```bash
npm install -g @parad0x_labs/mcp-server
```

Or use directly without installing:

```bash
npx @parad0x_labs/mcp-server
```

## Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "parad0x": {
      "command": "npx",
      "args": ["-y", "@parad0x_labs/mcp-server"],
      "env": {
        "SOLANA_RPC_URL": "https://solana-rpc.publicnode.com"
      }
    }
  }
}
```

## Source

github.com/Parad0x-Labs/openclaw-skills/tree/main/skills/mcp-server
