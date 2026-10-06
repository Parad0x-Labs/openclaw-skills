/**
 * Liquefy OpenClaw plugin.
 *
 * Defined with the OpenClaw SDK's `defineToolPlugin` (TypeBox `parameters` +
 * `execute(params, config)`); the SDK registers the tools at plugin startup and
 * hands each call the validated plugin config (`plugins.entries.liquefy.config`).
 * The tools shell out to the Liquefy CLI JSON contract (./lib.js).
 *
 *   - liquefy_scan        read-only workspace scan (`--dry-run`), the safe default
 *   - liquefy_pack_apply  explicit pack/apply; registered as optional (allowlist it)
 *   - /liquefy_status     command: plugin version, CLI compatibility and defaults
 *
 * `openclaw plugins build --root . --entry dist/index.js` regenerates
 * openclaw.plugin.json (contracts.tools, configSchema) from this file.
 */
import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import {
  MIN_LIQUEFY_OPENCLAW_VERSION,
  PLUGIN_VERSION,
  getLiquefyCompatibility,
  runLiquefyOpenclaw,
} from "./lib.js";

const Profile = Type.Union([Type.Literal("default"), Type.Literal("ratio"), Type.Literal("speed")]);

function baseParams() {
  return {
    workspace: Type.Optional(
      Type.String({ description: "OpenClaw workspace path. Default: config workspace, else ~/.openclaw." }),
    ),
    out: Type.Optional(
      Type.String({ description: "Vault output directory. Default: config vaultOut; one of the two is required." }),
    ),
    profile: Type.Optional(Profile),
    policy: Type.Optional(Type.String({ description: "Liquefy policy file (.json/.yaml)." })),
    maxBytesPerRun: Type.Optional(Type.Integer({ minimum: 0 })),
    listLimit: Type.Optional(Type.Integer({ minimum: 1 })),
    allow: Type.Optional(Type.Array(Type.String())),
    deny: Type.Optional(Type.Array(Type.String())),
    allowCategories: Type.Optional(Type.Array(Type.String())),
    includeSecrets: Type.Optional(Type.Boolean()),
    includeSecretsPhrase: Type.Optional(Type.String()),
  };
}

const ScanParams = Type.Object(baseParams(), {
  additionalProperties: false,
  description: "Read-only Liquefy workspace scan (safe default).",
});

const ApplyParams = Type.Object(
  {
    ...baseParams(),
    verifyMode: Type.Optional(Type.Union([Type.Literal("full"), Type.Literal("fast"), Type.Literal("off")])),
    workers: Type.Optional(Type.Integer({ minimum: 0 })),
    secure: Type.Optional(Type.Boolean()),
    noChunking: Type.Optional(Type.Boolean()),
    unsafePermsOk: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: false,
    description: "Pack an OpenClaw workspace with Liquefy (explicit opt-in, optional secure mode).",
  },
);

const ConfigSchema = Type.Object(
  {
    binaryPath: Type.Optional(
      Type.String({
        description:
          "Path to Liquefy CLI binary or script (defaults to LIQUEFY_OPENCLAW_BIN env var or `liquefy`).",
      }),
    ),
    workspace: Type.Optional(
      Type.String({ description: "Default OpenClaw workspace path. Defaults to ~/.openclaw." }),
    ),
    vaultOut: Type.Optional(
      Type.String({
        description: "Default vault output directory (required for scan/apply if not supplied by tool input).",
      }),
    ),
    profile: Type.Optional(Profile),
    policyFile: Type.Optional(Type.String({ description: "Optional shared Liquefy policy file (.json/.yaml)." })),
    requireSecureByDefault: Type.Optional(
      Type.Boolean({ description: "If true, apply runs pass --secure and require LIQUEFY_SECRET." }),
    ),
    maxBytesPerRun: Type.Optional(Type.Integer({ minimum: 0 })),
    listLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

/** Status payload for /liquefy_status. Probes the local Liquefy CLI version (cached). */
export async function buildLiquefyStatus(cfg = {}) {
  const compatibility = await getLiquefyCompatibility(cfg);
  return {
    ok: true,
    plugin: "liquefy",
    version: PLUGIN_VERSION,
    tools: ["liquefy_scan", "liquefy_pack_apply"],
    compatibility,
    defaults: {
      profile: cfg.profile || "default",
      workspace: cfg.workspace || "~/.openclaw",
      secure: !!cfg.requireSecureByDefault,
      minimumCliVersion: MIN_LIQUEFY_OPENCLAW_VERSION,
    },
    notes: [
      "liquefy_scan is read-only and safe by default",
      "liquefy_pack_apply is optional/allowlisted and shells out to Liquefy CLI JSON mode",
      `plugin expects Liquefy OpenClaw CLI >= ${MIN_LIQUEFY_OPENCLAW_VERSION}`,
    ],
  };
}

const entry = defineToolPlugin({
  id: "liquefy",
  name: "Liquefy",
  description:
    "Liquefy CLI wrapper for OpenClaw: a read-only workspace scan (liquefy_scan) and an " +
    "explicit, optional pack/apply (liquefy_pack_apply), with a vault-scan PII gate on inputs.",
  configSchema: ConfigSchema,
  tools: (tool) => [
    tool({
      name: "liquefy_scan",
      label: "Liquefy scan",
      description: "Read-only Liquefy scan for an OpenClaw workspace (safe default; no writes).",
      parameters: ScanParams,
      execute: (params, config) => runLiquefyOpenclaw("scan", params, config),
    }),
    tool({
      name: "liquefy_pack_apply",
      label: "Liquefy pack/apply",
      description: "Pack an OpenClaw workspace with Liquefy (explicit writes; optional secure mode).",
      parameters: ApplyParams,
      optional: true,
      execute: (params, config) => runLiquefyOpenclaw("apply", params, config),
    }),
  ],
});

// The SDK entry registers the tools; the status command is added alongside them.
const registerTools = entry.register;
entry.register = (api) => {
  registerTools(api);
  if (typeof api?.registerCommand !== "function") return;
  api.registerCommand({
    name: "liquefy_status",
    description: "Show the Liquefy plugin version, Liquefy CLI compatibility and defaults.",
    acceptsArgs: false,
    handler: async () => ({
      text: JSON.stringify(await buildLiquefyStatus(api.pluginConfig ?? {}), null, 2),
    }),
  });
};

export default entry;
