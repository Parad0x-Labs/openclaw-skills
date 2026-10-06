/**
 * Byte-exact tests for the receipt_anchor encoder (../dist/anchor.js) and the
 * availability gate: receipt anchoring is unavailable until the redeploy under a
 * fresh key, so no default target exists. Hermetic — no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import * as anchor from "../dist/anchor.js";

const {
  buildAnchorIx,
  deriveBucketPda,
  bucketIdForUnix,
  RECEIPT_ANCHOR_VERSION,
  FLAG_HAS_BUCKET_ID,
  RECEIPT_ANCHOR_MAINNET_RETIRED,
  RECEIPT_ANCHOR_UNAVAILABLE_ERROR,
} = anchor;

// Encoder tests run against a throwaway program id — there is no live target.
const RECEIPT_ANCHOR = Keypair.generate().publicKey.toBase58();
const RETIRED_MAINNET = "6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN";
const PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const HASH = "a".repeat(64);

test("bucketIdForUnix = floor(unix/3600), 0 for non-positive", () => {
  assert.equal(bucketIdForUnix(3600 * 100), 100n);
  assert.equal(bucketIdForUnix(3600 * 100 + 59 * 60), 100n); // same hour
  assert.equal(bucketIdForUnix(3600 * 101), 101n);
  assert.equal(bucketIdForUnix(0), 0n);
  assert.equal(bucketIdForUnix(-5), 0n);
});

test("deriveBucketPda is deterministic + uses [\"bucket\", u64le(id)]", () => {
  const a = deriveBucketPda(100n, RECEIPT_ANCHOR);
  assert.equal(a.toBase58(), deriveBucketPda(100n, RECEIPT_ANCHOR).toBase58());
  const seed = Buffer.alloc(8);
  seed.writeBigUInt64LE(100n);
  const [exp] = PublicKey.findProgramAddressSync(
    [Buffer.from("bucket"), seed],
    new PublicKey(RECEIPT_ANCHOR),
  );
  assert.equal(a.toBase58(), exp.toBase58());
  assert.notEqual(deriveBucketPda(101n, RECEIPT_ANCHOR).toBase58(), a.toBase58());
});

test("buildAnchorIx: 42-byte v1 pinned-bucket data + 3 accounts in order", () => {
  const ix = buildAnchorIx({ payer: PAYER, receiptHashHex: HASH, programId: RECEIPT_ANCHOR, bucketId: 100n });
  assert.equal(ix.data.length, 42);
  assert.equal(ix.data[0], RECEIPT_ANCHOR_VERSION); // 0x01
  assert.equal(ix.data[1], FLAG_HAS_BUCKET_ID); // 0x01
  assert.equal(ix.data.subarray(2, 34).toString("hex"), HASH);
  assert.equal(ix.data.readBigUInt64LE(34), 100n);
  assert.equal(ix.programId.toBase58(), RECEIPT_ANCHOR);

  const k = ix.keys;
  assert.equal(k.length, 3);
  assert.ok(k[0].isSigner && k[0].isWritable); // payer
  assert.equal(k[0].pubkey.toBase58(), PAYER);
  assert.ok(!k[1].isSigner && k[1].isWritable); // bucket PDA
  assert.equal(k[1].pubkey.toBase58(), deriveBucketPda(100n, RECEIPT_ANCHOR).toBase58());
  assert.ok(!k[2].isSigner && !k[2].isWritable); // system program
  assert.equal(k[2].pubkey.toBase58(), SystemProgram.programId.toBase58());
});

test("buildAnchorIx rejects a malformed hash", () => {
  assert.throws(
    () => buildAnchorIx({ payer: PAYER, receiptHashHex: "abcd", programId: RECEIPT_ANCHOR, bucketId: 1n }),
    /64 hex/,
  );
});

// ── availability gate ────────────────────────────────────────────────────────

test("no receipt_anchor write target is exported; the module names no compromised id", () => {
  for (const k of Object.keys(anchor)) {
    assert.doesNotMatch(k, /DEVNET/, `${k} must not exist — there is no devnet target`);
  }
  assert.equal(anchor.RECEIPT_ANCHOR_DEVNET, undefined);
  assert.equal(anchor.ANCHOR_RPC_DEVNET, undefined);
  // the devnet program that was withdrawn (stored hashed, never named)
  const withdrawn = "b851c1d6562bf9e70e2033a2db83d21fc5b249eab440a751d5638b285a4596c0";
  for (const v of Object.values(anchor)) {
    if (typeof v === "string") {
      assert.notEqual(createHash("sha256").update(v).digest("hex"), withdrawn);
    }
  }
  assert.equal(RECEIPT_ANCHOR_MAINNET_RETIRED, RETIRED_MAINNET);
});

test("unavailable error says anchoring waits for the redeploy and nothing is sent", () => {
  assert.match(RECEIPT_ANCHOR_UNAVAILABLE_ERROR, /receipt anchoring is unavailable until the redeploy under a fresh key/);
  assert.match(RECEIPT_ANCHOR_UNAVAILABLE_ERROR, /no transaction was sent/);
  assert.doesNotMatch(RECEIPT_ANCHOR_UNAVAILABLE_ERROR, /devnet/i);
});

test("buildAnchorIx refuses the retired mainnet program id", () => {
  assert.throws(
    () => buildAnchorIx({ payer: PAYER, receiptHashHex: HASH, programId: RETIRED_MAINNET, bucketId: 1n }),
    /unavailable until the redeploy under a fresh key/,
  );
});
