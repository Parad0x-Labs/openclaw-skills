/**
 * agent-passport — host-free core.
 *
 * All identity logic (program IDs, PDA derivation, config parsing, the two tool
 * definitions) lives here with NO `openclaw/*` host import, so this module loads
 * and unit-tests standalone. `index.ts` is a thin wrapper that hands these tools
 * to the OpenClaw plugin loader. Mirrors the openclaw-skills convention where
 * testable logic sits in a host-free sibling module.
 *
 * Trust model:
 *   - READ-ONLY. No transactions, no signing, no private-key access. The
 *     identity programs it reads are retired mainnet programs: their accounts
 *     (existing bindings) stay readable, but nothing can be invoked, so no new
 *     bindings can be created. This plugin has no write path.
 *   - PUBLIC RPC ONLY. solana-rpc.publicnode.com by default — never
 *     api.mainnet-beta.solana.com (returns 403 with an Origin header).
 *   - No hardcoded seized or pre-incident program IDs.
 */

import { Connection, PublicKey } from "@solana/web3.js";

// ── Program IDs — legacy mainnet deployments (retired; accounts readable) ─────
// Lookups here are read-only account-existence checks against existing bindings.
// Do NOT add dark_x402_access_gate, dark_nullifier_record or the secp256r1
// vault here — those programs are attacker-controlled. The WebAuthn vault
// lookup was removed in 0.2.0 for that reason.

// The retired mainnet receipt_anchor program is closed and no longer listed: this
// plugin never read it, and no receipt_anchor deployment is configured.
export const DARK_SECP256K1_AUTH = "AqwBbV13AoczhoELwP8oxT3nDqB6MsLWXauNzHkssZ9B";

export const PROGRAMS = {
  dark_secp256k1_auth: DARK_SECP256K1_AUTH,
} as const;

/** Current status of each program above — returned alongside every lookup. */
export const PROGRAM_STATUS = {
  dark_secp256k1_auth:
    "retired (mainnet) — existing ETH↔Solana bindings readable; no new bindings can be created",
} as const satisfies Record<keyof typeof PROGRAMS, string>;

// Public RPC — never api.mainnet-beta.solana.com (403s with Origin header)
export const DEFAULT_RPC = "https://solana-rpc.publicnode.com";

// ── Config ──────────────────────────────────────────────────────────────────

export interface AgentPassportConfig {
  solanaWallet?: string;
  ethAddress?: string;
  nullName?: string;
  rpcUrl?: string;
}

export function readConfig(raw: Record<string, unknown> | undefined): AgentPassportConfig {
  const cfg = raw ?? {};
  return {
    solanaWallet: typeof cfg.solanaWallet === "string" ? cfg.solanaWallet : undefined,
    ethAddress: typeof cfg.ethAddress === "string" ? cfg.ethAddress : undefined,
    nullName: typeof cfg.nullName === "string" ? cfg.nullName : undefined,
    rpcUrl: typeof cfg.rpcUrl === "string" ? cfg.rpcUrl : undefined,
  };
}

// ── PDA derivation (pure — no network) ───────────────────────────────────────

/**
 * Derive the ETH-binding PDA for a hex ETH address on dark_secp256k1_auth.
 * Seeds: ["eth_agent", <20-byte eth address>]. Accepts "0x"-prefixed or bare
 * hex; returns null if malformed.
 */
export function deriveEthBindingPda(ethAddress: string): string | null {
  try {
    const hex = ethAddress.startsWith("0x") ? ethAddress.slice(2) : ethAddress;
    if (hex.length !== 40) return null;
    const addrBytes = Buffer.from(hex, "hex");
    if (addrBytes.length !== 20) return null;

    const programId = new PublicKey(DARK_SECP256K1_AUTH);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("eth_agent"), addrBytes],
      programId,
    );
    return pda.toBase58();
  } catch {
    return null;
  }
}

/**
 * Derive the Solana-wallet PDA on dark_secp256k1_auth.
 * Seeds: ["sol_agent", <wallet pubkey bytes>]. Null if malformed.
 */
export function deriveSolAgentPda(solanaWallet: string): string | null {
  try {
    const walletKey = new PublicKey(solanaWallet);
    const programId = new PublicKey(DARK_SECP256K1_AUTH);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("sol_agent"), walletKey.toBytes()],
      programId,
    );
    return pda.toBase58();
  } catch {
    return null;
  }
}

