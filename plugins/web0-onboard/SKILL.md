---
name: web0-onboard
description: web0 setup for an OpenClaw agent — plan your identity + paid x402 storefront and receipt anchoring, and get your .null name status (mainnet registrar retired 2026-08-29; existing names resolve read-only, registration frozen until relaunch). Sell services for USDC on Solana. Non-custodial (your wallet signs).
tags: web0, null, x402, solana, monetization, agents, openclaw
requires_openclaw: ">=2026.6.1"
license: MIT
metadata:
  author: Parad0x-Labs
---

# web0 Onboard

Set up an agent on web0 in **one call**. Tell it your payout wallet, the services
you want to sell, and (optionally) a `.null` name — it returns a complete,
validated setup your agent can act on immediately.

## What it does

`web0_onboard({ name, solanaWallet, services, network })` returns:

- **Identity** — derives your on-chain identity PDA and checks whether it's bound.
- **Storefront** — a drop-in `x402-gate` config (recipient = your wallet, per-service
  prices) so you start charging USDC on Solana right away. Funds settle to **your**
  wallet; the plugin never holds a key.
- **Receipts** — network-aware: on devnet, the `receipt_anchor` program
  `CPQ8Y1bd…`; on mainnet, a note that the mainnet anchor program (`6HSRGivd…`)
  was retired 2026-07-14 and anchoring runs on devnet. x402-gate and x402-pay
  derive matching receipt hashes for every sale.
- **Name status** — if you pass a `name`, it is validated and returned with its
  status: the mainnet registrar is retired, existing names resolve read-only, and
  registration is frozen until the relaunch. No name is needed to sell.

## Seller-side tools — frozen on mainnet

The mainnet `.null` registrar (`NXgQhepF…`) was retired on 2026-08-29. Existing
names resolve read-only; registration, endpoint updates, stealth-meta updates and
transfers are frozen until the relaunch. Against the default (retired) registrar
every tool below refuses — dry runs included — and says so. They build transactions
only when the plugin config sets `registrar` to a different deployed registrar
(e.g. devnet, with a matching `rpcUrl`). Your wallet signs (registered by the host
via `setWeb0Signer(signer)`); every tool takes `dryRun: true`.

- **`register_null_name({ name })`** — register a `.null` name on the configured
  registrar (reads its fee + treasury).
- **`set_null_endpoint({ name, endpoint })`** — publish your x402 endpoint on the
  name (`UPDATE_ENDPOINT`). Owner-only, tiny tx fee.
- **`set_null_stealth_meta({ name, stealth_meta_hex })`** — publish a NullPay
  stealth address for recipient-private pay-by-name (demonstrated end to end on
  devnet).

## The loop it sets up

```
seller: web0_onboard(...) → enable x402-gate with the returned config
buyer:  pay_x402(<your x402-gate URL>)  → quote → pay USDC → receipt hash
        pay_x402("legacy.null")         → read-only resolve of an existing name → same flow
```

## Trust model

- **Non-custodial.** Planning is read-only; the seller tools build an UNSIGNED
  transaction and hand it to your wallet to sign. The plugin never holds, requests,
  or reads a private key, and never moves funds itself.
- **Owner-gated writes.** `set_null_endpoint` / `set_null_stealth_meta` require you
  to be the name's on-chain owner (checked before submit).
- **Public RPC only** — `solana-rpc.publicnode.com` by default. No seized program
  IDs (name reads default to `NXgQhepF…`; writes to it are refused).

## Status

- x402 USDC payment (`x402-gate` / `x402-pay` SPL transfers): mainnet (opt-in) and devnet.
- Receipt anchoring: devnet, `receipt_anchor` `CPQ8Y1bdRiadxLMhrQG14Atc3E5eNJhqwPX1nXtH1Mst`.
  The mainnet program `6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN` was retired 2026-07-14.
- `.null` names: the mainnet registrar `NXgQhepFpDCu935H1D4g34g59ZYbo1jR4tBCZWhV8Np`
  was retired 2026-08-29. Existing names resolve read-only; writes are frozen until
  the registrar relaunch. Recipient-private pay-by-name was demonstrated end to end
  on devnet.

## Config (all optional defaults)

```jsonc
{
  "plugins": {
    "entries": {
      "web0-onboard": {
        "solanaWallet": "<your base58 wallet>",
        "name": "myagent",
        "network": "solana-mainnet",
        // optional: a deployed registrar for the name write tools (unset = retired mainnet → refused)
        // "registrar": "<registrar program id>", "rpcUrl": "<matching RPC>"
      }
    }
  }
}
```

Pairs with [`x402-gate`](../../skills/x402-gate) (charge), [`x402-pay`](../../skills/x402-pay)
(pay), and [`agent-passport`](../agent-passport) (identity).
