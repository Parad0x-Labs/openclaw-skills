/**
 * Plugin-entry contract against the real OpenClaw SDK (`openclaw` is a peer
 * dependency, installed by `npm ci`): the default export is a defineToolPlugin
 * entry, register() hands the host two tools plus the /liquefy_status command,
 * and openclaw.plugin.json declares the same tools in contracts.tools (OpenClaw
 * registers no agent tool a manifest does not declare).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("manifest declares both tools and matches the package version", () => {
  assert.deepEqual(manifest.contracts?.tools, ["liquefy_scan", "liquefy_pack_apply"]);
  assert.equal(manifest.version, pkg.version);
  assert.deepEqual(pkg.openclaw?.extensions, ["./dist/index.js"]);
});

let sdk;
try {
  sdk = await import("openclaw/plugin-sdk/tool-plugin");
} catch {
  sdk = null;
}

test("default export is a defineToolPlugin entry that registers tools and the status command", { skip: !sdk && "openclaw SDK not installed" }, async () => {
  const { default: entry } = await import("../dist/index.js");
  const meta = sdk.getToolPluginMetadata(entry);
  assert.equal(meta.id, "liquefy");
  assert.deepEqual(meta.tools.map((t) => [t.name, !!t.optional]), [["liquefy_scan", false], ["liquefy_pack_apply", true]]);
  assert.equal(meta.tools[0].parameters.required, undefined, "out may come from config vaultOut");

  const tools = [];
  const commands = [];
  entry.register({
    pluginConfig: { vaultOut: "/tmp/vault" },
    registerTool: (t, opts) => tools.push({ name: t.name, optional: !!opts?.optional, execute: t.execute }),
    registerCommand: (c) => commands.push(c),
  });
  assert.deepEqual(tools.map((t) => [t.name, t.optional]), [["liquefy_scan", false], ["liquefy_pack_apply", true]]);
  assert.equal(typeof tools[0].execute, "function");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, "liquefy_status");
  assert.ok(commands[0].description.length > 0);
});
