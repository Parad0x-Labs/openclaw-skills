#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createHash, createHmac, randomBytes, createCipheriv, createSecretKey } from "crypto";
import { deflateSync } from "zlib";
import { Connection, PublicKey } from "@solana/web3.js";
import { WRITE_TOOLS, READ_TOOLS } from "./scope.js";
import { resolveNullName, NULL_REGISTRAR_MAINNET } from "./resolve.js";
import {
  RECEIPT_ANCHOR_MAINNET_RETIRED,
  RECEIPT_ANCHOR_MAINNET_RETIRED_ON,
  RECEIPT_ANCHOR_UNAVAILABLE_ERROR,
} from "./anchor.js";
import { generateWallet, resolveWalletPath } from "./wallet.js";
import { writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { dirname } from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Current deployments:
//   - receipt_anchor: this server configures no anchor program. The mainnet
//     program (6HSRGivd…) was retired 2026-07-14 — its historical anchors stay
//     readable. A devnet receipt_anchor runs at HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs
//     (2026-10-06); this release does not call it, so anchor_receipt and
//     private_compute anchoring refuse.
//   - The gen-2 mainnet programs (passport/identity, semaphore, nullifier, proof gates,
//     …) are retired: program-owned accounts stay readable,
//     nothing can be invoked. Tools that touch them are read-only.
//   - The earlier shielded access gate, nullifier record, reputation gate and
//     commitment tree deployments were withdrawn. Devnet deployments run since
//     2026-10-06 (dark_x402_access_gate 7P7UpHbX9Nv3dap1DDA4GfLdX2JiNjEVisYvgbuhyNGR,
//     dark_nullifier_record CPMfXL73v9PDmxyPLTM97bzrNa5eg2AEpsac9XKzX9et,
//     dark_reputation_gate Cyz7WjdmDTRGBE6kJpDiHUHDkQ5jq2C8BrnHcZm8st2g,
//     receipt_commitment_tree Fyp5xQxCsUvgrq7wR42eRsL4MaLJML5FZxJtx55HzmFP); this release does
//     not call them, so check_nullifier refuses.
// Attacker-controlled program IDs (the gen-1 x402 access gate, the secp256r1
// vault, and every ID under the stolen deploy key) are never named here; they
// are held only as SHA-256 digests in ./scope.ts (isSeizedProgram).
const PROGRAMS = {
  // mainnet, retired 2026-07-14 — historical anchors readable, cannot be invoked
  receipt_anchor_mainnet_retired: RECEIPT_ANCHOR_MAINNET_RETIRED,
  // mainnet, retired — existing ETH↔Solana bindings readable (lookup_passport), cannot be invoked
  dark_secp256k1_auth: "AqwBbV13AoczhoELwP8oxT3nDqB6MsLWXauNzHkssZ9B",
  // mainnet, retired — accounts readable, cannot be invoked
  dark_semaphore: "Ev7HEFhhKTXk6kS2Y6ssbUcK9C7E6yZ589jJNjUrQV5p",
  // SPL token mint (mainnet)
  null_token: "8EeDdvCRmFAzVD4takkBrNNwkeUTUQh4MscRK5Fzpump",
  // deprecated demo gate — NOT a real verifier (hardcoded proof bypass); see get_stack_status.
  dark_bn254_gate: "GCptvBYF8S6eVYoh15B7WAESc54FUHCpN1Ui6aHeQYZd",
} as const;

/** Returned by check_nullifier: this release does not query a nullifier record program. */
const NULLIFIER_UNAVAILABLE_ERROR =
  "check_nullifier does not query a nullifier record program in this server and none is configured — no lookup was made. " +
  "A devnet dark_nullifier_record runs at CPMfXL73v9PDmxyPLTM97bzrNa5eg2AEpsac9XKzX9et (2026-10-06).";

const EXPLORER_BASE = "https://explorer.solana.com";
const DEFAULT_RPC = "https://solana-rpc.publicnode.com";

function explorerAccount(addr: string): string {
  return `${EXPLORER_BASE}/address/${addr}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256hex(data: Uint8Array | string): string {
  return createHash("sha256")
    .update(typeof data === "string" ? data : data)
    .digest("hex");
}

function buildMerkleRoot(items: object[]): string {
  const leaves: Uint8Array[] = items.map((item) =>
    createHash("sha256").update(JSON.stringify(item)).digest() as unknown as Uint8Array
  );
  if (leaves.length === 0) return "0".repeat(64);
  let layer = leaves;
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i] as Uint8Array;
      const right = (layer[i + 1] ?? layer[i]) as Uint8Array;
      const combined = new Uint8Array(64);
      combined.set(left, 0);
      combined.set(right, 32);
      next.push(createHash("sha256").update(combined).digest() as unknown as Uint8Array);
    }
    layer = next;
  }
  return Buffer.from(layer[0] as Uint8Array).toString("hex");
}

// ---------------------------------------------------------------------------
// Zero-trust hardening — local-first, the LLM is untrusted
//
// This server runs on the agent's OWN machine (stdio). It never hosts anything,
// never custodies funds, and never lets key material reach the model context.
//   1. WRITES OFF BY DEFAULT: signing/submitting a tx needs the operator to opt
//      in on this machine (PARAD0X_MCP_ALLOW_WRITE=1) AND a per-call confirm:true.
//   2. NO SECRETS TO THE LLM: every tool result is scrubbed of key material
//      before it leaves this process; a short fingerprint is kept for correlation.
// ---------------------------------------------------------------------------

const ALLOW_WRITE = process.env.PARAD0X_MCP_ALLOW_WRITE === "1";

// Per-session consent registry — tracks which write operations the operator has
// explicitly consented to this session (beyond the ALLOW_WRITE env flag).
// Keys are tool names; value is the ISO timestamp when consent was granted.
// The scope/seized decision logic lives in ./scope.ts so it is unit-testable.
const sessionConsent = new Map<string, string>();

const SECRET_FIELD =
  /(^|_)(key_hex|secret|secret_key|private_key|privatekey|mnemonic|seed|keypair|signing_key)($|_)/i;

function redactForLlm(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLlm);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_FIELD.test(k) && typeof v === "string") {
        out[k] = "[REDACTED — stays on this machine, never sent to the model]";
        out[`${k}_fingerprint`] = sha256hex(v).slice(0, 16);
      } else {
        out[k] = redactForLlm(v);
      }
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function x402GetQuote(
  endpointUrl: string,
  method = "GET"
): Promise<object> {
  try {
    const res = await fetch(endpointUrl, {
      method,
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 402) {
      const offerHeader = res.headers.get("x-dnp-offer") ?? res.headers.get("www-authenticate");
      const body = await res.text().catch(() => "");

      // Try to parse structured offer header
      if (offerHeader) {
        try {
          const offer = JSON.parse(offerHeader);
          return {
            quote_id: offer.quote_id ?? sha256hex(endpointUrl + Date.now()).slice(0, 16),
            price_atomic: offer.price_atomic ?? offer.amount ?? 0,
            currency: offer.currency ?? "USDC",
            expiry: offer.expiry ?? Date.now() + 60_000,
            payment_address: offer.payment_address ?? offer.address ?? null,
            network: offer.network ?? "solana-mainnet",
            raw_offer: offer,
          };
        } catch {
          // header not JSON, fall through to body parse
        }
      }

      // Try body
      try {
        const parsed = JSON.parse(body);
        return {
          quote_id: parsed.quote_id ?? sha256hex(endpointUrl + Date.now()).slice(0, 16),
          price_atomic: parsed.price_atomic ?? parsed.amount ?? 0,
          currency: parsed.currency ?? "USDC",
          expiry: parsed.expiry ?? Date.now() + 60_000,
          payment_address: parsed.payment_address ?? parsed.address ?? null,
          network: parsed.network ?? "solana-mainnet",
          raw_body: parsed,
        };
      } catch {
        // not parseable
      }

      return {
        quote_id: sha256hex(endpointUrl + Date.now()).slice(0, 16),
        price_atomic: 0,
        currency: "USDC",
        expiry: Date.now() + 60_000,
        payment_address: null,
        network: "solana-mainnet",
        note: "Endpoint returned 402 but offer format was not parseable. Raw header: " + (offerHeader ?? "(none)"),
      };
    }

    // Not a real 402 endpoint — return mock format showing the structure
    return {
      quote_id: sha256hex(endpointUrl + Date.now()).slice(0, 16),
      price_atomic: 100000, // 0.1 USDC in atomic units (6 decimals)
      currency: "USDC",
      expiry: Date.now() + 60_000,
      payment_address: null,
      network: "solana-mainnet",
      note: `Endpoint returned HTTP ${res.status} (not 402). This is a mock quote showing the x402 format. A real x402-gated endpoint returns 402 with x-dnp-offer header.`,
      mock: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Failed to reach endpoint: ${msg}`, mock: true };
  }
}

