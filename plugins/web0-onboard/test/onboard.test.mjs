/**
 * Unit tests for the host-free onboard core (../dist/onboard.js).
 *
 * Hermetic — no live RPC. Covers input validation, .null label rules, PDA
 * derivation, plan assembly, the live constants, and the tool factory. Run
 * after `npm run build` (the test script builds first).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

import {
  DARK_SECP256K1_AUTH,
  RECEIPT_ANCHORING_UNAVAILABLE,
  RECEIPT_ANCHOR_MAINNET_RETIRED,
  NULL_REGISTRAR_MAINNET,
  USDC_MINT,
  DEFAULT_RPC,
  MAX_SERVICE_PRICE_USDC,
  readConfig,
  buildReceiptsBlock,
  normalizeName,
  isValidNullLabel,
  suggestNullLabel,
  isValidWallet,
  isValidPrice,
  validateOnboardInput,
  derivePassportPda,
  buildOnboardPlan,
  buildOnboardTools,
} from "../dist/onboard.js";
import * as onboard from "../dist/onboard.js";

// SHA-256 of compromised program IDs this repo once referenced (held hashed, never named),
// including the gen-1 x402 access gate and the secp256r1 vault.
const COMPROMISED_SHA256 = new Set([
  "d8406486dd119717648b5b6e6f4b8b9a044536b3ab95c34da437add15c5cac36",
  "efa8237fa114259344b44de2f79c21583ec464ffe5186876c35595bbd11983a1",
  "a7656054f294394e546b39f90c03a0cb31446ac46c37285f5bfc900b3bcea827",
  "35a832bc1dff671d6a806d63ea404ed181ed9675c49d513889e4a3aabda68423",
  "7abaeaa69c452dd5349bbde0858b343984fdef2e1bf32359248915b777c535bc",
  "0a81ba274124ff3e0e1ccc8751aaf0502e64ae7cd7ca1c01b2ac2307e0fe7888",
  "b851c1d6562bf9e70e2033a2db83d21fc5b249eab440a751d5638b285a4596c0",
  "a47c1fce4236ba82d1b46be7c5f1a88e7cb8e884a505b4166f1787b25f0ff7d2",
]);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
/** Every base58-looking token in a value, for the "names no compromised ID" checks. */
const base58Tokens = (v) => JSON.stringify(v).match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? [];
const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SERVICES = [{ name: "summarize", priceUsdc: 0.02 }, { name: "translate", priceUsdc: 0.05 }];

// ── constants ─────────────────────────────────────────────────────────────────

test("no seized or compromised program ID is referenced; RPC is publicnode", () => {
  for (const id of [DARK_SECP256K1_AUTH, RECEIPT_ANCHOR_MAINNET_RETIRED, NULL_REGISTRAR_MAINNET]) {
    assert.ok(!COMPROMISED_SHA256.has(sha256(id)), `${id} is seized`);
  }
  for (const v of Object.values(onboard)) {
    if (typeof v !== "string" && (typeof v !== "object" || v === null)) continue;
    for (const t of base58Tokens(v)) assert.ok(!COMPROMISED_SHA256.has(sha256(t)), "exports name a compromised ID");
  }
  assert.equal(DEFAULT_RPC, "https://solana-rpc.publicnode.com");
  assert.doesNotMatch(DEFAULT_RPC, /api\.mainnet-beta\.solana\.com/);
  assert.equal(USDC_MINT["solana-mainnet"], "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
});

test("no active receipt anchor is exported; this plugin does not anchor", () => {
  assert.equal(onboard.RECEIPT_ANCHOR, undefined);
  assert.equal(onboard.RECEIPT_ANCHOR_DEVNET, undefined);
  assert.equal(RECEIPT_ANCHORING_UNAVAILABLE, "receipt anchoring is not done by this plugin and no anchor program is configured");
  assert.equal(RECEIPT_ANCHOR_MAINNET_RETIRED, "6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN");
  assert.equal(NULL_REGISTRAR_MAINNET, "NXgQhepFpDCu935H1D4g34g59ZYbo1jR4tBCZWhV8Np");
});

// ── .null label rules ─────────────────────────────────────────────────────────

test("isValidNullLabel accepts good labels and strips the suffix", () => {
  assert.ok(isValidNullLabel("myagent"));
  assert.ok(isValidNullLabel("my-agent-7"));
  assert.ok(isValidNullLabel("myagent.null")); // suffix stripped
  assert.equal(normalizeName("MyAgent.null"), "myagent");
});

test("isValidNullLabel rejects bad labels", () => {
  assert.ok(!isValidNullLabel("ab")); // too short
  assert.ok(!isValidNullLabel("-bad"));
  assert.ok(!isValidNullLabel("bad-"));
  assert.ok(!isValidNullLabel("a--b")); // double hyphen
  assert.ok(!isValidNullLabel("bad name")); // space
  assert.ok(!isValidNullLabel("x".repeat(64))); // too long
});

// ── primitive validators ──────────────────────────────────────────────────────

test("isValidWallet / isValidPrice", () => {
  assert.ok(isValidWallet(WALLET));
  assert.ok(!isValidWallet("not-a-key"));
  assert.ok(isValidPrice(0.01));
  assert.ok(!isValidPrice(0));
  assert.ok(!isValidPrice(-1));
  assert.ok(!isValidPrice(MAX_SERVICE_PRICE_USDC + 1));
  assert.ok(!isValidPrice("0.01"));
});

// ── input validation ───────────────────────────────────────────────────────────

test("validateOnboardInput: requires wallet + at least one service", () => {
  const r = validateOnboardInput({}, { services: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /solanaWallet is required/.test(e)));
  assert.ok(r.errors.some((e) => /at least one service/.test(e)));
});

test("validateOnboardInput: rejects bad price + bad name, defaults network", () => {
  const r = validateOnboardInput(
    {},
    { solanaWallet: WALLET, name: "-bad", services: [{ name: "x", priceUsdc: 0 }] },
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /not a valid .null label/.test(e)));
  assert.ok(r.errors.some((e) => /priceUsdc > 0/.test(e)));
  assert.equal(r.network, "solana-mainnet");
});

