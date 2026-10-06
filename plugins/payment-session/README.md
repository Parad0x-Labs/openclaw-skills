# @parad0x_labs/openclaw-payment-session

**Streaming + recurring billing for agents over x402.** Meter pay-as-you-go usage
or run a subscription, settle in **batches** through `pay_x402` (one tx per
settlement, not per tick), with a per-session budget that caps the amounts it
suggests. Non-custodial — it never moves money or holds a key.

```bash
npm i @parad0x_labs/openclaw-payment-session
```

> Requires OpenClaw **≥ 2026.6.1**.

## Why

x402 is discrete per-call. Per-second/per-use micropayments are uneconomical one
tx at a time (fees + ATA rent dwarf a sub-cent charge). This accrues charges and
settles them in batches — the practical way to bill streaming usage.

## Two shapes

- **metered** — `meter_usage` accrues; settle once accrued ≥ `settleAtUsdc`.
- **subscription** — charge `periodUsdc` every `periodSeconds`.

## Tools

`open_payment_session` · `meter_usage` · `check_settlement_due` · `record_settled` · `close_payment_session`

```
open_payment_session(payee="seller.null", mode="metered", settleAtUsdc=1, maxTotalUsdc=20)
→ meter_usage(usdc=0.3) … → check_settlement_due → { due:true, amount_usdc }
→ pay_x402("seller.null")  (x402-pay)            → record_settled(amount_usdc)
```

## Trust model

- **Non-custodial** — accounting only; settlement is `pay_x402` (your wallet signs).
- **Budget-capped accounting, not spend enforcement.** Every session has a `maxTotalUsdc`
  budget: `check_settlement_due` never suggests more than the remaining budget, and
  `record_settled` refuses to record more. The session does not control `pay_x402`, which
  pays the seller's quoted amount: a payment can exceed the suggested amount and the
  session budget. Per-payment spend is bounded by x402-pay's `maxAmountUsdc` (the 5 bps
  protocol fee is added on top of that cap). State is in memory and is lost on restart.

Pairs with `x402-pay` (settlement), `x402-gate` (the selling side), and
`web0-onboard` (identity + endpoint). MIT licensed.
