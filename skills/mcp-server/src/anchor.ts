/**
 * receipt_anchor instruction encoder + availability gate (host-free, byte-exact,
 * unit-tested).
 *
 * Availability: this server does not anchor and configures no default
 * receipt_anchor program. The mainnet program (6HSRGivd…) was retired
 * 2026-07-14 — its historical anchors (June–July 2026) remain readable
 * on-chain. A devnet receipt_anchor runs at HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs
 * (2026-10-06); this release does not call it. anchor_receipt and
 * private_compute refuse with RECEIPT_ANCHOR_UNAVAILABLE_ERROR and send
 * nothing. Receipt hashes and commitments are still computed locally.
 *
 * The encoder below takes the program id as an explicit argument and has no
 * default target.
 *
 * Instruction ABI (receipt_anchor):
 *   data = [0x01 version][flags][32-byte hash]( [u64 LE bucket_id] )
 *   - 34-byte form: flags=0x00, program derives the bucket from its Clock hour
 *   - 42-byte form: flags=0x01, client pins bucket_id (this is what we use)
 *   keys = [payer(signer,writable), bucket PDA(writable), system_program]
 *   bucket PDA seeds = ["bucket", u64 LE bucket_id], bucket_id = floor(unix/3600)
 *
 * We use the 42-byte pinned-bucket form so the bucket PDA the client derives
 * always matches the one the program writes (the 34-byte form would let the
 * validator's Clock hour drift from the client's near an hour boundary).
 */

import { PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";

/** receipt_anchor on mainnet — retired 2026-07-14; historical anchors readable. */
export const RECEIPT_ANCHOR_MAINNET_RETIRED = "6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN";
export const RECEIPT_ANCHOR_MAINNET_RETIRED_ON = "2026-07-14";

/** Returned (and thrown) whenever anchoring is requested. Nothing is signed or sent. */
export const RECEIPT_ANCHOR_UNAVAILABLE_ERROR =
  "receipt anchoring is not done by this server and no default anchor program is configured — " +
  "no transaction was sent. A devnet receipt_anchor runs at HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs (2026-10-06); " +
  "pass it explicitly to a client that anchors. " +
  `The mainnet receipt_anchor (${RECEIPT_ANCHOR_MAINNET_RETIRED}) was retired ${RECEIPT_ANCHOR_MAINNET_RETIRED_ON}; ` +
  "its historical anchors remain readable. The receipt hash is still computed locally.";

export const RECEIPT_ANCHOR_VERSION = 0x01;
export const FLAG_HAS_BUCKET_ID = 0x01;
const BUCKET_SEED_PREFIX = "bucket";
const BUCKET_WINDOW_SECONDS = 3600;

/** The program's hourly bucket id: floor(unix_seconds / 3600); 0 for non-positive. */
export function bucketIdForUnix(unixSeconds: number): bigint {
  return unixSeconds <= 0 ? 0n : BigInt(Math.floor(unixSeconds / BUCKET_WINDOW_SECONDS));
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

/** Derive the AnchorBucket PDA for a bucket id: ["bucket", u64 LE bucket_id]. */
export function deriveBucketPda(bucketId: bigint, programId: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(BUCKET_SEED_PREFIX), u64le(bucketId)],
    new PublicKey(programId),
  );
  return pda;
}

/**
 * Build the single-anchor instruction (42-byte pinned-bucket form) for an
 * explicit program id. Refuses the retired mainnet program id — an instruction
 * for it could never execute.
 */
export function buildAnchorIx(opts: {
  payer: string;
  receiptHashHex: string;
  programId: string;
  bucketId: bigint;
}): TransactionInstruction {
  if (!/^[0-9a-fA-F]{64}$/.test(opts.receiptHashHex)) {
    throw new Error("receipt_hash_hex must be exactly 64 hex characters (32 bytes).");
  }
  if (opts.programId === RECEIPT_ANCHOR_MAINNET_RETIRED) {
    throw new Error(RECEIPT_ANCHOR_UNAVAILABLE_ERROR);
  }
  const data = Buffer.concat([
    Buffer.from([RECEIPT_ANCHOR_VERSION, FLAG_HAS_BUCKET_ID]),
    Buffer.from(opts.receiptHashHex, "hex"),
    u64le(opts.bucketId),
  ]);
  return new TransactionInstruction({
    programId: new PublicKey(opts.programId),
    keys: [
      { pubkey: new PublicKey(opts.payer), isSigner: true, isWritable: true },
      { pubkey: deriveBucketPda(opts.bucketId, opts.programId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}
