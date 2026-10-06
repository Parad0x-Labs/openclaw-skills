/**
 * Unit tests for the host-free passport core (../dist/passport.js).
 *
 * Hermetic — no live RPC. Covers PDA derivation determinism + correctness,
 * the tool factory (names/params/no-arg guard), the legacy program IDs and their
 * retired status, and the public RPC default. Run after `npm run build` (the test script builds first).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";

import {
  DARK_SECP256K1_AUTH,
  DARK_SECP256R1_VAULT,
  RECEIPT_ANCHOR,
  DEFAULT_RPC,
  PROGRAMS,
  PROGRAM_STATUS,
  readConfig,
  deriveEthBindingPda,
  deriveSolAgentPda,
  deriveWebAuthnVaultPda,
  buildPassportTools,
} from "../dist/passport.js";

const SEIZED = ["EepqzVBNuzCgD6XGiB19pDDhzFG3gUL4z1nabBYxpfjS"];
// SHA-256 of compromised program IDs this repo once referenced (held hashed, never named).
const COMPROMISED_SHA256 = new Set([
  "a7656054f294394e546b39f90c03a0cb31446ac46c37285f5bfc900b3bcea827",
  "35a832bc1dff671d6a806d63ea404ed181ed9675c49d513889e4a3aabda68423",
  "7abaeaa69c452dd5349bbde0858b343984fdef2e1bf32359248915b777c535bc",
  "0a81ba274124ff3e0e1ccc8751aaf0502e64ae7cd7ca1c01b2ac2307e0fe7888",
  "b851c1d6562bf9e70e2033a2db83d21fc5b249eab440a751d5638b285a4596c0",
  "a47c1fce4236ba82d1b46be7c5f1a88e7cb8e884a505b4166f1787b25f0ff7d2",
]);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const SAMPLE_ETH = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const SAMPLE_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"; // a valid base58 pubkey

// ── program IDs / RPC ─────────────────────────────────────────────────────────

test("no seized pre-incident program ID is referenced", () => {
  for (const id of [DARK_SECP256K1_AUTH, DARK_SECP256R1_VAULT, RECEIPT_ANCHOR]) {
    assert.ok(!SEIZED.includes(id), `${id} is a seized ID and must not be used`);
    assert.ok(!COMPROMISED_SHA256.has(sha256(id)), `${id} is a compromised ID and must not be used`);
  }
  for (const v of Object.values(PROGRAM_STATUS)) {
    for (const word of v.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? []) {
      assert.ok(!COMPROMISED_SHA256.has(sha256(word)), "status text names a compromised ID");
    }
  }
});

test("default RPC is the approved public node (never api.mainnet-beta)", () => {
  assert.equal(DEFAULT_RPC, "https://solana-rpc.publicnode.com");
  assert.doesNotMatch(DEFAULT_RPC, /api\.mainnet-beta\.solana\.com/);
});

test("PROGRAMS maps the three legacy mainnet program IDs", () => {
  assert.equal(PROGRAMS.dark_secp256k1_auth, DARK_SECP256K1_AUTH);
  assert.equal(PROGRAMS.dark_secp256r1_vault, DARK_SECP256R1_VAULT);
  assert.equal(PROGRAMS.receipt_anchor, RECEIPT_ANCHOR);
});

// ── PDA derivation ────────────────────────────────────────────────────────────

test("deriveEthBindingPda: deterministic + on dark_secp256k1_auth", () => {
  const a = deriveEthBindingPda(SAMPLE_ETH);
  const b = deriveEthBindingPda(SAMPLE_ETH);
  assert.equal(a, b, "same input must yield same PDA");
  assert.ok(a, "should derive a PDA");
  // 0x-prefixed and bare hex must agree
  assert.equal(deriveEthBindingPda(SAMPLE_ETH.slice(2)), a);
  // recompute the expected PDA independently
  const [expected] = PublicKey.findProgramAddressSync(
    [Buffer.from("eth_agent"), Buffer.from(SAMPLE_ETH.slice(2), "hex")],
    new PublicKey(DARK_SECP256K1_AUTH),
  );
  assert.equal(a, expected.toBase58());
});

test("deriveEthBindingPda: rejects malformed addresses", () => {
  assert.equal(deriveEthBindingPda("0x1234"), null);
  assert.equal(deriveEthBindingPda("not-hex-at-all"), null);
  assert.equal(deriveEthBindingPda(""), null);
});

test("deriveSolAgentPda + deriveWebAuthnVaultPda: deterministic, distinct, correct seeds", () => {
  const sol = deriveSolAgentPda(SAMPLE_WALLET);
  const vault = deriveWebAuthnVaultPda(SAMPLE_WALLET);
  assert.ok(sol && vault);
  assert.equal(sol, deriveSolAgentPda(SAMPLE_WALLET));
  assert.notEqual(sol, vault, "sol_agent and webauthn_vault PDAs must differ");

  const wallet = new PublicKey(SAMPLE_WALLET);
  const [expSol] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol_agent"), wallet.toBytes()],
    new PublicKey(DARK_SECP256K1_AUTH),
  );
  const [expVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("webauthn_vault"), wallet.toBytes()],
    new PublicKey(DARK_SECP256R1_VAULT),
  );
  assert.equal(sol, expSol.toBase58());
  assert.equal(vault, expVault.toBase58());
});

test("PDA derivers return null on malformed wallet", () => {
  assert.equal(deriveSolAgentPda("not-a-pubkey"), null);
  assert.equal(deriveWebAuthnVaultPda("???"), null);
});

// ── config ────────────────────────────────────────────────────────────────────

test("readConfig keeps strings, drops non-strings", () => {
  const cfg = readConfig({ solanaWallet: SAMPLE_WALLET, ethAddress: 123, nullName: "a.null" });
  assert.equal(cfg.solanaWallet, SAMPLE_WALLET);
  assert.equal(cfg.ethAddress, undefined); // 123 is not a string
  assert.equal(cfg.nullName, "a.null");
  assert.deepEqual(readConfig(undefined), {
    solanaWallet: undefined,
    ethAddress: undefined,
    nullName: undefined,
    rpcUrl: undefined,
  });
});

// ── tool factory ──────────────────────────────────────────────────────────────

test("buildPassportTools registers exactly the two read-only identity tools", () => {
  const tools = buildPassportTools(readConfig({ nullName: "me.null" }));
  assert.equal(tools.length, 2);
  const names = tools.map((t) => t.name);
  assert.deepEqual(names.sort(), ["get_agent_passport", "verify_agent_identity"]);
  for (const t of tools) {
    assert.equal(typeof t.handler, "function");
    assert.equal(typeof t.description, "string");
    assert.equal(typeof t.parameters, "object");
  }
});

test("verify_agent_identity rejects an empty target without any network call", async () => {
  const [, verify] = buildPassportTools(readConfig({}));
  const res = await verify.handler({});
  assert.equal(res.ok, false);
  assert.match(res.error, /at least one of/i);
});

test("verify_agent_identity exposes the three target params", () => {
  const [, verify] = buildPassportTools(readConfig({}));
  assert.deepEqual(
    Object.keys(verify.parameters).sort(),
    ["target_eth_address", "target_null_name", "target_solana_wallet"],
  );
});

// ── retired-program status (read-only plugin) ────────────────────────────────

test("PROGRAM_STATUS marks every listed program retired, keyed like PROGRAMS", () => {
  assert.deepEqual(Object.keys(PROGRAM_STATUS).sort(), Object.keys(PROGRAMS).sort());
  for (const [k, v] of Object.entries(PROGRAM_STATUS)) {
    assert.match(v, /^retired/, `${k} must be reported retired`);
    assert.match(v, /readable/, `${k} must say its accounts stay readable`);
  }
  assert.match(PROGRAM_STATUS.receipt_anchor, /2026-07-14/);
  assert.match(PROGRAM_STATUS.receipt_anchor, /receipt anchoring is unavailable until the redeploy under a fresh key/);
  assert.doesNotMatch(PROGRAM_STATUS.receipt_anchor, /devnet/i);
});

test("tool descriptions state read-only access to retired programs (no live claims)", () => {
  for (const t of buildPassportTools(readConfig({}))) {
    assert.match(t.description, /Read-only/);
    assert.match(t.description, /retired/);
    assert.doesNotMatch(t.description, /\blive\b/i);
  }
});

test("verify_agent_identity result carries program_status (fake connection, no network)", async () => {
  // Point at a closed local port: accountExists() swallows the failure → false,
  // so the handler completes without any external network access.
  const [, verify] = buildPassportTools(readConfig({ rpcUrl: "http://127.0.0.1:9" }));
  const res = await verify.handler({ target_solana_wallet: SAMPLE_WALLET });
  assert.equal(res.ok, true);
  assert.deepEqual(res.program_status, PROGRAM_STATUS);
  assert.equal(res.registered.sol_agent, false);
});
