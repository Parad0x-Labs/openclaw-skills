# @parad0x_labs/mcp-server

Exposes the Parad0x Labs stack as MCP tools. Works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible agent runtime.

Version 0.2.0 replaces the withdrawn 0.1.x releases. It uses no program ID controlled
by a compromised key: receipt anchoring and nullifier lookups refuse with a clear
error, and no tool submits an on-chain transaction. Both programs now run on devnet
under a fresh key (2026-10-06; see [Programs](#programs)); this release does not call them.

## Tools

| Tool | Description |
|---|---|
| `x402_get_quote` | Get a payment quote for an x402-gated API endpoint |
| `anchor_receipt` | Validate a 32-byte receipt hash for `receipt_anchor`. This server does not anchor: the tool returns a clear refusal and sends nothing |
| `lookup_passport` | Read whether an ETH address or Solana wallet has a Dark Passport binding on the legacy mainnet program (retired; existing bindings readable) |
| `build_outcome_receipt` | Build a signed outcome receipt with PnL, accuracy, or delivery result |
| `compress_receipts` | Compress a batch of receipts (zlib deflate; Liquefy-format demo — the production columnar codec targets ~83x) |
| `resolve_null` | Resolve a `.null` name (read-only) on the legacy mainnet registrar — records readable, registration/updates frozen |
| `check_nullifier` | Validate a privacy-proof nullifier; the lookup is unavailable until the nullifier record program is redeployed under a fresh key |
| `private_compute` | Encrypt locally, send ciphertext to an executor, return input/result hashes; `anchor:true` computes the commitment locally (this server does not anchor on-chain) |
| `get_stack_status` | Program addresses and their current status (retired mainnet programs, services awaiting redeploy, x402 settlement) |
| `create_wallet` | Generate a new Solana keypair file on this machine (preview unless `confirm:true`); returns only the public key and path, never the secret |
| `get_scope_status` / `grant_write_consent` / `revoke_write_consent` | Show and manage the per-session write consent for `anchor_receipt` and `private_compute` |

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
        "SOLANA_RPC_URL": "https://solana-rpc.publicnode.com"
      }
    }
  }
}
```

`SOLANA_RPC_URL` is used for mainnet reads (`lookup_passport`, `resolve_null`). No tool submits a transaction; `SOLANA_KEYPAIR` is not needed.

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
cd skills/mcp-server
npm ci --ignore-scripts
npm run build
npm start
```

## Env vars

| Variable | Default | Description |
|---|---|---|
| `SOLANA_RPC_URL` | `https://solana-rpc.publicnode.com` | Solana mainnet RPC for read tools |
| `PARAD0X_MCP_ALLOW_WRITE` | _(unset)_ | Set to `1` to allow on-chain writes on this machine (none are currently available) |

## Programs

| Program | Cluster | Address | Status |
|---|---|---|---|
| receipt_anchor | mainnet | `6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN` | Retired 2026-07-14 — historical anchors readable, cannot be invoked |
| receipt_anchor | devnet | `HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs` | Devnet, fresh key (2026-10-06). Not called by this server; pass it explicitly to a client that anchors |
| dark_nullifier_record | devnet | `CPMfXL73v9PDmxyPLTM97bzrNa5eg2AEpsac9XKzX9et` | Devnet, fresh key (2026-10-06). Not called by this server |
| .null registrar | mainnet | `NXgQhepFpDCu935H1D4g34g59ZYbo1jR4tBCZWhV8Np` | Retired 2026-08-29 — records readable (`resolve_null`), registration/updates/transfers frozen |
| dark_secp256k1_auth | mainnet | `AqwBbV13AoczhoELwP8oxT3nDqB6MsLWXauNzHkssZ9B` | Retired — existing bindings readable (`lookup_passport`) |
| dark_semaphore | mainnet | `Ev7HEFhhKTXk6kS2Y6ssbUcK9C7E6yZ589jJNjUrQV5p` | Retired — accounts readable |
| null_token | mainnet | `8EeDdvCRmFAzVD4takkBrNNwkeUTUQh4MscRK5Fzpump` | SPL token mint |

This server does not anchor. `anchor_receipt` and `private_compute` (`anchor:true`)
compute hashes locally and return a clear refusal; nothing is signed or sent.
`check_nullifier` refuses the same way. A devnet `receipt_anchor` is available at
`HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs`; pass it explicitly to a client that anchors (for example
dna-x402 `receipt-dag`). The refusal text predates the 2026-10-06 devnet redeploy.

Canonical Dark NULL runs on devnet. x402 USDC payments are plain SPL transfers and are
unaffected by the retired programs — devnet by default, mainnet opt-in.
