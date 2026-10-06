/**
 * End-to-end smoke test: spawn the built stdio MCP server and drive it over
 * newline-delimited JSON-RPC. Proves the server boots, lists the consent tools
 * alongside the originals, reports read-only scope, and returns a PREVIEW (no
 * transaction) for a write when PARAD0X_MCP_ALLOW_WRITE is unset.
 *
 * A throwaway keypair is injected so the write path reaches the canSubmitWrite
 * guard (rather than the no-keypair dry-run branch) — proving the guard blocks.
 *
 * Also proves receipt anchoring refuses cleanly: anchor_receipt and
 * private_compute return "not done by this server and no default anchor program
 * is configured", even with writes enabled and a keypair present, and never contact an RPC
 * (checked against a local fake JSON-RPC server — no network). check_nullifier
 * refuses the same way, and get_stack_status lists no seized program.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { Keypair } from "@solana/web3.js";
import { isSeizedProgram } from "../dist/scope.js";

const here = dirname(fileURLToPath(import.meta.url));
const RETIRED_MAINNET_ANCHOR = "6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN";
const UNAVAILABLE = /receipt anchoring is not done by this server and no default anchor program is configured/;
const DEVNET_ANCHOR = "HSdEQWunzPtNqdzv5HfXuA3zwPLpgTXRyfbndnGamhXs";
const DEVNET_NULLIFIER_RECORD = "CPMfXL73v9PDmxyPLTM97bzrNa5eg2AEpsac9XKzX9et";
const serverPath = join(here, "..", "dist", "index.js");

/** Minimal newline-delimited JSON-RPC client over a child process's stdio. */
function startServer(envOverrides = {}) {
  const env = { ...process.env };
  delete env.PARAD0X_MCP_ALLOW_WRITE; // ensure writes are disabled
  delete env.PARAD0X_ANCHOR_RPC_URL;
  env.SOLANA_KEYPAIR = JSON.stringify([...Keypair.generate().secretKey]);
  Object.assign(env, envOverrides);

  const child = spawn(process.execPath, [serverPath], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });

  let nextId = 1;
  function request(method, params) {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout on ${method}`)), 10_000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(payload);
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  return { child, request, notify };
}

/** Unwrap an MCP tools/call result into the JSON object the tool returned. */
function toolResult(resp) {
  const text = resp.result?.content?.[0]?.text;
  assert.ok(text, "tool result should carry text content");
  return JSON.parse(text);
}

test("server boots, lists consent tools, gates writes (read-only scope)", async () => {
  const { child, request, notify } = startServer();
  try {
    const init = await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.0.0" },
    });
    assert.ok(init.result, "initialize should return a result");
    notify("notifications/initialized", {});

    // tools/list — the 3 consent tools must appear alongside the originals.
    const list = await request("tools/list", {});
    const names = (list.result?.tools ?? []).map((t) => t.name);
    for (const t of ["get_scope_status", "grant_write_consent", "revoke_write_consent"]) {
      assert.ok(names.includes(t), `tools/list missing ${t}`);
    }
    for (const t of ["x402_get_quote", "anchor_receipt", "private_compute", "get_stack_status", "resolve_null", "create_wallet"]) {
      assert.ok(names.includes(t), `tools/list missing tool ${t}`);
    }

    // get_scope_status — write mode must be OFF (env flag unset).
    const scope = toolResult(await request("tools/call", { name: "get_scope_status", arguments: {} }));
    assert.equal(scope.write_mode_enabled, false);

    // anchor_receipt with a valid hash → clear refusal, hash echoed, no tx, no preview.
    const anchor = toolResult(
      await request("tools/call", {
        name: "anchor_receipt",
        arguments: { receipt_hash_hex: "A".repeat(64), confirm: true },
      }),
    );
    assert.match(anchor.error, UNAVAILABLE);
    assert.equal(anchor.anchoring, "unavailable");
    assert.equal(anchor.sent, false);
    assert.equal(anchor.receipt_hash_hex, "a".repeat(64));
    assert.ok(!anchor.solana_tx && !anchor.preview && !anchor.would_submit);

    // malformed hash is still rejected on its own terms
    const bad = toolResult(
      await request("tools/call", { name: "anchor_receipt", arguments: { receipt_hash_hex: "abcd" } }),
    );
    assert.match(bad.error, /64 hex/);

    // check_nullifier → clear refusal, no lookup
    const nul = toolResult(
      await request("tools/call", { name: "check_nullifier", arguments: { nullifier: "1".repeat(64) } }),
    );
    assert.match(nul.error, /does not query a nullifier record program in this server and none is configured/);
    assert.ok(nul.error.includes(DEVNET_NULLIFIER_RECORD));
    assert.equal(nul.available, false);
    assert.ok(!("spent" in nul) && !("record_pda" in nul));

    // the tool description names the devnet program for explicit use; the tool
    // itself takes no program or RPC input
    const anchorTool = list.result.tools.find((t) => t.name === "anchor_receipt");
    assert.match(anchorTool.description, new RegExp(UNAVAILABLE.source, "i"));
    assert.ok(anchorTool.description.includes(DEVNET_ANCHOR));
    assert.equal(anchorTool.inputSchema.properties.program_id, undefined);
    assert.equal(anchorTool.inputSchema.properties.rpc_url, undefined);

    // get_stack_status: no live anchor, no seized address, retired mainnet programs say so.
    const stack = toolResult(await request("tools/call", { name: "get_stack_status", arguments: {} }));
    const byAddr = Object.fromEntries(stack.programs.map((p) => [p.address, p]));
    assert.match(byAddr[RETIRED_MAINNET_ANCHOR].status, /^retired 2026-07-14/);
    for (const p of stack.programs) {
      assert.equal(isSeizedProgram(p.address), false, `${p.name} must not be a seized program`);
      assert.notEqual(p.cluster, "devnet", `${p.name}: no devnet program is listed`);
      if (p.cluster === "mainnet" && p.name !== "null_token") {
        assert.match(p.status, /retired/, `${p.name} must not be reported live`);
      }
    }
    assert.equal(stack.receipt_anchoring.status, "unavailable");
    assert.equal(stack.shielded_access.status, "unavailable");
    assert.equal(stack.private_reputation_stack.status, "unavailable");
    assert.equal(stack.anchor_network, "none");
    assert.doesNotMatch(JSON.stringify(stack), /rolling\s+out|clean redeploy pending|ZK-verified on devnet/);

    // create_wallet: preview writes nothing; confirm writes a key file + returns
    // ONLY the public key (the secret must never appear in the tool result).
    const walletPath = join(tmpdir(), `web0-smoke-wallet-${process.pid}.json`);
    rmSync(walletPath, { force: true });
    const wprev = toolResult(await request("tools/call", { name: "create_wallet", arguments: { path: walletPath } }));
    assert.equal(wprev.preview, true);
    assert.ok(!existsSync(walletPath), "preview must not write a key file");

    const wmade = toolResult(
      await request("tools/call", { name: "create_wallet", arguments: { path: walletPath, confirm: true } }),
    );
    try {
      assert.equal(wmade.created, true);
      assert.ok(wmade.public_key, "must return the public key");
      assert.ok(existsSync(walletPath), "confirm must write the key file");
      const secret = JSON.parse(readFileSync(walletPath, "utf8"));
      assert.equal(secret.length, 64, "key file holds a 64-byte secret");
      // the secret-key array must NOT be present anywhere in the tool result
      assert.ok(
        !JSON.stringify(wmade).includes(JSON.stringify(secret)),
        "secret key must never appear in the tool result",
      );
    } finally {
      rmSync(walletPath, { force: true });
    }
  } finally {
    child.kill();
  }
});

/** Local fake JSON-RPC that reports a given genesis hash and records every method called. */
async function startFakeRpc(genesisHash) {
  const methods = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let msg = {};
      try {
        msg = JSON.parse(body);
      } catch {
        /* ignore */
      }
      const calls = Array.isArray(msg) ? msg : [msg];
      const out = calls.map((m) => {
        methods.push(m.method);
        if (m.method === "getGenesisHash") return { jsonrpc: "2.0", id: m.id, result: genesisHash };
        return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "not served by fake rpc" } };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Array.isArray(msg) ? out : out[0]));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, methods, close: () => srv.close() };
}

test("with writes enabled and a keypair, anchoring still refuses and no RPC is contacted", async () => {
  const rpc = await startFakeRpc("unused");
  const { child, request, notify } = startServer({
    PARAD0X_MCP_ALLOW_WRITE: "1",
    PARAD0X_ANCHOR_RPC_URL: rpc.url,
    SOLANA_RPC_URL: rpc.url,
  });
  try {
    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.0.0" },
    });
    notify("notifications/initialized", {});

    const scope = toolResult(await request("tools/call", { name: "get_scope_status", arguments: {} }));
    assert.equal(scope.write_mode_enabled, true);
    const granted = toolResult(
      await request("tools/call", { name: "grant_write_consent", arguments: { tool_name: "anchor_receipt" } }),
    );
    assert.equal(granted.granted, true);

    const r = toolResult(
      await request("tools/call", {
        name: "anchor_receipt",
        arguments: { receipt_hash_hex: "b".repeat(64), rpc_url: rpc.url, confirm: true },
      }),
    );
    assert.match(r.error, UNAVAILABLE);
    assert.equal(r.sent, false);
    assert.ok(!r.solana_tx, "no transaction signature should be returned");

    // private_compute with anchor:true: commitment computed locally, anchor refused.
    // The executor URL is a closed local port, so nothing leaves the machine.
    const pc = toolResult(
      await request("tools/call", {
        name: "private_compute",
        arguments: { plaintext_input: "hello", executor_endpoint: "http://127.0.0.1:9/run", anchor: true },
      }),
    );
    assert.match(pc.commitment.commitment_hex, /^[0-9a-f]{64}$/);
    assert.equal(pc.commitment.anchored, false);
    assert.match(pc.commitment.error, UNAVAILABLE);
    assert.equal(pc.commitment_tx, undefined);

    assert.deepEqual(rpc.methods, [], "no RPC method may be called");
  } finally {
    child.kill();
    rpc.close();
  }
});