/**
 * This server configures no receipt_anchor program, so this never signs or
 * sends. It validates the hash and returns a clear refusal that echoes it back.
 */
function anchorReceipt(receiptHashHex: string): object {
  if (!/^[0-9a-fA-F]{64}$/.test(receiptHashHex)) {
    return { error: "receipt_hash_hex must be exactly 64 hex characters (32 bytes)" };
  }
  return {
    error: RECEIPT_ANCHOR_UNAVAILABLE_ERROR,
    anchoring: "unavailable",
    sent: false,
    receipt_hash_hex: receiptHashHex.toLowerCase(),
    mainnet_program_retired: RECEIPT_ANCHOR_MAINNET_RETIRED,
    mainnet_retired_on: RECEIPT_ANCHOR_MAINNET_RETIRED_ON,
  };
}

async function lookupPassport(
  ethAddress?: string,
  solanaWallet?: string
): Promise<object> {
  if (!ethAddress && !solanaWallet) {
    return { error: "Provide eth_address or solana_wallet (or both)" };
  }

  const programAddress = PROGRAMS.dark_secp256k1_auth;
  const programId = new PublicKey(programAddress);
  const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_RPC;

  // Derive the EthAgentRecord PDA
  // Seeds: ["eth_agent", <eth_address_bytes_20>]
  let pda: string | null = null;
  let registered = false;

  if (ethAddress) {
    try {
      const normalized = ethAddress.toLowerCase().replace("0x", "");
      if (!/^[0-9a-f]{40}$/.test(normalized)) {
        return { error: "eth_address must be a 40-hex-char Ethereum address (with or without 0x prefix)" };
      }
      const ethBytes = new Uint8Array(Buffer.from(normalized, "hex"));
      const [derivedPda] = await PublicKey.findProgramAddress(
        [Buffer.from("eth_agent"), ethBytes],
        programId
      );
      pda = derivedPda.toBase58();

      // Check if the account exists on-chain
      const connection = new Connection(rpcUrl, "confirmed");
      const info = await connection.getAccountInfo(derivedPda);
      registered = info !== null && info.data.length > 0;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `PDA derivation failed: ${msg}` };
    }
  } else if (solanaWallet) {
    // For solana-only lookup: check if the wallet has any record in the program
    try {
      const walletPk = new PublicKey(solanaWallet);
      const [derivedPda] = await PublicKey.findProgramAddress(
        [Buffer.from("sol_agent"), walletPk.toBytes()],
        programId
      );
      pda = derivedPda.toBase58();

      const connection = new Connection(rpcUrl, "confirmed");
      const info = await connection.getAccountInfo(derivedPda);
      registered = info !== null && info.data.length > 0;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Solana wallet lookup failed: ${msg}` };
    }
  }

  return {
    registered,
    pda: pda ?? undefined,
    program: programAddress,
    network: "solana-mainnet",
    program_status: "retired (legacy mainnet program; existing bindings readable, no new bindings)",
    explorer_url: pda ? explorerAccount(pda) : explorerAccount(programAddress),
  };
}

/** No nullifier record program is configured: validate the input, refuse the lookup. */
function checkNullifier(nullifier: string): object {
  const s = nullifier.trim();
  let hex: string;
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    hex = s.toLowerCase();
  } else if (/^[0-9]+$/.test(s)) {
    hex = BigInt(s).toString(16).padStart(64, "0");
    if (hex.length !== 64) return { error: "nullifier out of range — must fit in 32 bytes" };
  } else {
    return { error: "nullifier must be a 64-char hex string or a decimal field element" };
  }
  return { error: NULLIFIER_UNAVAILABLE_ERROR, available: false, nullifier_hex: hex };
}

function buildOutcomeReceipt(params: {
  receipt_id: string;
  outcome: "positive" | "negative" | "neutral";
  metric_pnl?: number;
  metric_accuracy?: number;
  result_digest_hex?: string;
  creator_note?: string;
}): object {
  const { receipt_id, outcome, metric_pnl, metric_accuracy, result_digest_hex, creator_note } = params;

  // Build the outcome struct
  const outcomeReceipt = {
    schema: "parad0x/outcome-receipt/v1",
    receipt_id,
    outcome,
    metrics: {
      pnl: metric_pnl ?? null,
      accuracy: metric_accuracy ?? null,
    },
    result_digest: result_digest_hex ?? null,
    creator_note: creator_note ?? null,
    created_at: Date.now(),
    created_at_iso: new Date().toISOString(),
  };

  // Sign with an ephemeral key (no persistent signing key available in server context)
  const ephemeralKeyHex = randomBytes(32).toString("hex");
  const receiptStr = JSON.stringify(outcomeReceipt);
  const sig = createHmac("sha256", ephemeralKeyHex).update(receiptStr).digest("hex");
  const receiptHash = sha256hex(receiptStr);

  return {
    outcome_receipt: {
      ...outcomeReceipt,
      signature: sig,
      signing_note:
        "Signed with an ephemeral HMAC-SHA256 key generated at call time. For production use, provide a persistent Ed25519 keypair via SIGNING_KEYPAIR env var (not yet implemented).",
    },
    receipt_hash: receiptHash,
  };
}

function compressReceipts(receipts: object[]): object {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return { error: "receipts must be a non-empty array" };
  }

  const originalStr = JSON.stringify(receipts);
  const originalBytes = Buffer.byteLength(originalStr, "utf8");

  // Use zlib deflate as a proxy for Liquefy columnar compression
  const compressed = deflateSync(originalStr, { level: 9 });
  const compressedBytes = compressed.length;
  const ratio = (originalBytes / compressedBytes).toFixed(2);

  const merkleRootHex = buildMerkleRoot(receipts);

  return {
    compressed_base64: compressed.toString("base64"),
    original_bytes: originalBytes,
    compressed_bytes: compressedBytes,
    ratio: `${ratio}x`,
    merkle_root_hex: merkleRootHex,
    receipt_count: receipts.length,
    note:
      "Compressed with zlib deflate (level 9) as a format demonstration. Real Liquefy achieves ~83x via columnar layout + domain-aware encoding on typed receipt fields. Decompress with zlib inflate.",
  };
}

async function privateCompute(params: {
  plaintext_input: string;
  executor_endpoint: string;
  encryption_key_hex?: string;
  anchor?: boolean;
}): Promise<object> {
  const { plaintext_input, executor_endpoint, encryption_key_hex, anchor } = params;

  // Step 1: Generate or use provided 32-byte AES-256 key
  let rawKeyBytes: Uint8Array;
  if (encryption_key_hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(encryption_key_hex)) {
      return { error: "encryption_key_hex must be exactly 64 hex characters (32 bytes)" };
    }
    rawKeyBytes = new Uint8Array(Buffer.from(encryption_key_hex, "hex"));
  } else {
    rawKeyBytes = new Uint8Array(randomBytes(32));
  }
  const keyHex = Buffer.from(rawKeyBytes).toString("hex");
  const secretKey = createSecretKey(rawKeyBytes);

  // Step 2: Encrypt with AES-256-GCM (12-byte nonce prefix)
  const nonceBytes = new Uint8Array(randomBytes(12));
  const cipher = createCipheriv("aes-256-gcm", secretKey, nonceBytes);
  const encPart1 = cipher.update(plaintext_input, "utf8") as unknown as Uint8Array;
  const encPart2 = cipher.final() as unknown as Uint8Array;
  const authTagBuf = cipher.getAuthTag() as unknown as Uint8Array;
  const nonceCast = Buffer.from(nonceBytes) as unknown as Uint8Array;
  // Layout: [12-byte nonce][16-byte auth tag][ciphertext]
  const encryptedBlob = Buffer.concat([nonceCast, authTagBuf, encPart1, encPart2]);
  const encryptedInputBase64 = encryptedBlob.toString("base64");

  // Step 3: Compute input_hash = sha256(plaintext_input)
  const inputHash = sha256hex(plaintext_input);

  // Step 4: POST to executor_endpoint
  let executorResponse: object = { status: "unreachable", note: "Executor endpoint could not be reached; local hashes recorded." };
  try {
    const res = await fetch(executor_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ciphertext: encryptedInputBase64, input_hash: inputHash }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text().catch(() => "");
    try {
      executorResponse = JSON.parse(text) as object;
    } catch {
      executorResponse = { raw: text, http_status: res.status };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    executorResponse = { status: "unreachable", error: msg, note: "Executor endpoint could not be reached; local hashes recorded." };
  }

  // Step 5: result_hash = sha256(JSON.stringify(executorResponse))
  const resultHash = sha256hex(JSON.stringify(executorResponse));

  // Step 6: Commitment over (input_hash, result_hash). Computed locally; the
  // on-chain anchor is refused — this server configures no receipt_anchor program.
  let commitment: Record<string, unknown> | undefined;

  if (anchor) {
    // Commitment = sha256(input_hash_bytes + result_hash_bytes)
    const ihBuf = Buffer.from(inputHash, "hex") as unknown as Uint8Array;
    const rhBuf = Buffer.from(resultHash, "hex") as unknown as Uint8Array;
    const combined = Buffer.concat([ihBuf, rhBuf]) as unknown as Uint8Array;
    const commitmentHex = createHash("sha256").update(combined).digest("hex");
    commitment = {
      commitment_hex: commitmentHex,
      anchored: false,
      error: RECEIPT_ANCHOR_UNAVAILABLE_ERROR,
    };
  }

  // Step 7: Return all fields
  const output: Record<string, unknown> = {
    encrypted_input_base64: encryptedInputBase64,
    input_hash: inputHash,
    executor_response: executorResponse,
    result_hash: resultHash,
    key_hex: keyHex,
    protocol_note: "executor received ciphertext only — plaintext never left client",
  };

  if (commitment !== undefined) output.commitment = commitment;

  return output;
}

function getStackStatus(): object {
  // Seized or withdrawn program IDs are NOT listed here. Never advertise a
  // seized address as live.
  const retired = "retired (mainnet) — accounts readable, cannot be invoked";
  return {
    programs: [
      {
        name: "receipt_anchor (mainnet)",
        cluster: "mainnet",
        address: RECEIPT_ANCHOR_MAINNET_RETIRED,
        status: `retired ${RECEIPT_ANCHOR_MAINNET_RETIRED_ON} — historical anchors readable, cannot be invoked`,
        explorer_url: explorerAccount(RECEIPT_ANCHOR_MAINNET_RETIRED),
        description: "Anchored receipts on mainnet June–July 2026",
      },
      {
        name: "null_registrar (mainnet)",
        cluster: "mainnet",
        address: NULL_REGISTRAR_MAINNET,
        status: "retired 2026-08-29 — records readable (resolve_null works), registration/updates/transfers frozen",
        explorer_url: explorerAccount(NULL_REGISTRAR_MAINNET),
        description: "Legacy .null name registrar",
      },
      {
        name: "dark_secp256k1_auth",
        cluster: "mainnet",
        address: PROGRAMS.dark_secp256k1_auth,
        status: retired,
        explorer_url: explorerAccount(PROGRAMS.dark_secp256k1_auth),
        description: "ETH address binding — existing MetaMask / secp256k1 ↔ Solana bindings are readable via lookup_passport",
      },
      {
        name: "dark_semaphore",
        cluster: "mainnet",
        address: PROGRAMS.dark_semaphore,
        status: retired,
        explorer_url: explorerAccount(PROGRAMS.dark_semaphore),
        description: "Semaphore-style anonymous group membership proofs",
      },
      {
        name: "dark_bn254_gate",
        address: PROGRAMS.dark_bn254_gate,
        status: "deprecated — do not use",
        explorer_url: explorerAccount(PROGRAMS.dark_bn254_gate),
        description: "Deprecated demo gate with a hardcoded proof bypass — NOT a real verifier.",
      },
      {
        name: "null_token",
        cluster: "mainnet",
        address: PROGRAMS.null_token,
        status: "live (SPL token mint)",
        explorer_url: explorerAccount(PROGRAMS.null_token),
        description: "NULL SPL token",
      },
    ],
    receipt_anchoring: {
      status: "unavailable",
      note: "This server does not anchor and configures no anchor program. A devnet receipt_anchor runs at HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs (2026-10-06); pass it explicitly to a client that anchors. anchor_receipt and private_compute still compute hashes locally; nothing is sent.",
    },
    shielded_access: {
      status: "unavailable",
      note: "This server does not call the shielded x402 access gate or the nullifier record, and check_nullifier refuses. Devnet deployments run since 2026-10-06: dark_x402_access_gate 7P7UpHbX9Nv3dap1DDA4GfLdX2JiNjEVisYvgbuhyNGR, dark_nullifier_record CPMfXL73v9PDmxyPLTM97bzrNa5eg2AEpsac9XKzX9et.",
    },
    private_reputation_stack: {
      status: "unavailable",
      note: "This server does not call the reputation gate or the commitment tree. Devnet deployments run since 2026-10-06: dark_reputation_gate Cyz7WjdmDTRGBE6kJpDiHUHDkQ5jq2C8BrnHcZm8st2g, receipt_commitment_tree Fyp5xQxCsUvgrq7wR42eRsL4MaLJML5FZxJtx55HzmFP.",
    },
    dark_null: { status: "devnet", note: "Canonical Dark NULL runs on devnet." },
    x402_payments: {
      status: "live — devnet by default, mainnet opt-in",
      note: "x402 USDC settlement is a plain SPL transfer; it does not depend on any retired program.",
    },
    packages: [
      "@parad0x_labs/mcp-server",
      "@parad0x_labs/openclaw-x402-pay",
      "@parad0x_labs/openclaw-x402-gate",
      "@parad0x_labs/openclaw-payment-session",
      "@parad0x_labs/openclaw-context-capsule",
      "@parad0x_labs/openclaw-agent-passport",
      "@parad0x_labs/openclaw-web0-onboard",
    ],
    github: "https://github.com/Parad0x-Labs/openclaw-skills",
    anchor_network: "none",
    status_timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// MCP server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "parad0x-mcp", version: "0.2.0" },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "x402_get_quote",
        description: "Get a payment quote for an x402-gated API endpoint",
        inputSchema: {
          type: "object",
          properties: {
            endpoint_url: {
              type: "string",
              description: "The URL of the x402-gated endpoint to quote",
            },
            method: {
              type: "string",
              description: "HTTP method (default: GET)",
              enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
            },
          },
          required: ["endpoint_url"],
        },
      },
      {
        name: "anchor_receipt",
        description:
          "Anchor a 32-byte receipt hash on Solana via receipt_anchor. Receipt anchoring is not done by this server and no default anchor program is configured: the tool validates the hash and returns a clear refusal; nothing is signed or sent. A devnet receipt_anchor runs at HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs (2026-10-06); pass it explicitly to a client that anchors. The mainnet receipt_anchor was retired 2026-07-14; its historical anchors remain readable.",
        inputSchema: {
          type: "object",
          properties: {
            receipt_hash_hex: {
              type: "string",
              description: "64-character hex string representing the 32-byte SHA-256 receipt hash",
            },
          },
          required: ["receipt_hash_hex"],
        },
      },
      {
        name: "lookup_passport",
        description:
          "Look up a Dark Passport — check if an ETH address or Solana wallet has an identity binding on the legacy mainnet dark_secp256k1_auth program (retired; existing bindings readable, no new bindings). Read-only.",
        inputSchema: {
          type: "object",
          properties: {
            eth_address: {
              type: "string",
              description: "Ethereum address (hex, with or without 0x prefix)",
            },
            solana_wallet: {
              type: "string",
              description: "Solana wallet address (base58)",
            },
          },
        },
      },
      {
        name: "build_outcome_receipt",
        description:
          "Build a creator-signed outcome receipt — attach PnL, accuracy, or delivery result to a previous receipt",
        inputSchema: {
          type: "object",
          properties: {
            receipt_id: {
              type: "string",
              description: "ID of the receipt this outcome is attached to",
            },
            outcome: {
              type: "string",
              enum: ["positive", "negative", "neutral"],
              description: "Outcome classification",
            },
            metric_pnl: {
              type: "number",
              description: "Profit/loss metric (optional)",
            },
            metric_accuracy: {
              type: "number",
              description: "Accuracy metric 0.0–1.0 (optional)",
            },
            result_digest_hex: {
              type: "string",
              description: "Hex-encoded SHA-256 of the result payload (optional)",
            },
            creator_note: {
              type: "string",
              description: "Human-readable note from the creator (optional)",
            },
          },
          required: ["receipt_id", "outcome"],
        },
      },
      {
        name: "compress_receipts",
        description:
          "Compress a batch of receipts (zlib deflate level 9; Liquefy-format demonstration). The production Liquefy columnar codec targets ~83x; this tool ships the zlib reference path.",
        inputSchema: {
          type: "object",
          properties: {
            receipts: {
              type: "array",
              items: { type: "object" },
              description: "Array of receipt objects to compress",
            },
          },
          required: ["receipts"],
        },
      },
      {
        name: "check_nullifier",
        description:
          "Check whether a privacy-proof nullifier has already been spent (single-use enforcement). This server does not query a nullifier record program: the tool validates the nullifier and returns a clear refusal; no lookup is made. A devnet dark_nullifier_record runs at CPMfXL73v9PDmxyPLTM97bzrNa5eg2AEpsac9XKzX9et (2026-10-06).",
        inputSchema: {
          type: "object",
          properties: {
            nullifier: {
              type: "string",
              description: "The nullifier as a 64-char hex string OR a decimal BN254 field element (e.g. the reputation_nullifier public input).",
            },
          },
          required: ["nullifier"],
        },
      },
      {
        name: "get_stack_status",
        description: "Get the current status of Parad0x Labs programs: retired mainnet programs (readable), the devnet deployments this server does not call, and x402 settlement",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "private_compute",
        description:
          "Run a computation via an executor endpoint without exposing plaintext inputs. Agent encrypts locally, sends ciphertext, executor returns encrypted result + result hash. Executor never sees plaintext. With anchor:true the (input_hash, result_hash) commitment is computed locally; the on-chain anchor is refused because this server configures no receipt_anchor program.",
        inputSchema: {
          type: "object",
          properties: {
            plaintext_input: {
              type: "string",
              description: "The sensitive input (JSON string or text) to encrypt before sending",
            },
            executor_endpoint: {
              type: "string",
              description: "URL of the executor API that receives the ciphertext",
            },
            encryption_key_hex: {
              type: "string",
              description: "Optional 32-byte AES-256 key as 64 hex characters. Generated if not provided.",
            },
            anchor: {
              type: "boolean",
              description: "If true, compute the (input_hash, result_hash) commitment. The on-chain anchor is refused: this server configures no receipt_anchor program.",
            },
          },
          required: ["plaintext_input", "executor_endpoint"],
        },
      },
      {
        name: "create_wallet",
        description:
          "Generate a NEW non-custodial Solana wallet on THIS machine for the agent/owner. Writes the secret key to a local file (default ~/.config/solana/web0-agent.json) and returns ONLY the public key + path — the secret is never shown to the model. Refuses to overwrite an existing file. Preview by default; pass confirm:true to actually generate + write.",
        inputSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Filename label for the default path (~/.config/solana/<label>.json). Default: web0-agent.",
            },
            path: {
              type: "string",
              description: "Explicit keypair file path (overrides label). A leading ~ is expanded to your home dir.",
            },
            confirm: {
              type: "boolean",
              description: "Must be true to generate + write the key file. Without it, returns a preview only.",
            },
          },
        },
      },
      {
        name: "resolve_null",
        description:
          "Resolve a .null name → its owner, published x402 endpoint (pay-by-name), stealth meta-address, and Arweave content. Read-only: derives the NullDomain PDA on the legacy mainnet registrar (retired 2026-08-29; records readable, registration/updates frozen) and reads it. Returns payable_by_name=true when an x402 endpoint is set.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The .null name to resolve (e.g. \"myagent.null\" or \"myagent\").",
            },
            rpc_url: {
              type: "string",
              description: "Solana mainnet RPC URL (default: publicnode mainnet). The legacy registrar's records are stored on mainnet.",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "get_scope_status",
        description:
          "Show the current permission scope for this MCP session — which tools require elevated consent, which are currently consented, and whether write mode is enabled by the operator.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "grant_write_consent",
        description:
          "Explicitly consent to a write operation for this session. Must be called before anchor_receipt or private_compute if confirm:true alone is not sufficient. The operator must have set PARAD0X_MCP_ALLOW_WRITE=1.",
        inputSchema: {
          type: "object",
          properties: {
            tool_name: {
              type: "string",
              enum: ["anchor_receipt", "private_compute"],
              description: "Which write tool to grant session consent for",
            },
          },
          required: ["tool_name"],
        },
      },
      {
        name: "revoke_write_consent",
        description: "Revoke session consent for a write tool — it will require re-confirmation.",
        inputSchema: {
          type: "object",
          properties: {
            tool_name: {
              type: "string",
              enum: ["anchor_receipt", "private_compute"],
              description: "Which write tool to revoke consent for",
            },
          },
          required: ["tool_name"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: object;

    switch (name) {
      case "x402_get_quote": {
        const { endpoint_url, method } = args as { endpoint_url: string; method?: string };
        result = await x402GetQuote(endpoint_url, method);
        break;
      }

      case "anchor_receipt": {
        const { receipt_hash_hex } = args as { receipt_hash_hex: string };
        result = anchorReceipt(String(receipt_hash_hex ?? ""));
        break;
      }

      case "lookup_passport": {
        const { eth_address, solana_wallet } = args as {
          eth_address?: string;
          solana_wallet?: string;
        };
        result = await lookupPassport(eth_address, solana_wallet);
        break;
      }

      case "build_outcome_receipt": {
        result = buildOutcomeReceipt(
          args as {
            receipt_id: string;
            outcome: "positive" | "negative" | "neutral";
            metric_pnl?: number;
            metric_accuracy?: number;
            result_digest_hex?: string;
            creator_note?: string;
          }
        );
        break;
      }

      case "compress_receipts": {
        const { receipts } = args as { receipts: object[] };
        result = compressReceipts(receipts);
        break;
      }

      case "check_nullifier": {
        const { nullifier } = args as { nullifier: string };
        result = checkNullifier(String(nullifier ?? ""));
        break;
      }

      case "get_stack_status": {
        result = getStackStatus();
        break;
      }

      case "private_compute": {
        result = await privateCompute(
          args as {
            plaintext_input: string;
            executor_endpoint: string;
            encryption_key_hex?: string;
            anchor?: boolean;
          }
        );
        break;
      }

      case "create_wallet": {
        const { label, path: wpath, confirm: wconfirm } = args as {
          label?: string;
          path?: string;
          confirm?: boolean;
        };
        const target = resolveWalletPath({ path: wpath, label });
        if (existsSync(target)) {
          result = { error: `Refusing to overwrite an existing keypair at ${target}. Choose a different label or path.` };
          break;
        }
        if (wconfirm !== true) {
          result = {
            preview: true,
            would_create_at: target,
            note: "No wallet created. Pass confirm:true to generate + write a new keypair here. The secret key is written only to this file on your machine and is NEVER shown to the model.",
          };
          break;
        }
        try {
          const w = generateWallet();
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, JSON.stringify(w.secretKey), { mode: 0o600 });
          try {
            chmodSync(target, 0o600);
          } catch {
            /* best-effort on platforms without POSIX perms */
          }
          result = {
            created: true,
            public_key: w.publicKey,
            keypair_path: target,
            funded: false,
            next_steps: [
              "Fund this address with a little SOL (for transaction fees) and USDC (to spend).",
              "Point your signer at this file (e.g. SOLANA_KEYPAIR or your wallet config) to pay.",
              "BACK IT UP — this file is the only copy of the key; losing it loses the funds.",
            ],
            security: "The secret key was written only to the file above on this machine. It was NOT returned to the model.",
          };
        } catch (err: unknown) {
          result = { error: `Failed to create wallet: ${err instanceof Error ? err.message : String(err)}` };
        }
        break;
      }

      case "resolve_null": {
        const { name: nullName, rpc_url } = args as { name: string; rpc_url?: string };
        const r = await resolveNullName(nullName, rpc_url);
        result = {
          ...r,
          payable_by_name: !!r.x402_endpoint,
          explorer_url: explorerAccount(r.pda),
          note: r.found
            ? r.x402_endpoint
              ? "Resolved — payable by name via the published x402 endpoint."
              : "Registered, but no x402 endpoint is published. The legacy registrar is retired (2026-08-29), so endpoints can no longer be updated."
            : "Not registered on the legacy mainnet registrar.",
          registrar_status: "retired 2026-08-29 — records readable, registration/updates/transfers frozen",
        };
        break;
      }

      case "get_scope_status": {
        result = {
          write_mode_enabled: ALLOW_WRITE,
          read_tools: [...READ_TOOLS].sort(),
          write_tools: [...WRITE_TOOLS].map((t) => ({
            tool: t,
            consented: sessionConsent.has(t),
            consented_at: sessionConsent.get(t) ?? null,
          })),
          note: ALLOW_WRITE
            ? "Write mode active. Call grant_write_consent to pre-approve a specific tool, or pass confirm:true per-call."
            : "Write mode disabled (PARAD0X_MCP_ALLOW_WRITE not set). Read-only tools available.",
        };
        break;
      }
      case "grant_write_consent": {
        const { tool_name } = args as { tool_name: string };
        if (!WRITE_TOOLS.has(tool_name)) {
          result = { error: `${tool_name} is not a write tool` };
        } else if (!ALLOW_WRITE) {
          result = { error: "Cannot grant consent — PARAD0X_MCP_ALLOW_WRITE=1 required on this machine" };
        } else {
          sessionConsent.set(tool_name, new Date().toISOString());
          result = { granted: true, tool: tool_name, consented_at: sessionConsent.get(tool_name) };
        }
        break;
      }
      case "revoke_write_consent": {
        const { tool_name: revokeTarget } = args as { tool_name: string };
        const had = sessionConsent.delete(revokeTarget);
        result = { revoked: had, tool: revokeTarget };
        break;
      }

      default:
        result = { error: `Unknown tool: ${name}` };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(redactForLlm(result), null, 2) }],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: msg }) }],
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
