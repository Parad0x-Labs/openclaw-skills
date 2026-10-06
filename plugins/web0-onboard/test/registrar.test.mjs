/**
 * Byte-exact tests for the registrar instruction encoders (../dist/registrar.js).
 * Hermetic — no network. Asserts the verified ABI: discriminators, data layout,
 * account order + flags, PDA derivation (known on-chain vectors), config parsing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  NULL_REGISTRAR_MAINNET,
  NULL_REGISTRAR_MAINNET_RETIRED_AT,
  REGISTRAR_RETIRED_ERROR,
  isRetiredRegistrar,
  readDomainOwner,
  deriveConfigPda,
  IX_REGISTER,
  IX_UPDATE_ENDPOINT,
  IX_SET_STEALTH_META,
  CURRENCY_SOL,
  validateName,
  padName64,
  deriveDomainPda,
  parseRegistryConfig,
  buildRegisterIx,
  buildUpdateEndpointIx,
  buildSetStealthMetaIx,
  buildRegistrarTools,
} from "../dist/registrar.js";

const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
// A non-retired registrar id (stands in for a devnet deployment).
const CUSTOM_REGISTRAR = new PublicKey(Buffer.alloc(32, 7)).toBase58();
// Unroutable RPC: any accidental network call fails loudly instead of passing.
const DEAD_RPC = "http://127.0.0.1:9";
const META = "ab".repeat(64);

/** A signer that fails the test if anything ever asks it to sign. */
const tripwireSigner = () => ({
  publicKey: WALLET,
  signTransaction: async () => {
    throw new Error("signer must not be called");
  },
});

/**
 * Minimal loopback JSON-RPC server (no external network): answers getAccountInfo
 * from `accounts` (base58 → Buffer), null otherwise.
 */
async function withLoopbackRpc(accounts, fn) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body);
      calls.push(msg.method + ":" + (msg.params?.[0] ?? ""));
      let result = null;
      if (msg.method === "getAccountInfo") {
        const data = accounts[msg.params[0]];
        result = {
          context: { slot: 1 },
          value: data
            ? {
                data: [data.toString("base64"), "base64"],
                executable: false,
                lamports: 1_000_000,
                owner: SystemProgram.programId.toBase58(),
                rentEpoch: 0,
                space: data.length,
              }
            : null,
        };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, calls);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ── name + PDA ────────────────────────────────────────────────────────────────

test("registrar is the clean mainnet id", () => {
  assert.equal(NULL_REGISTRAR_MAINNET, "NXgQhepFpDCu935H1D4g34g59ZYbo1jR4tBCZWhV8Np");
});

test("the mainnet registrar is flagged retired (2026-08-29); other ids are not", () => {
  assert.equal(NULL_REGISTRAR_MAINNET_RETIRED_AT, "2026-08-29");
  assert.ok(isRetiredRegistrar(NULL_REGISTRAR_MAINNET));
  assert.ok(!isRetiredRegistrar(CUSTOM_REGISTRAR));
  assert.match(REGISTRAR_RETIRED_ERROR, /retired on 2026-08-29/);
  assert.match(REGISTRAR_RETIRED_ERROR, /resolve read-only/);
  assert.match(REGISTRAR_RETIRED_ERROR, /frozen until the registrar relaunch/);
});

test("validateName mirrors the program rules (4-32, a-z/0-9/-)", () => {
  assert.ok(validateName("myagent").ok);
  assert.ok(validateName("my-agent.null").ok); // suffix stripped
  assert.ok(!validateName("ab").ok); // too short
  assert.ok(!validateName("Bad_Name").ok); // uppercase/underscore
  assert.ok(!validateName("x".repeat(33)).ok); // too long
});

test("padName64 is 64 bytes, null-padded", () => {
  const b = padName64("web0");
  assert.equal(b.length, 64);
  assert.equal(b.subarray(0, 4).toString("utf8"), "web0");
  assert.ok(b.subarray(4).every((x) => x === 0));
});

test("deriveDomainPda matches known on-chain PDAs", () => {
  assert.equal(deriveDomainPda("web0").toBase58(), "FJ5kcbFxU6pEVdUHcpvu6hX8CYfTd4LAvhHdiPcK1FG3");
  assert.equal(deriveDomainPda("parad0x").toBase58(), "HTPbRoV9ERectjC8soyukEsr2JNUG595FLE4a6SPnmS3");
});

// ── REGISTER 0x02 ─────────────────────────────────────────────────────────────

