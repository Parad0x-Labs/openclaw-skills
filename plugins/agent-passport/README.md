# @parad0x_labs/openclaw-agent-passport

On-chain identity for OpenClaw agents — a `.null` name, ETH↔Solana binding, and
verifiable agent identity, **without ever touching a private key**.

Give your agent a passport it can present (and check on others) so payments,
reputation, and audit trails all bind to one verifiable on-chain identity.

```bash
npm i @parad0x_labs/openclaw-agent-passport
```

> Requires OpenClaw **≥ 2026.6.1**. Read-only. Public RPC only.

## Two tools

| Tool | Does |
|---|---|
| `get_agent_passport` | Returns **this** agent's identity record: `.null` name, Solana wallet, ETH address, the derived identity PDAs, and whether each binding account exists on-chain. |
| `verify_agent_identity` | Verifies a **different** agent's identity by `target_solana_wallet`, `target_eth_address`, or `target_null_name`. Returns which bindings are registered on-chain. |

## Config

```jsonc
{
  "solanaWallet": "<base58 public key>",   // this agent's wallet
  "ethAddress": "0x…",                      // optional ETH binding
  "nullName": "myagent.null",               // optional display/routing name
  "rpcUrl": "https://…"                     // optional; defaults to publicnode
}
```

All config values are **public** keys/addresses. Private keys belong in the host
signer, never here.

## Trust model

- **Read-only** — both tools only query on-chain account existence. No
  transactions, no signing, no private-key access.
- **Public RPC only** — `https://solana-rpc.publicnode.com` by default (never
  `api.mainnet-beta.solana.com`, which 403s with an Origin header).
- **No seized program IDs** — reads only the legacy `dark_secp256k1_auth` and
  `dark_secp256r1_vault` programs; PDA derivation is deterministic from the
  on-chain seeds.

## Status

The ETH↔Solana binding program and the WebAuthn P-256 vault (`dark_secp256r1_vault`)
are retired mainnet programs: existing bindings stay readable and both tools verify
them, but no new bindings can be created. Every result carries `program_status`.
`nullName` is surfaced from config as-is; legacy `.null` names resolve read-only via
the mcp-server `resolve_null` tool or x402-pay pay-by-name.

See [SKILL.md](./SKILL.md) for the full tool reference. MIT licensed.
