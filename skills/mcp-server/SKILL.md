---
name: parad0x-mcp-server
description: MCP server exposing the Parad0x Labs stack — x402 payment quotes, on-chain receipt anchoring on Solana devnet, read-only .null resolution and Dark Passport lookup, outcome receipts, receipt compression, and program status discovery. Runs over stdio, works with Claude Desktop and any MCP client.
license: MIT
metadata:
  author: Parad0x-Labs
---

# Parad0x Labs MCP Server

Exposes the Parad0x Labs web0 stack as MCP tools. Works with Claude Desktop,
Cursor, Windsurf, and any MCP-compatible agent runtime.

## When to use

- Your agent needs to quote, pay, or verify an x402-gated API call.
- You want to anchor a receipt hash on Solana devnet.
- You need to resolve a legacy `.null` name or read an existing Dark Passport binding.
- You want to compress a batch of receipts or check program addresses and status.

## Tools

| Tool | Does |
|---|---|
| `x402_get_quote` | Get a payment quote for an x402-gated API endpoint |
| `anchor_receipt` | Anchor a 32-byte receipt hash on Solana devnet via `receipt_anchor` (`CPQ8Y1bd…`) |
| `lookup_passport` | Read whether an ETH address or Solana wallet has a Dark Passport binding on the legacy mainnet program (retired; existing bindings readable) |
| `build_outcome_receipt` | Build a signed outcome receipt with PnL, accuracy, or delivery result |
| `compress_receipts` | Compress a batch of receipts (Liquefy format) |
| `resolve_null` | Resolve a `.null` name (read-only) on the legacy mainnet registrar |
| `get_stack_status` | Program addresses and their current status |

## Deployment status

- **Receipt anchoring runs on devnet** (`CPQ8Y1bdRiadxLMhrQG14Atc3E5eNJhqwPX1nXtH1Mst`).
  The mainnet `receipt_anchor` (`6HSRGivd…`) was retired 2026-07-14: `anchor_receipt`
  refuses mainnet RPCs with a clear error; historical mainnet anchors remain readable.
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
