# @parad0x_labs/openclaw-web0-onboard

**One call sets your agent up on web0** — identity, a paid x402 storefront, the
receipt-anchoring status, and the `.null` name status. Sell services for USDC on Solana; funds
settle to **your** wallet. Read-only, non-custodial.

```bash
npm i @parad0x_labs/openclaw-web0-onboard
```

> Requires OpenClaw **≥ 2026.6.1**. Never signs, never holds a key.

## The one tool

```js
web0_onboard({
  name: "myagent",                       // optional .null name
  solanaWallet: "<your base58 wallet>",  // payout wallet
  services: [
    { name: "summarize", priceUsdc: 0.02, description: "Summarize a URL" },
    { name: "translate", priceUsdc: 0.05 }
  ],
  network: "solana-mainnet"
})
```

Returns a consolidated, validated setup:

| Section | What you get |
|---|---|
| `identity` | your on-chain identity PDA + whether it's bound |
| `storefront` | drop-in `x402-gate` config (recipient = your wallet, per-service prices) |
| `receipts` | receipt-hash guidance; the plugin names no anchor program and does not anchor (the mainnet anchor `6HSRGivd…` was retired 2026-07-14). A devnet `receipt_anchor` is available at `HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs`; pass it explicitly to a client that anchors |
| `name` | your `.null` label, validated, plus its status: registration frozen, existing names resolve read-only |
| `next_steps` / `summary` | an ordered, human-readable setup checklist |

## `.null` names — mainnet registrar retired 2026-08-29

The mainnet `.null` registrar (`NXgQhepF…`) was retired on 2026-08-29. Its accounts
persist, so **existing names still resolve read-only** — `pay_x402("name.null")` keeps
working for names that already publish an endpoint. Registration, endpoint updates,
stealth-meta updates and transfers are **frozen on mainnet**.

The seller tools below carry the verified registrar ABI. Against the default (retired
mainnet) registrar each one refuses up front — dry runs included — with that message.
They build transactions only when `registrar` in the plugin config names a different
deployed registrar with the same instruction set (and a matching `rpcUrl`). The devnet
`null_registrar` `3RhyFd57nP7R1HysZC14M9xs9T6e1cJNrqBTAFnaF9mZ` is the dna-x402 NullPay
registrar, a different instruction set: these tools refuse it. The host registers a
signer via `setWeb0Signer(wallet)`; your wallet signs every tx — the plugin never
holds a key. Each tool takes `dryRun: true` to preview without signing.

| Tool | Does (on a configured, deployed registrar) |
|---|---|
| `register_null_name({ name })` | register a `.null` name (reads the registrar's fee + treasury) |
| `set_null_endpoint({ name, endpoint })` | publish your x402 endpoint on the name (`UPDATE_ENDPOINT`) |
| `set_null_stealth_meta({ name, stealth_meta_hex })` | publish a stealth address for recipient-private pay-by-name |

Recipient-private pay-by-name to a one-time stealth address runs on devnet under a fresh
key since 2026-10-06 through the dna-x402 NullPay client and its `null_registrar`
`3RhyFd57nP7R1HysZC14M9xs9T6e1cJNrqBTAFnaF9mZ`, not through these tools.

## How it fits

```
seller: web0_onboard(...) → enable x402-gate with storefront.x402_gate_config
buyer:  pay_x402(<your x402-gate URL>)  → quote → pay USDC → receipt hash
        pay_x402("legacy.null")         → read-only resolve of an existing name → same flow
```

x402 USDC payment (`x402-gate` / `x402-pay` SPL transfers) runs on mainnet (opt-in)
and devnet. This plugin does not anchor receipts; a devnet `receipt_anchor` is available at
`HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs` (2026-10-06, fresh key) for clients that take the program ID explicitly.

## Trust model

- **Non-custodial.** Planning (`web0_onboard`) is read-only. The seller tools build
  an UNSIGNED transaction for your wallet to sign — the plugin never holds, requests,
  or reads a key, and never moves funds itself. Every write tool has `dryRun`.
- **Owner-gated** — endpoint/stealth writes require you to be the name's on-chain
  owner (checked before submit).
- **Public RPC only** (`solana-rpc.publicnode.com`) by default. Name reads default
  to `NXgQhepF…` (never the seized pre-incident id); writes to it are refused.

Pairs with `x402-gate`, `x402-pay`, and `agent-passport`. MIT licensed.
