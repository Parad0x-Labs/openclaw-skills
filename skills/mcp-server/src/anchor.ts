/**
 * receipt_anchor instruction encoder + cluster guard (host-free, byte-exact,
 * unit-tested).
 *
 * Deployments:
 *   - devnet  CPQ8Y1bd… — the write target. anchor_receipt submits here only.
 *   - mainnet 6HSRGivd… — RETIRED 2026-07-14. It cannot be invoked; the
 *     historical anchors it stored (June–July 2026) remain readable on-chain.
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

/** receipt_anchor on devnet — the only cluster anchor_receipt writes to. */
export const RECEIPT_ANCHOR_DEVNET = "CPQ8Y1bdRiadxLMhrQG14Atc3E5eNJhqwPX1nXtH1Mst";
/** receipt_anchor on mainnet — retired 2026-07-14; historical anchors readable. */
export const RECEIPT_ANCHOR_MAINNET_RETIRED = "6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN";
export const RECEIPT_ANCHOR_MAINNET_RETIRED_ON = "2026-07-14";
/** Default RPC for anchoring (devnet). */
export const ANCHOR_RPC_DEVNET = "https://api.devnet.solana.com";

/** Cluster genesis hashes — the authoritative way to tell which cluster an RPC serves. */
export const GENESIS_HASH = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
} as const;

export const MAINNET_ANCHOR_RETIRED_ERROR =
  `receipt_anchor on Solana mainnet (${RECEIPT_ANCHOR_MAINNET_RETIRED}) was retired ` +
  `${RECEIPT_ANCHOR_MAINNET_RETIRED_ON} and cannot be invoked — no mainnet anchor transaction is sent. ` +
  `Anchoring runs on devnet (${RECEIPT_ANCHOR_DEVNET}); omit rpc_url or pass a devnet RPC ` +
  `(default ${ANCHOR_RPC_DEVNET}). Historical mainnet anchors remain readable.`;

/** Hosts that serve Solana mainnet without saying "mainnet" in the URL. */
const KNOWN_MAINNET_HOSTS = new Set<string>([
  "solana-rpc.publicnode.com",
  "solana.publicnode.com",
  "solana.api.onfinality.io",
]);

/**
 * Best-effort cluster guess from an RPC URL (no network). "unknown" is resolved
 * authoritatively by the genesis-hash check before anything is submitted.
 */
export function classifyRpcUrl(url: string): "mainnet" | "devnet" | "testnet" | "unknown" {
  let host = "";
  let full = url.toLowerCase();
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    full = `${host}${u.pathname.toLowerCase()}`;
  } catch {
    /* not a URL — fall back to substring checks on the raw string */
  }
  if (full.includes("devnet")) return "devnet";
  if (full.includes("testnet")) return "testnet";
  if (full.includes("mainnet") || KNOWN_MAINNET_HOSTS.has(host)) return "mainnet";
  return "unknown";
}

/**
 * Authoritative pre-submit guard: throws unless the RPC's genesis hash is devnet.
 * A mainnet genesis gets the explicit "retired 2026-07-14" error.
 */
export function assertDevnetAnchorCluster(genesisHash: string): void {
  if (genesisHash === GENESIS_HASH.devnet) return;
  if (genesisHash === GENESIS_HASH.mainnet) throw new Error(MAINNET_ANCHOR_RETIRED_ERROR);
  throw new Error(
    `anchor_receipt submits only to Solana devnet (${RECEIPT_ANCHOR_DEVNET}); ` +
      `this RPC reports genesis hash ${genesisHash}, which is not devnet. No transaction was sent.`,
  );
}

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
 * Build the single-anchor instruction (42-byte pinned-bucket form). Refuses the
 * retired mainnet program id — an instruction for it could never execute.
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
    throw new Error(MAINNET_ANCHOR_RETIRED_ERROR);
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
