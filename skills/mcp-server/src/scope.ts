/**
 * Pure, host-free permission logic for the Parad0x MCP server.
 *
 * Extracted from index.ts so the security-critical decisions — what may write,
 * which programs are seized, and when a write is allowed — can be unit-tested
 * without spawning the stdio server or touching Solana.
 */

import { createHash } from "crypto";

/** Tools that submit an on-chain transaction (cost money / mutate state). */
export const WRITE_TOOLS = new Set<string>(["anchor_receipt", "private_compute"]);

/** Read-only tools — always callable, never gated. */
export const READ_TOOLS = new Set<string>([
  "x402_get_quote",
  "get_stack_status",
  "lookup_passport",
  "check_nullifier",
  "compress_receipts",
  "build_outcome_receipt",
  "resolve_null",
  "get_scope_status",
  "grant_write_consent",
  "revoke_write_consent",
]);

/**
 * SHA-256 (hex, over the base58 string) of every program ID that must never be
 * called: the IDs whose upgrade authority is held by the stolen deploy key
 * (stolen 2026-06-14) or the attacker key, verified on-chain 2026-10-06, plus
 * the gen-1 x402 access gate and the secp256r1 vault. Stored hashed so this
 * package never names them; a matching program ID is refused as seized.
 */
export const COMPROMISED_PROGRAM_SHA256 = new Set<string>([
  "03a6663124ee110d7f1549225ae8b66e28f989b1ea306733025ac34f453b1bd3",
  "087e543cd6ed73fd60f01310834299868662c9c5d38e4e0bf51d2d4e163ca48e",
  "0a81ba274124ff3e0e1ccc8751aaf0502e64ae7cd7ca1c01b2ac2307e0fe7888",
  "106ecad95974bc44ac3814080c6da4034acc9954fca73cb70847c179c55960c1",
  "18a6ef269348afca606c6518a3c9f99db95b04e00b6db6f72fd5e27617cffe5a",
  "207b9501b614cc267c35ba80ca816de9a73705d7a1783013d980071d587c8508",
  "35a832bc1dff671d6a806d63ea404ed181ed9675c49d513889e4a3aabda68423",
  "427d5ceda543e84da133f012aa276e2976d3b2bdab0f919a8868915b686431f7",
  "43ec8670ab0331d8d7c61a96cfdc0ea35a42a4cd92181d030a8273b2746bc40f",
  "443aa25e948a5bacda419354d767daec61535ef8a7bb705608dd5622b40a8781",
  "515932c0aff64f0c71748d3937816d7a3fa7b54cc2d8652644df02e0bf9160e1",
  "536f4d11f78683f2c410ef5c0e1ac44331282a5e8a8326bf496e9d88a37aadc6",
  "5f93a30006d238b27674c912e06c66ed5ae239cada777c0259d972fef1d8f7a9",
  "67ae1a129d05113c25802b3c6d2662258d7d1f2eb8aa5d926aa12e9cfa07255c",
  "7abaeaa69c452dd5349bbde0858b343984fdef2e1bf32359248915b777c535bc",
  "7f13819793d15a9543e8311e0f03f32e5402550482b7a8c2f4f6820e436a2848",
  "803fb82c8a17d742b688169b74ea32f0853575ba99e4dab546c869f5498eb659",
  "8be761a7c6188ea3b42e969a23826b19c6dc48edf0f980cdec0a6ac60c2cabb3",
  "8db33330fbc7b9aec1f2be55a3b2e66a48f92e1456f0c5bf20cb1376ebc04f9c",
  "9494405041eb52ca83174f86dfb0b10ae420f30d937d01eff10e09a90f8ac7cd",
  "94afaea6b3909084ed4827d43f37a6c53e379a093aaefed0831a8488bb204726",
  "a47c1fce4236ba82d1b46be7c5f1a88e7cb8e884a505b4166f1787b25f0ff7d2",
  "a596f7427e3beb2e55ecd603a8c8fdffeac0a4f41cdae228ac58ebbabdca4b7c",
  "a5e1459d45cc7e1c595f7177d3ec330d82e458b44550e419eea5c740c02362c5",
  "a7656054f294394e546b39f90c03a0cb31446ac46c37285f5bfc900b3bcea827",
  "a9393ec9cb1e53f2d05d44b85abdce3b7aefbdcc911c79fcc247f690a6d8f961",
  "ab08034c09f59bbe63cb2732098eeaf0d5314562ff33e47aec7c2a83e9632e4b",
  "b851c1d6562bf9e70e2033a2db83d21fc5b249eab440a751d5638b285a4596c0",
  "b86bc72fc29bf4fec42ae08c5640ff26dbddcfa4fcc676f5c5c5e6202c4ef345",
  "b90ca850a9d88bddc7a7bb14961f307330ce1e229191aada8d4af2deccf0e643",
  "bc1d1c322bc032feb4e9b35546eb747957dc594b0985f23443b7b88d2aa83d2f",
  "c71f07bc53d21a569410c274846a5716f434ae224436c193abb8d8db6659adff",
  "caf0dd36fc5c1b21b85ea77f22eb776e92f27050ad5061f277d2f193112691af",
  "cdebce72fa8e40499a46331babaeec9fef6328631646b2a7249b31ba420e8cdc",
  "d54db76ef37ef4cdb0b06378f83c9402c4cb32e2c726bbbeac3a7f3ff1a03330",
  "e8d879443447bc9d15426dc46d22cb5786a77b82da869f89abe71e8ef6efc41b",
  "f53b062423ef87023ecb4a2a8caf8743508d1883582d9dc63a0e5764bffa3fc2",
  "f6306c52937d2c382219c615f7f18996c6803ffdccf1df6fcfdcb1fc222392ed",
  // gen-1 x402 access gate (seized pre-incident)
  "d8406486dd119717648b5b6e6f4b8b9a044536b3ab95c34da437add15c5cac36",
  // secp256r1 vault (attacker-controlled)
  "efa8237fa114259344b44de2f79c21583ec464ffe5186876c35595bbd11983a1",
]);

