---
name: magicblock-archive
description: Archive MagicBlock Ephemeral Rollup session transaction logs — compresses ER sessions into Liquefy vaults and optionally folds a per-session commitment into the on-chain receipt_anchor accumulator on Solana devnet. Fills the MagicBlock auditability gap. x402 session playback pricing included.
license: MIT
metadata:
  author: Parad0x-Labs
---

# MagicBlock Archive

Compresses MagicBlock Ephemeral Rollup (ER) session logs into Liquefy vaults,
optionally folding a per-session commitment into the on-chain receipt_anchor
accumulator on Solana devnet (`CPQ8Y1bdRiadxLMhrQG14Atc3E5eNJhqwPX1nXtH1Mst`). Fills the
MagicBlock auditability gap by keeping a verifiable, tamper-evident record of every ER
session.

Anchoring is devnet-only. The mainnet receipt_anchor
(`6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN`) was retired 2026-07-14: pointing
`archive_session(anchor=True)` at a mainnet RPC raises `RetiredProgramError` before the
session is fetched or anything is written, and the RPC's genesis hash is checked before
the fee-payer key is loaded. Historical mainnet anchors remain readable. Set the devnet
RPC with `SOLANA_ANCHOR_RPC` or `solana_rpc_url=` (default `https://api.devnet.solana.com`).

x402 session playback pricing is included — charge per replay access.

## When to use

- Running MagicBlock Ephemeral Rollup sessions and need an audit trail
- Want on-chain proof of an ER session outcome without storing full logs on-chain
- Need x402-gated access to ER session history playback

## Tests

```bash
python3 -m unittest discover -s tests -v   # hermetic, stdlib only
```

## Source

github.com/Parad0x-Labs/openclaw-skills/tree/main/plugins/magicblock-archive