test("validateOnboardInput: clean input passes + normalizes name", () => {
  const r = validateOnboardInput({}, { solanaWallet: WALLET, name: "MyAgent.null", services: SERVICES });
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.name, "myagent");
  assert.equal(r.wallet, WALLET);
});

test("config defaults feed validation (wallet + network from config)", () => {
  const r = validateOnboardInput(readConfig({ solanaWallet: WALLET, network: "solana-devnet" }), {
    services: SERVICES,
  });
  assert.equal(r.ok, true);
  assert.equal(r.network, "solana-devnet");
});

test("readConfig carries an explicit registrar (for the write tools) and ignores non-strings", () => {
  assert.equal(readConfig({ registrar: "SomeRegistrar111" }).registrar, "SomeRegistrar111");
  assert.equal(readConfig({ registrar: 5 }).registrar, undefined);
  assert.equal(readConfig({}).registrar, undefined);
});

// ── PDA derivation ──────────────────────────────────────────────────────────────

test("derivePassportPda: deterministic, correct program, null on bad wallet", () => {
  const a = derivePassportPda(WALLET);
  assert.ok(a);
  assert.equal(a, derivePassportPda(WALLET));
  const [expected] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol_agent"), new PublicKey(WALLET).toBytes()],
    new PublicKey(DARK_SECP256K1_AUTH),
  );
  assert.equal(a, expected.toBase58());
  assert.equal(derivePassportPda("nope"), null);
});

// ── plan assembly ───────────────────────────────────────────────────────────────

test("buildOnboardPlan: full plan with name reserved + cheapest gate price", () => {
  const validation = validateOnboardInput({}, { solanaWallet: WALLET, name: "myagent", services: SERVICES });
  const plan = buildOnboardPlan({ validation, identityRegistered: false });
  assert.equal(plan.ok, true);
  assert.equal(plan.identity.solana_wallet, WALLET);
  assert.equal(plan.identity.registered, false);
  assert.equal(plan.storefront.recipient, WALLET);
  assert.equal(plan.storefront.x402_gate_config.recipientAddress, WALLET);
  assert.equal(plan.storefront.x402_gate_config.priceUsdc, 0.02); // cheapest of 0.02 / 0.05
  assert.equal(plan.name.requested, "myagent.null");
  assert.match(plan.name.pay_by_name_preview, /pay_x402\("myagent\.null"\)/);
  assert.equal(plan.receipts.program, null);
  assert.equal(plan.receipts.anchoring, "unavailable");
});

test("buildOnboardPlan: no name → name section is null", () => {
  const validation = validateOnboardInput({}, { solanaWallet: WALLET, services: SERVICES });
  const plan = buildOnboardPlan({ validation, identityRegistered: true });
  assert.equal(plan.name, null);
  assert.equal(plan.identity.registered, true);
});

test("suggestNullLabel: service slug, wallet fallback, null when nothing valid", () => {
  assert.equal(suggestNullLabel([{ name: "Summarize", priceUsdc: 1 }]), "summarize");
  assert.ok(suggestNullLabel([{ name: "x", priceUsdc: 1 }], WALLET)?.startsWith("agent-")); // 1-char slug skipped → wallet handle
  assert.equal(suggestNullLabel([{ name: "x", priceUsdc: 1 }]), null); // too short + no wallet
});