/** True if a PDA account exists on-chain (any non-null account counts). */
export async function accountExists(connection: Connection, pda: string): Promise<boolean> {
  try {
    const info = await connection.getAccountInfo(new PublicKey(pda));
    return info !== null;
  } catch {
    return false;
  }
}

// ── Tool definitions ─────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Build the two read-only identity tools for a given config. Pure factory — no
 * host dependency — so the tool set is unit-testable. Handlers open a Connection
 * to the configured (public) RPC only when invoked.
 */
export function buildPassportTools(config: AgentPassportConfig): ToolDef[] {
  const rpcUrl = config.rpcUrl ?? DEFAULT_RPC;

  const getAgentPassport: ToolDef = {
    name: "get_agent_passport",
    description:
      "Return this agent's on-chain identity record: .null name, Solana wallet, " +
      "ETH address, derived PDAs, and whether the binding accounts exist on-chain. " +
      "Reads existing bindings on the legacy mainnet identity programs (retired; " +
      "accounts readable). Read-only — no signing or transactions.",
    parameters: {},
    async handler(_params: Record<string, unknown>) {
      const connection = new Connection(rpcUrl, "confirmed");

      const ethBindingPda = config.ethAddress
        ? deriveEthBindingPda(config.ethAddress)
        : null;

      const ethBindingRegistered = ethBindingPda
        ? await accountExists(connection, ethBindingPda)
        : false;

      return {
        null_name: config.nullName ?? null,
        solana_wallet: config.solanaWallet ?? null,
        eth_address: config.ethAddress ?? null,
        eth_binding_pda: ethBindingPda,
        eth_binding_registered: ethBindingRegistered,
        network: "solana-mainnet" as const,
        programs: PROGRAMS,
        program_status: PROGRAM_STATUS,
      };
    },
  };

  const verifyAgentIdentity: ToolDef = {
    name: "verify_agent_identity",
    description:
      "Verify a DIFFERENT agent's on-chain identity. Supply at least one of " +
      "`target_solana_wallet`, `target_eth_address`, or `target_null_name`. " +
      "Returns whether the corresponding PDAs are registered on-chain (existing " +
      "bindings on the retired legacy mainnet identity programs stay readable). " +
      "Read-only — no signing or transactions.",
    parameters: {
      target_solana_wallet: {
        type: "string",
        description: "Target agent's Solana wallet address (base58 public key).",
      },
      target_eth_address: {
        type: "string",
        description: "Target agent's ETH address (hex, with or without 0x prefix).",
      },
      target_null_name: {
        type: "string",
        description:
          "Target agent's .null name (e.g. otheragent.null). " +
          "Informational — passed through; this tool checks identity PDAs, not name resolution.",
      },
    },
    async handler(params: Record<string, unknown>) {
      const targetWallet =
        typeof params.target_solana_wallet === "string" ? params.target_solana_wallet : undefined;
      const targetEth =
        typeof params.target_eth_address === "string" ? params.target_eth_address : undefined;
      const targetNull =
        typeof params.target_null_name === "string" ? params.target_null_name : undefined;

      if (!targetWallet && !targetEth && !targetNull) {
        return {
          ok: false,
          error:
            "Provide at least one of: target_solana_wallet, target_eth_address, target_null_name.",
        };
      }

      const connection = new Connection(rpcUrl, "confirmed");

      const ethBindingPda = targetEth ? deriveEthBindingPda(targetEth) : null;
      const solAgentPda = targetWallet ? deriveSolAgentPda(targetWallet) : null;

      const [ethBindingRegistered, solAgentRegistered] = await Promise.all([
        ethBindingPda ? accountExists(connection, ethBindingPda) : Promise.resolve(false),
        solAgentPda ? accountExists(connection, solAgentPda) : Promise.resolve(false),
      ]);

      return {
        ok: true,
        target: {
          null_name: targetNull ?? null,
          solana_wallet: targetWallet ?? null,
          eth_address: targetEth ?? null,
        },
        pdas: {
          eth_binding_pda: ethBindingPda,
          sol_agent_pda: solAgentPda,
        },
        registered: {
          eth_binding: ethBindingRegistered,
          sol_agent: solAgentRegistered,
        },
        network: "solana-mainnet" as const,
        programs: PROGRAMS,
        program_status: PROGRAM_STATUS,
      };
    },
  };

  return [getAgentPassport, verifyAgentIdentity];
}