test("buildRegisterIx (free pilot): data + 5 accounts in exact order", () => {
  const ix = buildRegisterIx({ payer: WALLET, name: "myagent" });
  // data: 0x02 | name[64] | arweave[32]=0 | currency[1]=SOL  → 98 bytes
  assert.equal(ix.data.length, 1 + 64 + 32 + 1);
  assert.equal(ix.data[0], IX_REGISTER);
  assert.equal(ix.data.subarray(1, 5).toString("utf8"), "myag".slice(0, 4)); // name starts at 1
  assert.ok(ix.data.subarray(65, 97).every((b) => b === 0)); // arweave zero
  assert.equal(ix.data[97], CURRENCY_SOL);
  assert.equal(ix.programId.toBase58(), NULL_REGISTRAR_MAINNET);

  const k = ix.keys;
  assert.equal(k.length, 5);
  assert.equal(k[0].pubkey.toBase58(), WALLET);
  assert.ok(k[0].isSigner && k[0].isWritable); // payer
  assert.ok(!k[1].isSigner && k[1].isWritable); // domain
  assert.ok(!k[2].isSigner && k[2].isWritable); // config
  assert.equal(k[3].pubkey.toBase58(), SystemProgram.programId.toBase58());
  assert.ok(!k[3].isSigner && !k[3].isWritable); // system
  assert.ok(!k[4].isSigner && k[4].isWritable); // owner_cap LAST
});

test("buildRegisterIx (SOL fee): treasury inserted before owner_cap (6 accounts)", () => {
  const treasury = "11111111111111111111111111111112";
  const ix = buildRegisterIx({ payer: WALLET, name: "myagent", treasury });
  const k = ix.keys;
  assert.equal(k.length, 6);
  assert.equal(k[4].pubkey.toBase58(), treasury); // treasury at index 4
  assert.ok(k[4].isWritable);
  // owner_cap is still last (index 5)
  assert.ok(!k[5].isSigner && k[5].isWritable);
  assert.notEqual(k[5].pubkey.toBase58(), treasury);
});

// ── UPDATE_ENDPOINT 0x06 ──────────────────────────────────────────────────────

test("buildUpdateEndpointIx: data + 2 accounts (owner signer, domain writable)", () => {
  const endpoint = "https://api.myagent.dev/x402";
  const ix = buildUpdateEndpointIx({ owner: WALLET, name: "myagent", endpoint });
  assert.equal(ix.data.length, 1 + 64 + 128); // 193
  assert.equal(ix.data[0], IX_UPDATE_ENDPOINT);
  assert.equal(ix.data.subarray(65, 65 + endpoint.length).toString("utf8"), endpoint);
  assert.ok(ix.data.subarray(65 + endpoint.length, 193).every((b) => b === 0)); // padded
  const k = ix.keys;
  assert.equal(k.length, 2);
  assert.ok(k[0].isSigner && !k[0].isWritable); // owner signs, not writable
  assert.equal(k[0].pubkey.toBase58(), WALLET);
  assert.ok(!k[1].isSigner && k[1].isWritable); // domain writable
  assert.equal(k[1].pubkey.toBase58(), deriveDomainPda("myagent").toBase58());
});

test("buildUpdateEndpointIx rejects an oversize endpoint", () => {
  assert.throws(() => buildUpdateEndpointIx({ owner: WALLET, name: "myagent", endpoint: "x".repeat(129) }), /128 bytes/);
});

// ── SET_STEALTH_META 0x0C ─────────────────────────────────────────────────────

test("buildSetStealthMetaIx: data + 3 accounts (owner, domain, system)", () => {
  const meta = "ab".repeat(64); // 64 bytes hex
  const ix = buildSetStealthMetaIx({ owner: WALLET, name: "myagent", stealthMetaHex: meta });
  assert.equal(ix.data.length, 1 + 64 + 64); // 129
  assert.equal(ix.data[0], IX_SET_STEALTH_META);
  assert.equal(ix.data.subarray(65, 129).toString("hex"), meta);
  const k = ix.keys;
  assert.equal(k.length, 3);
  assert.ok(k[0].isSigner && k[0].isWritable); // owner pays rent top-up
  assert.ok(!k[1].isSigner && k[1].isWritable); // domain
  assert.equal(k[2].pubkey.toBase58(), SystemProgram.programId.toBase58());
});

test("buildSetStealthMetaIx rejects bad hex length", () => {
  assert.throws(() => buildSetStealthMetaIx({ owner: WALLET, name: "myagent", stealthMetaHex: "abcd" }), /64 bytes/);
});

// ── config parse ──────────────────────────────────────────────────────────────

