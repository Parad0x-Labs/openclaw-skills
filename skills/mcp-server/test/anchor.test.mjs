/**
 * Byte-exact tests for the receipt_anchor encoder (../dist/anchor.js) and the
 * devnet-only cluster guard (mainnet receipt_anchor retired 2026-07-14).
 * Hermetic — no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  buildAnchorIx,
  deriveBucketPda,
  bucketIdForUnix,
  RECEIPT_ANCHOR_VERSION,
  FLAG_HAS_BUCKET_ID,
  RECEIPT_ANCHOR_DEVNET,
  RECEIPT_ANCHOR_MAINNET_RETIRED,
  ANCHOR_RPC_DEVNET,
  GENESIS_HASH,
  classifyRpcUrl,
  assertDevnetAnchorCluster,
} from "../dist/anchor.js";

const RECEIPT_ANCHOR = "CPQ8Y1bdRiadxLMhrQG14Atc3E5eNJhqwPX1nXtH1Mst"; // devnet write target
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

// ── deployments + cluster guard ──────────────────────────────────────────────

test("write target is the devnet receipt_anchor; mainnet id is marked retired", () => {
  assert.equal(RECEIPT_ANCHOR_DEVNET, RECEIPT_ANCHOR);
  assert.equal(RECEIPT_ANCHOR_MAINNET_RETIRED, RETIRED_MAINNET);
  assert.notEqual(RECEIPT_ANCHOR_DEVNET, RECEIPT_ANCHOR_MAINNET_RETIRED);
  assert.match(ANCHOR_RPC_DEVNET, /devnet/);
});

test("buildAnchorIx refuses the retired mainnet program id", () => {
  assert.throws(
    () => buildAnchorIx({ payer: PAYER, receiptHashHex: HASH, programId: RETIRED_MAINNET, bucketId: 1n }),
    /retired 2026-07-14/,
  );
});

test("classifyRpcUrl: mainnet / devnet / testnet / unknown", () => {
  for (const u of [
    "https://solana-rpc.publicnode.com",
    "https://solana.publicnode.com",
    "https://solana.api.onfinality.io/public",
    "https://api.mainnet-beta.solana.com",
    "https://mainnet.helius-rpc.com/?api-key=x",
  ]) {
    assert.equal(classifyRpcUrl(u), "mainnet", u);
  }
  assert.equal(classifyRpcUrl("https://api.devnet.solana.com"), "devnet");
  assert.equal(classifyRpcUrl("https://devnet.helius-rpc.com/?api-key=x"), "devnet");
  assert.equal(classifyRpcUrl("https://api.testnet.solana.com"), "testnet");
  assert.equal(classifyRpcUrl("http://127.0.0.1:8899"), "unknown");
  assert.equal(classifyRpcUrl("not a url"), "unknown");
});

test("assertDevnetAnchorCluster: devnet passes, mainnet gets the retired error, others refused", () => {
  assert.doesNotThrow(() => assertDevnetAnchorCluster(GENESIS_HASH.devnet));
  assert.throws(() => assertDevnetAnchorCluster(GENESIS_HASH.mainnet), /retired 2026-07-14/);
  assert.throws(() => assertDevnetAnchorCluster(GENESIS_HASH.mainnet), /CPQ8Y1bd/);
  assert.throws(() => assertDevnetAnchorCluster(GENESIS_HASH.testnet), /not devnet/);
  assert.throws(() => assertDevnetAnchorCluster("someLocalValidatorGenesis"), /not devnet/);
});
