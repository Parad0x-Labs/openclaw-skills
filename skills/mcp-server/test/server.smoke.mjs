/**
 * End-to-end smoke test: spawn the built stdio MCP server and drive it over
 * newline-delimited JSON-RPC. Proves the server boots, lists the consent tools
 * alongside the originals, reports read-only scope, and returns a PREVIEW (no
 * transaction) for a write when PARAD0X_MCP_ALLOW_WRITE is unset.
 *
 * A throwaway keypair is injected so the write path reaches the canSubmitWrite
 * guard (rather than the no-keypair dry-run branch) — proving the guard blocks.
 *
 * Also proves anchor_receipt never targets the retired mainnet receipt_anchor:
 * previews name the devnet program, a mainnet RPC URL is refused up front, and
 * an RPC that reports the mainnet genesis hash is refused before anything is
 * signed or sent (checked against a local fake JSON-RPC server — no network).
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

const here = dirname(fileURLToPath(import.meta.url));
const DEVNET_ANCHOR = "CPQ8Y1bdRiadxLMhrQG14Atc3E5eNJhqwPX1nXtH1Mst";
const RETIRED_MAINNET_ANCHOR = "6HSRGivdYR5D7yTDy1TFMCM8h3LzXxRtKU1RA3RnCMRN";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
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

    // anchor_receipt with a valid hash but no ALLOW_WRITE → preview, no tx.
    const anchor = toolResult(
      await request("tools/call", {
        name: "anchor_receipt",
        arguments: { receipt_hash_hex: "a".repeat(64), confirm: true },
      }),
    );
    assert.equal(anchor.preview, true, "write must be blocked to a preview");
    assert.match(anchor.blocked_reason, /PARAD0X_MCP_ALLOW_WRITE=1/);
    assert.ok(!anchor.solana_tx, "no transaction signature should be returned");
    // the preview targets the devnet receipt_anchor, never the retired mainnet one
    assert.equal(anchor.would_submit.program, DEVNET_ANCHOR);
    assert.equal(anchor.would_submit.cluster, "devnet");

    // anchor_receipt against a mainnet RPC → explicit "retired" refusal, no preview, no tx.
    const mainnetAnchor = toolResult(
      await request("tools/call", {
        name: "anchor_receipt",
        arguments: { receipt_hash_hex: "a".repeat(64), rpc_url: "https://solana-rpc.publicnode.com", confirm: true },
      }),
    );
    assert.match(mainnetAnchor.error, /retired 2026-07-14/);
    assert.equal(mainnetAnchor.retired, true);
    assert.equal(mainnetAnchor.mainnet_program, RETIRED_MAINNET_ANCHOR);
    assert.equal(mainnetAnchor.devnet_program, DEVNET_ANCHOR);
    assert.ok(!mainnetAnchor.preview && !mainnetAnchor.solana_tx);

    // get_stack_status: devnet anchor is the live target; retired mainnet programs say so.
    const stack = toolResult(await request("tools/call", { name: "get_stack_status", arguments: {} }));
    const byAddr = Object.fromEntries(stack.programs.map((p) => [p.address, p]));
    assert.equal(byAddr[DEVNET_ANCHOR].cluster, "devnet");
    assert.match(byAddr[RETIRED_MAINNET_ANCHOR].status, /^retired 2026-07-14/);
    for (const p of stack.programs) {
      if (p.cluster === "mainnet" && p.name !== "null_token") {
        assert.match(p.status, /retired/, `${p.name} must not be reported live`);
      }
    }
    assert.doesNotMatch(JSON.stringify(stack), /rolling\s+out|clean redeploy pending/);

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

test("anchor_receipt with writes enabled refuses an RPC reporting the mainnet genesis (nothing sent)", async () => {
  const rpc = await startFakeRpc(MAINNET_GENESIS);
  const { child, request, notify } = startServer({ PARAD0X_MCP_ALLOW_WRITE: "1" });
  try {
    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.0.0" },
    });
    notify("notifications/initialized", {});

    const scope = toolResult(await request("tools/call", { name: "get_scope_status", arguments: {} }));
    assert.equal(scope.write_mode_enabled, true);

    // The URL does not name a cluster, so only the genesis-hash check can catch it.
    const r = toolResult(
      await request("tools/call", {
        name: "anchor_receipt",
        arguments: { receipt_hash_hex: "b".repeat(64), rpc_url: rpc.url, confirm: true },
      }),
    );
    assert.match(r.error, /retired 2026-07-14/);
    assert.equal(r.cluster_check, "failed");
    assert.ok(!r.solana_tx, "no transaction signature should be returned");
    assert.deepEqual(rpc.methods, ["getGenesisHash"], "only the genesis hash may be queried");
  } finally {
    child.kill();
    rpc.close();
  }
});
