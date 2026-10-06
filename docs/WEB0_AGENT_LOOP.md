# The Web0 agent loop — get paid, and pay, in USDC on Solana

The point of this stack in one walkthrough: your OpenClaw agent **charges other
agents for its work and pays for theirs, in USDC on Solana (public beta; devnet by
default, mainnet-beta opt-in) — non-custodial at every step**. You bring one Solana keypair you control; the skills never hold a
key.

| Step | Tool | Where |
|---|---|---|
| 1. Pay other agents / paid APIs | [`x402-pay`](../skills/x402-pay) | Solana mainnet-beta |
| 2. Charge for your agent's work | [`x402-gate`](../skills/x402-gate) | Solana mainnet-beta |
| 3. Keep verifiable receipts | x402-gate + x402-pay receipt hashes | local; a devnet `receipt_anchor` is available for explicit anchoring |
| 4. Keep long sessions cheap | [`context-capsule`](../skills/context-capsule) | npm |

---

## 1 · Pay other agents and paid APIs

[`x402-pay`](../skills/x402-pay) gives your agent one tool — `pay_x402(url)`. It
fetches a URL; on HTTP 402 it pays the demanded USDC on Solana and returns the
resource. Bring your own signer (the skill builds an unsigned tx, your wallet
signs) with a hard per-payment USDC cap. Real-money mainnet is **opt-in and off by
default** — set `allowMainnet: true` plus an explicit `rpcUrl` to enable it; the
network for each payment comes from the 402 challenge.

## 2 · Charge for your agent's work

[`x402-gate`](../skills/x402-gate) turns any skill or API into a paid endpoint:
mint a 402 challenge, verify the payment, then serve. With `requireOnChain: true`
you serve only after the transaction settles on-chain. Funds land directly in
your own wallet — the skill holds no keys. The paying and charging sides derive
identical receipt hashes, so the loop reconciles with no shared state.

## 3 · Keep verifiable receipts

The paying and charging sides derive identical 32-byte receipt hashes for every
sale, so each party holds a matching record with no shared state. Anchoring those
hashes on-chain is not wired into these skills: `anchor_receipt` in `mcp-server`
returns a refusal and sends nothing. A devnet `receipt_anchor` is available at
`HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs` (2026-10-06, fresh key); pass it explicitly to a client
that anchors, such as dna-x402 `receipt-dag`.
The mainnet deployment (`6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN`) anchored
receipts June–July 2026 and is retired; those historical anchors remain readable.

## 4 · Keep long sessions cheap

A paid agent runs long conversations. [`context-capsule`](../skills/context-capsule)
(`npm i @parad0x_labs/openclaw-context-capsule`) compresses old history before
each model call — keeping decisions, errors, IDs, and values while cutting tokens.
On the public fixture it sends 2,061 instead of 7,281 tokens per call; the
capsule is lossy, so see [the benchmark](CONTEXT_CAPSULE_BENCHMARK.md) for what
survives.

---

## Your `.null` identity

Your agent can own a `.null` name on Solana that doubles as its identity and its
on-chain payment address. The naming layer — registrar and auctions — ran on
**Solana mainnet-beta** June–August 2026 (registrar `NXgQhepF…`) and is retired: existing
names still resolve read-only, but names cannot currently be registered, updated or
transferred. Each name's record stores its x402 endpoint on-chain, so:

```
pay_x402("myagent.null")   →  resolve the record → read its x402 endpoint → pay
```

`x402-pay` accepts a `.null` name directly (it resolves, then pays the published
endpoint), and `mcp-server`'s `resolve_null` reads any name's owner + endpoint +
stealth meta. Recipient-private pay-by-name (payment to a one-time stealth address)
runs on devnet under a fresh key since 2026-10-06 through the dna-x402 NullPay client
(`null_registrar` `3RhyFd57nP7R1HysZC14M9xs9T6e1cJNrqBTAFnaF9mZ`, a different instruction set
from the web0 registrar). On the retired mainnet registrar, registering names and publishing
endpoints (`UPDATE_ENDPOINT`) stay frozen; `web0-onboard`'s write builders refuse it, refuse the
devnet NullPay registrar, and build only against a registrar with the web0 instruction set set
in config.

## Notes

- **Non-custodial throughout.** Every skill builds transactions your own wallet
  signs; none holds a key. Spend is capped on the paying side and settles to your
  own wallet on the charging side.
- **Reach.** Agents resolve and transact on-chain directly; `.null` resolution reads
  the legacy mainnet records, which stay readable.
- **Amounts.** USDC amounts are exact; any storage-cost figures are quoted at
  upload time by the bundler.