test("parseRegistryConfig reads sol_fee@33, null_fee@41, treasury@81", () => {
  const buf = Buffer.alloc(122);
  buf.writeBigUInt64LE(7_000_000n, 33); // 0.007 SOL
  buf.writeBigUInt64LE(0n, 41);
  const treasuryPk = new PublicKey(WALLET);
  treasuryPk.toBytes().forEach((b, i) => (buf[81 + i] = b));
  const cfg = parseRegistryConfig(buf);
  assert.equal(cfg.solFeeLamports, 7_000_000n);
  assert.equal(cfg.nullFeeAmount, 0n);
  assert.equal(cfg.treasury, WALLET);
});

// ── tool factory ──────────────────────────────────────────────────────────────

test("buildRegistrarTools registers the three seller tools", () => {
  const tools = buildRegistrarTools({ solanaWallet: WALLET }, () => null);
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["register_null_name", "set_null_endpoint", "set_null_stealth_meta"],
  );
});

test("set_null_endpoint rejects a non-URL endpoint without touching the network", async () => {
  const [, setEndpoint] = buildRegistrarTools(
    { solanaWallet: WALLET, registrar: CUSTOM_REGISTRAR, rpcUrl: DEAD_RPC },
    () => null,
  );
  const res = await setEndpoint.handler({ name: "myagent", endpoint: "ftp://nope" });
  assert.equal(res.ok, false);
  assert.match(res.error, /http\(s\) URL/);
});

test("register_null_name errors when no payer/signer is available", async () => {
  const [register] = buildRegistrarTools({ registrar: CUSTOM_REGISTRAR, rpcUrl: DEAD_RPC }, () => null);
  const res = await register.handler({ name: "myagent" });
  assert.equal(res.ok, false);
  assert.match(res.error, /signer|solanaWallet/);
});

// ── retired mainnet registrar: writes refuse, reads still work ────────────────

test("write tools refuse on the default (retired) mainnet registrar — dryRun included, no RPC, no signing", async () => {
  const calls = [
    ["register_null_name", { name: "myagent" }],
    ["set_null_endpoint", { name: "myagent", endpoint: "https://api.myagent.dev/x402" }],
    ["set_null_stealth_meta", { name: "myagent", stealth_meta_hex: META }],
  ];
  for (const explicit of [false, true]) {
    const cfg = { solanaWallet: WALLET, rpcUrl: DEAD_RPC };
    if (explicit) cfg.registrar = NULL_REGISTRAR_MAINNET; // explicitly naming it is refused too
    for (const signer of [null, tripwireSigner()]) {
      const tools = buildRegistrarTools(cfg, () => signer);
      for (const [toolName, params] of calls) {
        const tool = tools.find((t) => t.name === toolName);
        for (const dryRun of [true, false, undefined]) {
          const res = await tool.handler({ ...params, dryRun });
          assert.equal(res.ok, false, `${toolName} dryRun=${dryRun} must refuse`);
          assert.equal(res.error, REGISTRAR_RETIRED_ERROR);
          assert.equal(res.registrar, NULL_REGISTRAR_MAINNET);
          assert.equal(res.retired_at, "2026-08-29");
          assert.equal(res.read_only, true);
          assert.equal(res.dry_run, undefined); // no fee quote / preview of an impossible tx
          assert.equal(res.fee_lamports, undefined);
        }
      }
    }
  }
});

test("write tools refuse on the retired registrar even with invalid input (refusal comes first)", async () => {
  const [register] = buildRegistrarTools({}, () => null);
  const res = await register.handler({ name: "x", dryRun: true });
  assert.equal(res.ok, false);
  assert.equal(res.error, REGISTRAR_RETIRED_ERROR);
});

test("write tool descriptions state the retirement; none claims a live mainnet registrar", () => {
  for (const t of buildRegistrarTools({}, () => null)) {
    assert.match(t.description, /retired 2026-08-29/);
    assert.match(t.description, /read-only/);
    assert.doesNotMatch(t.description, /LIVE|live mainnet|on Solana mainnet/);
  }
});

test("readDomainOwner still reads the retired mainnet registrar (accounts persist)", async () => {
  const domain = Buffer.alloc(200);
  new PublicKey(WALLET).toBytes().forEach((b, i) => (domain[65 + i] = b));
  const pda = deriveDomainPda("web0").toBase58(); // default = mainnet registrar
  await withLoopbackRpc({ [pda]: domain }, async (rpc) => {
    const conn = new Connection(rpc, "confirmed");
    const hit = await readDomainOwner(conn, "web0", NULL_REGISTRAR_MAINNET);
    assert.deepEqual(hit, { pda, exists: true, owner: WALLET });
    const miss = await readDomainOwner(conn, "nobody-here", NULL_REGISTRAR_MAINNET);
    assert.equal(miss.exists, false);
  });
});

