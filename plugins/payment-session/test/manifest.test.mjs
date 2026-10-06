/**
 * Host-contract guard: OpenClaw (>= 2026.6.x) registers a plugin's agent tools only
 * when openclaw.plugin.json declares them in contracts.tools, and discovers the
 * plugin only through package.json openclaw.extensions. Regenerate the manifest
 * with `openclaw plugins build --root . --entry src/index.ts` after changing tools
 * or config. No build needed: this reads the JSON files only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("manifest declares every tool in contracts.tools", () => {
  assert.deepEqual(manifest.contracts?.tools, [
    "open_payment_session",
    "meter_usage",
    "check_settlement_due",
    "record_settled",
    "close_payment_session",
  ]);
});

test("package.json points OpenClaw at the entry and the manifest version matches", () => {
  assert.deepEqual(pkg.openclaw?.extensions, ["./src/index.ts"]);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.id, "payment-session");
});