test("buildOnboardPlan: name is validated but registration is frozen; storefront leads the checklist", () => {
  const withName = buildOnboardPlan({
    validation: validateOnboardInput({}, { solanaWallet: WALLET, name: "myagent", services: SERVICES }),
    identityRegistered: false,
  });
  assert.match(withName.next_steps[0], /x402-gate/);
  assert.equal(withName.name.requested, "myagent.null");
  assert.equal(withName.name.registration, "frozen");
  assert.equal(withName.name.registrar, NULL_REGISTRAR_MAINNET);
  assert.match(withName.name.status, /retired on 2026-08-29/);
  assert.match(withName.name.status, /resolve read-only/);
  assert.match(withName.name.status, /frozen on mainnet/);
  assert.match(withName.name.status, /3RhyFd57nP7R1HysZC14M9xs9T6e1cJNrqBTAFnaF9mZ/);
  assert.equal(withName.name.claim_preview, undefined);
  assert.ok(withName.next_steps.some((s) => /registration is frozen/.test(s) && /read-only/.test(s)));
  // No step tells the agent to run a write tool against the retired registrar.
  for (const step of withName.next_steps) {
    assert.doesNotMatch(step, /register_null_name\(|set_null_endpoint\(/);
  }

  const noName = buildOnboardPlan({
    validation: validateOnboardInput({}, { solanaWallet: WALLET, services: SERVICES }),
    identityRegistered: false,
  });
  assert.equal(noName.name, null);
  assert.equal(noName.name_suggestion.suggested, "summarize.null");
  assert.equal(noName.name_suggestion.registration, "frozen");
  assert.equal(noName.name_suggestion.claim_preview, undefined);
  assert.match(noName.next_steps[0], /x402-gate/);
});

test("onboard output carries no LIVE / claim-now / register-on-mainnet text (both networks, with + without name)", () => {
  for (const network of ["solana-mainnet", "solana-devnet"]) {
    for (const name of ["myagent", undefined]) {
      const plan = buildOnboardPlan({
        validation: validateOnboardInput({}, { solanaWallet: WALLET, name, services: SERVICES, network }),
        identityRegistered: false,
      });
      const text = JSON.stringify(plan);
      assert.doesNotMatch(text, /LIVE/);
      assert.doesNotMatch(text, /claim .*now/i);
      assert.doesNotMatch(text, /is live the moment/i);
      assert.doesNotMatch(text, /live on mainnet/i);
      assert.doesNotMatch(text, /register_null_name\(\{/);
      assert.match(plan.summary, /frozen on mainnet/);
      assert.match(plan.summary, /read-only/);
    }
  }
});

test("receipts block refuses anchoring on every network and names no anchor target", () => {
  const dev = buildReceiptsBlock("solana-devnet");
  const main = buildReceiptsBlock("solana-mainnet");
  for (const [net, b] of [["solana-devnet", dev], ["solana-mainnet", main]]) {
    assert.equal(b.network, net);
    assert.equal(b.anchoring, "unavailable");
    assert.equal(b.program, null);
    assert.equal(b.anchor_network, null);
    assert.equal(b.mainnet_program_retired, RECEIPT_ANCHOR_MAINNET_RETIRED);
    assert.equal(b.mainnet_retired_at, "2026-07-14");
    assert.match(b.note, /Receipt anchoring is not done by this plugin and no anchor program is configured/);
    assert.match(b.note, /HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs/);
    assert.match(b.note, /retired on 2026-07-14/);
    // The only devnet program the note names is the fresh 2026-10-06 receipt_anchor.
    assert.deepEqual(
      base58Tokens(b.note).filter((t) => t.length >= 32 && t !== RECEIPT_ANCHOR_MAINNET_RETIRED),
      ["HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs"],
    );
    for (const t of base58Tokens(b)) assert.ok(!COMPROMISED_SHA256.has(sha256(t)));
  }

  // Wired into the plan by network.
  const devPlan = buildOnboardPlan({
    validation: validateOnboardInput({}, { solanaWallet: WALLET, services: SERVICES, network: "solana-devnet" }),
    identityRegistered: false,
  });
  assert.deepEqual(devPlan.receipts, dev);
  const mainPlan = buildOnboardPlan({
    validation: validateOnboardInput({}, { solanaWallet: WALLET, services: SERVICES }),
    identityRegistered: false,
  });
  assert.deepEqual(mainPlan.receipts, main);
  for (const plan of [devPlan, mainPlan]) {
    assert.ok(plan.next_steps.some((s) => /receipt anchoring is not done by this plugin/.test(s)));
    assert.match(plan.summary, /receipt anchoring is not done by this plugin/);
    assert.doesNotMatch(JSON.stringify(plan.next_steps) + plan.summary, /anchor[^"]*devnet|on devnet/i);
    for (const t of base58Tokens(plan)) assert.ok(!COMPROMISED_SHA256.has(sha256(t)), "plan names a compromised ID");
  }
});

// ── tool factory ────────────────────────────────────────────────────────────────

test("buildOnboardTools registers exactly web0_onboard", () => {
  const tools = buildOnboardTools(readConfig({}));
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "web0_onboard");
  assert.equal(typeof tools[0].handler, "function");
  assert.doesNotMatch(tools[0].description, /LIVE|claim .*now/i);
  assert.match(tools[0].description, /frozen/);
  assert.deepEqual(
    Object.keys(tools[0].parameters).sort(),
    ["ethAddress", "name", "network", "services", "solanaWallet"],
  );
});

test("web0_onboard handler returns validation errors without any network call", async () => {
  const [tool] = buildOnboardTools(readConfig({}));
  const res = await tool.handler({ services: [] }); // no wallet → fails before RPC
  assert.equal(res.ok, false);
  assert.ok(Array.isArray(res.errors) && res.errors.length > 0);
});