// ── custom (deployed) registrar: writes still build ───────────────────────────

test("encoders target a custom registrar when given one", () => {
  const ix = buildRegisterIx({ payer: WALLET, name: "myagent", registrar: CUSTOM_REGISTRAR });
  assert.equal(ix.programId.toBase58(), CUSTOM_REGISTRAR);
  assert.equal(ix.keys[1].pubkey.toBase58(), deriveDomainPda("myagent", CUSTOM_REGISTRAR).toBase58());
  assert.notEqual(ix.keys[1].pubkey.toBase58(), deriveDomainPda("myagent").toBase58());
  const up = buildUpdateEndpointIx({ owner: WALLET, name: "myagent", endpoint: "https://a.dev/x", registrar: CUSTOM_REGISTRAR });
  assert.equal(up.programId.toBase58(), CUSTOM_REGISTRAR);
  const st = buildSetStealthMetaIx({ owner: WALLET, name: "myagent", stealthMetaHex: META, registrar: CUSTOM_REGISTRAR });
  assert.equal(st.programId.toBase58(), CUSTOM_REGISTRAR);
});

test("set_null_endpoint / set_null_stealth_meta preview against a custom registrar (no network)", async () => {
  const tools = buildRegistrarTools(
    { solanaWallet: WALLET, registrar: CUSTOM_REGISTRAR, rpcUrl: DEAD_RPC },
    () => tripwireSigner(),
  );
  const ep = await tools.find((t) => t.name === "set_null_endpoint").handler({
    name: "myagent",
    endpoint: "https://api.myagent.dev/x402",
    dryRun: true,
  });
  assert.equal(ep.ok, true);
  assert.equal(ep.dry_run, true);
  assert.equal(ep.registrar, CUSTOM_REGISTRAR);
  assert.equal(ep.pda, deriveDomainPda("myagent", CUSTOM_REGISTRAR).toBase58());

  const sm = await tools.find((t) => t.name === "set_null_stealth_meta").handler({
    name: "myagent",
    stealth_meta_hex: META,
    dryRun: true,
  });
  assert.equal(sm.ok, true);
  assert.equal(sm.dry_run, true);
  assert.equal(sm.registrar, CUSTOM_REGISTRAR);
  assert.equal(sm.pda, deriveDomainPda("myagent", CUSTOM_REGISTRAR).toBase58());

  // Without a signer it is still a preview, and says so.
  const noSigner = buildRegistrarTools({ solanaWallet: WALLET, registrar: CUSTOM_REGISTRAR, rpcUrl: DEAD_RPC }, () => null);
  const ep2 = await noSigner.find((t) => t.name === "set_null_endpoint").handler({
    name: "myagent",
    endpoint: "https://api.myagent.dev/x402",
  });
  assert.equal(ep2.ok, true);
  assert.equal(ep2.dry_run, true);
});

test("register_null_name dryRun quotes fee + PDA from a custom registrar's config (loopback RPC server)", async () => {
  const cfg = Buffer.alloc(122);
  cfg.writeBigUInt64LE(7_000_000n, 33);
  new PublicKey(WALLET).toBytes().forEach((b, i) => (cfg[81 + i] = b));
  const cfgPda = deriveConfigPda(CUSTOM_REGISTRAR).toBase58();
  await withLoopbackRpc({ [cfgPda]: cfg }, async (rpc, calls) => {
    const [register] = buildRegistrarTools({ solanaWallet: WALLET, registrar: CUSTOM_REGISTRAR, rpcUrl: rpc }, () => null);
    const res = await register.handler({ name: "myagent", dryRun: true });
    assert.equal(res.ok, true);
    assert.equal(res.dry_run, true);
    assert.equal(res.registrar, CUSTOM_REGISTRAR);
    assert.equal(res.would_register, "myagent.null");
    assert.equal(res.pda, deriveDomainPda("myagent", CUSTOM_REGISTRAR).toBase58());
    assert.equal(res.fee_lamports, 7_000_000);
    assert.equal(res.treasury, WALLET);
    assert.ok(calls.includes(`getAccountInfo:${cfgPda}`)); // read the custom registrar, not mainnet
    assert.ok(!calls.includes(`getAccountInfo:${deriveConfigPda().toBase58()}`));
  });
});
