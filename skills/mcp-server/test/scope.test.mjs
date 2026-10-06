/**
 * Unit tests for the host-free permission core (../dist/scope.js).
 *
 * These prove the write-guard that index.ts now enforces: the Grant-OR-confirm
 * truth table, the seized-program guard, and the tool-set membership. Run after
 * `npm run build` (the test script builds first).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { createHash } from "node:crypto";

import {
  WRITE_TOOLS,
  READ_TOOLS,
  COMPROMISED_PROGRAM_SHA256,
  programIdDigest,
  isSeizedProgram,
  assertNotSeized,
  canSubmitWrite,
} from "../dist/scope.js";

// ── canSubmitWrite truth table ───────────────────────────────────────────────

test("canSubmitWrite: blocked when writes disabled, regardless of confirm/consent", () => {
  for (const confirm of [true, false]) {
    for (const consented of [true, false]) {
      const d = canSubmitWrite({ allowWrite: false, confirm, consented });
      assert.equal(d.allowed, false);
      assert.match(d.blockedReason, /PARAD0X_MCP_ALLOW_WRITE=1/);
    }
  }
});

test("canSubmitWrite: allowWrite + confirm → allowed", () => {
  const d = canSubmitWrite({ allowWrite: true, confirm: true, consented: false });
  assert.equal(d.allowed, true);
  assert.equal(d.blockedReason, undefined);
});

test("canSubmitWrite: allowWrite + session consent (no per-call confirm) → allowed", () => {
  const d = canSubmitWrite({ allowWrite: true, confirm: false, consented: true });
  assert.equal(d.allowed, true);
});

test("canSubmitWrite: allowWrite but neither confirm nor consent → blocked", () => {
  const d = canSubmitWrite({ allowWrite: true, confirm: false, consented: false });
  assert.equal(d.allowed, false);
  assert.match(d.blockedReason, /confirm:true|grant_write_consent/);
});

// ── seized-program guard ─────────────────────────────────────────────────────

// The denylisted IDs are never written in plain text (not even here), so the
// guard is exercised with a synthetic denylist built from a throwaway key.
const FAKE_SEIZED = Keypair.generate().publicKey.toBase58();
const FAKE_DENYLIST = new Set([createHash("sha256").update(FAKE_SEIZED).digest("hex")]);

test("isSeizedProgram: an ID whose digest is denylisted is refused", () => {
  assert.equal(isSeizedProgram(FAKE_SEIZED, FAKE_DENYLIST), true);
  assert.equal(isSeizedProgram(Keypair.generate().publicKey.toBase58(), FAKE_DENYLIST), false);
  // the real denylist does not contain the throwaway key
  assert.equal(isSeizedProgram(FAKE_SEIZED), false);
});

test("assertNotSeized: throws for a denylisted ID", () => {
  assert.throws(() => assertNotSeized(FAKE_SEIZED, "test_program", FAKE_DENYLIST), /SEIZED/);
});

test("programIdDigest is SHA-256 hex over the base58 string", () => {
  assert.equal(programIdDigest(FAKE_SEIZED), createHash("sha256").update(FAKE_SEIZED).digest("hex"));
});

test("assertNotSeized: passes for a non-seized program ID", () => {
  // Dark NULL canonical devnet program (clean authority) must not be flagged.
  assert.doesNotThrow(() =>
    assertNotSeized("35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV", "dark_null"),
  );
  assert.doesNotThrow(() => assertNotSeized(Keypair.generate().publicKey.toBase58(), "random"));
});

test("the gen-1 x402 access gate and the secp256r1 vault are denylisted by digest", () => {
  assert.ok(COMPROMISED_PROGRAM_SHA256.has("d8406486dd119717648b5b6e6f4b8b9a044536b3ab95c34da437add15c5cac36"));
  assert.ok(COMPROMISED_PROGRAM_SHA256.has("efa8237fa114259344b44de2f79c21583ec464ffe5186876c35595bbd11983a1"));
});

test("compromised program IDs are held as 40 SHA-256 digests, never as plain IDs", () => {
  assert.equal(COMPROMISED_PROGRAM_SHA256.size, 40);
  for (const h of COMPROMISED_PROGRAM_SHA256) assert.match(h, /^[0-9a-f]{64}$/);
});

test("isSeizedProgram: an unrelated key is not refused", () => {
  assert.equal(isSeizedProgram(Keypair.generate().publicKey.toBase58()), false);
});

// ── tool-set membership ──────────────────────────────────────────────────────

test("write tools are exactly anchor_receipt + private_compute", () => {
  assert.deepEqual([...WRITE_TOOLS].sort(), ["anchor_receipt", "private_compute"]);
});

test("the consent tools are read-only (never gated)", () => {
  for (const t of ["get_scope_status", "grant_write_consent", "revoke_write_consent"]) {
    assert.ok(READ_TOOLS.has(t), `${t} should be a read tool`);
    assert.ok(!WRITE_TOOLS.has(t), `${t} must not be a write tool`);
  }
});

test("read and write tool sets are disjoint", () => {
  for (const t of WRITE_TOOLS) assert.ok(!READ_TOOLS.has(t), `${t} in both sets`);
});
