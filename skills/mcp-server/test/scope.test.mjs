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

import {
  WRITE_TOOLS,
  READ_TOOLS,
  SEIZED_PROGRAMS,
  COMPROMISED_PROGRAM_SHA256,
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

test("assertNotSeized: throws on every listed seized ID", () => {
  for (const id of SEIZED_PROGRAMS) {
    assert.throws(() => assertNotSeized(id, "test_program"), /SEIZED/);
  }
});

test("assertNotSeized: passes for a non-seized program ID", () => {
  // Dark NULL canonical devnet program (clean authority) must not be flagged.
  assert.doesNotThrow(() =>
    assertNotSeized("35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV", "dark_null"),
  );
  assert.doesNotThrow(() => assertNotSeized(Keypair.generate().publicKey.toBase58(), "random"));
});

test("the seized pre-incident ID is registered", () => {
  assert.ok(SEIZED_PROGRAMS.has("EepqzVBNuzCgD6XGiB19pDDhzFG3gUL4z1nabBYxpfjS"));
});

test("compromised program IDs are held as 38 SHA-256 digests, never as plain IDs", () => {
  assert.equal(COMPROMISED_PROGRAM_SHA256.size, 38);
  for (const h of COMPROMISED_PROGRAM_SHA256) assert.match(h, /^[0-9a-f]{64}$/);
});

test("isSeizedProgram matches by digest (plain-text IDs are not stored)", () => {
  // A digest in the set is matched only via its preimage; an unrelated key is not.
  assert.equal(isSeizedProgram(Keypair.generate().publicKey.toBase58()), false);
  assert.equal(isSeizedProgram("EepqzVBNuzCgD6XGiB19pDDhzFG3gUL4z1nabBYxpfjS"), true);
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
