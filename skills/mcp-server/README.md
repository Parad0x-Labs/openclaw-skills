# @parad0x_labs/mcp-server

Exposes the Parad0x Labs stack as MCP tools. Works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible agent runtime.

## Tools

| Tool | Description |
|---|---|
| `x402_get_quote` | Get a payment quote for an x402-gated API endpoint |
| `anchor_receipt` | Anchor a 32-byte receipt hash on Solana devnet via `receipt_anchor` (mainnet RPCs are refused — the mainnet program was retired 2026-07-14) |
| `lookup_passport` | Read whether an ETH address or Solana wallet has a Dark Passport binding on the legacy mainnet program (retired; existing bindings readable) |
| `build_outcome_receipt` | Build a signed outcome receipt with PnL, accuracy, or delivery result |
| `compress_receipts` | Compress a batch of receipts (zlib deflate; Liquefy-format demo — the production columnar codec targets ~83x) |
| `resolve_null` | Resolve a `.null` name (read-only) on the legacy mainnet registrar — records readable, registration/updates frozen |
| `get_stack_status` | Program addresses and their current status (devnet targets, retired mainnet programs, x402 settlement) |

## Install

```bash
npm install -g @parad0x_labs/mcp-server
```

Or use directly via `npx` without installing.

## Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "parad0x": {
      "command": "npx",
      "args": ["-y", "@parad0x_labs/mcp-server"],
      "env": {
        "SOLANA_RPC_URL": "https://solana-rpc.publicnode.com",
        "SOLANA_KEYPAIR": "[1,2,3,...]"
      }
    }
  }
}
```

`SOLANA_KEYPAIR` is a JSON array of 64 bytes (the standard Solana keypair format output by `solana-keygen`). Without it, `anchor_receipt` runs in dry-run mode and returns a mock transaction for format inspection. Real submission also needs `PARAD0X_MCP_ALLOW_WRITE=1` plus a per-call `confirm:true` (or `grant_write_consent`).

`SOLANA_RPC_URL` is used for mainnet reads (`lookup_passport`, `check_nullifier`). Anchoring uses its own devnet RPC (`PARAD0X_ANCHOR_RPC_URL`, default `https://api.devnet.solana.com`).

## Cursor / Windsurf config

Add to `.cursor/mcp.json` or `.windsurf/mcp.json` in your project root:

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

## Build from source

```bash
cd packages/mcp-server
npm install
npm run build
npm start
```

## Env vars

| Variable | Default | Description |
|---|---|---|
| `SOLANA_RPC_URL` | `https://solana-rpc.publicnode.com` | Solana mainnet RPC for read tools |
| `PARAD0X_ANCHOR_RPC_URL` | `https://api.devnet.solana.com` | Devnet RPC for `anchor_receipt` / `private_compute` anchoring (mainnet RPCs are refused) |
| `SOLANA_KEYPAIR` | _(unset)_ | JSON array of 64 bytes — enables real (devnet) anchor submission |
| `PARAD0X_MCP_ALLOW_WRITE` | _(unset)_ | Set to `1` to allow on-chain writes on this machine |

## Programs

| Program | Cluster | Address | Status |
|---|---|---|---|
| receipt_anchor | devnet | `CPQ8Y1bdRiadxLMhrQG14Atc3E5eNJhqwPX1nXtH1Mst` | Live — the `anchor_receipt` write target |
| receipt_anchor | mainnet | `6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN` | Retired 2026-07-14 — historical anchors readable, cannot be invoked |
| .null registrar | mainnet | `NXgQhepFpDCu935H1D4g34g59ZYbo1jR4tBCZWhV8Np` | Retired 2026-08-29 — records readable (`resolve_null`), registration/updates/transfers frozen |
| dark_secp256k1_auth | mainnet | `AqwBbV13AoczhoELwP8oxT3nDqB6MsLWXauNzHkssZ9B` | Retired — existing bindings readable (`lookup_passport`) |
| dark_secp256r1_vault | mainnet | `3hbbtjeSrTVYXq6eRwjeofDe2DCPh3n8cfN6kZcQfewi` | Retired — accounts readable |
| dark_semaphore | mainnet | `Ev7HEFhhKTXk6kS2Y6ssbUcK9C7E6yZ589jJNjUrQV5p` | Retired — accounts readable |
| null_token | mainnet | `8EeDdvCRmFAzVD4takkBrNNwkeUTUQh4MscRK5Fzpump` | SPL token mint |

`anchor_receipt` writes to devnet only. A mainnet RPC URL is refused up front, and
before anything is signed the server checks the RPC's genesis hash — a mainnet
genesis gets a clear "retired 2026-07-14" error and no transaction is sent.

The ZK stack (Dark NULL, the shielded x402 access gate, the reputation gate and
commitment tree) runs on devnet. x402 USDC payments are plain SPL transfers and are
unaffected by the retired programs — devnet by default, mainnet opt-in.