/** SHA-256 hex digest of a base58 program ID, as held in the denylist. */
export function programIdDigest(programId: string): string {
  return createHash("sha256").update(programId).digest("hex");
}

/**
 * True if a program ID is seized or compromised and must never be called.
 * `denylist` defaults to COMPROMISED_PROGRAM_SHA256; tests pass their own.
 */
export function isSeizedProgram(
  programId: string,
  denylist: ReadonlySet<string> = COMPROMISED_PROGRAM_SHA256,
): boolean {
  return denylist.has(programIdDigest(programId));
}

/** Throw if a program ID is seized or compromised. */
export function assertNotSeized(
  programId: string,
  name: string,
  denylist: ReadonlySet<string> = COMPROMISED_PROGRAM_SHA256,
): void {
  if (isSeizedProgram(programId, denylist)) {
    throw new Error(
      `${name} (${programId}) is a SEIZED program — upgrade authority is under hostile control. ` +
        `Do not call this program.`
    );
  }
}

export interface WriteDecision {
  allowed: boolean;
  blockedReason?: string;
}

/**
 * Decide whether an on-chain write may proceed. Grant-OR-confirm model:
 *   - `allowWrite` (operator set PARAD0X_MCP_ALLOW_WRITE=1 on this machine) is a
 *     hard prerequisite — without it, nothing writes.
 *   - then EITHER a per-call `confirm:true` OR a prior session consent
 *     (grant_write_consent) authorizes the submission.
 *
 * Pure function: all inputs are explicit so the truth table is unit-testable.
 */
export function canSubmitWrite(opts: {
  allowWrite: boolean;
  confirm: boolean;
  consented: boolean;
}): WriteDecision {
  if (!opts.allowWrite) {
    return {
      allowed: false,
      blockedReason:
        "writes disabled — operator must set PARAD0X_MCP_ALLOW_WRITE=1 on this machine",
    };
  }
  if (opts.confirm || opts.consented) {
    return { allowed: true };
  }
  return {
    allowed: false,
    blockedReason:
      "confirm:true required to submit a real transaction (or call grant_write_consent first to authorize this tool for the session)",
  };
}
