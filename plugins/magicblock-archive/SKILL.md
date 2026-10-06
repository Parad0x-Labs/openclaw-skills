---
name: magicblock-archive
description: Archive MagicBlock Ephemeral Rollup session transaction logs — compresses ER sessions into Liquefy vaults and computes a per-session commitment for the receipt_anchor accumulator (on-chain anchoring is unavailable until the redeploy under a fresh key). Fills the MagicBlock auditability gap. x402 session playback pricing included.
license: MIT
metadata:
  author: Parad0x-Labs
---

# MagicBlock Archive

Compresses MagicBlock Ephemeral Rollup (ER) session logs into Liquefy vaults and
computes a per-session 32-byte commitment (`session_commitment`) for the receipt_anchor
accumulator. Fills the MagicBlock auditability gap by keeping a verifiable,
tamper-evident record of every ER session.

Receipt anchoring is unavailable until the redeploy under a fresh key:
`archive_session(anchor=True)` raises `ReceiptAnchorUnavailableError` before the
session is fetched or anything is written. Archive with `anchor=False`; the result
carries the `session_commitment` hex, ready to anchor after the redeploy. The mainnet
receipt_anchor (`6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN`) was retired 2026-07-14;
its historical anchors remain readable.

x402 session playback pricing is included — charge per replay access.

## When to use

- Running MagicBlock Ephemeral Rollup sessions and need an audit trail
- Want a reproducible 32-byte commitment of an ER session outcome without storing full logs
- Need x402-gated access to ER session history playback

## Tests

```bash
python3 -m unittest discover -s tests -v   # hermetic, stdlib only
```

## Source

github.com/Parad0x-Labs/openclaw-skills/tree/main/plugins/magicblock-archive
