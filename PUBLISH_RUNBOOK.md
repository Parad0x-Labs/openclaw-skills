# Publish runbook — openclaw-skills packages

Publishing needs the Parad0x npm login (scope `@parad0x_labs`, 2FA). Release
tarballs are built ahead of time from committed sources, so a publish session is
one `npm publish <file>.tgz --access public` per package.

## State (npm registry checked 2026-10-06)

| Package | npm latest | Repo version | Release tarball | Why a new version |
|---|---|---|---|---|
| `@parad0x_labs/openclaw-x402-pay` | 2.0.1 | `skills/x402-pay` 2.0.2 | `parad0x_labs-openclaw-x402-pay-2.0.2.tgz` | 2.0.1 is skipped by OpenClaw 2026.x (`openclaw.compat.pluginApi: "1.x"`); manifest lacks `contracts.tools` and the `repWasmPath`/`repZkeyPath` keys |
| `@parad0x_labs/openclaw-x402-gate` | 2.0.1 | `skills/x402-gate` 2.0.2 | `parad0x_labs-openclaw-x402-gate-2.0.2.tgz` | same `pluginApi` and `contracts.tools` fix; manifest now declares the zk-rep keys; README lists all four tools |
| `@parad0x_labs/openclaw-agent-passport` | 0.2.0 | `plugins/agent-passport` 0.2.1 | `parad0x_labs-openclaw-agent-passport-0.2.1.tgz` | 0.2.0 has no `openclaw.extensions` (OpenClaw finds no manifest) and no `contracts.tools` |
| `@parad0x_labs/openclaw-payment-session` | 0.1.1 | `plugins/payment-session` 0.1.2 | `parad0x_labs-openclaw-payment-session-0.1.2.tgz` | same as agent-passport |
| `@parad0x_labs/openclaw-web0-onboard` | 0.2.0 | `plugins/web0-onboard` 0.2.1 | `parad0x_labs-openclaw-web0-onboard-0.2.1.tgz` | same as agent-passport, plus the devnet `receipt_anchor` text; the write tools refuse the devnet dna-x402 NullPay registrar (different instruction set) |
| `@parad0x_labs/openclaw-context-capsule` | 1.7.1 | `skills/context-capsule` 1.7.2 | `parad0x_labs-openclaw-context-capsule-1.7.2.tgz` | 1.7.1 reads settings from the wrong level of the plugin entry, so configured values never reach the engine |
| `@parad0x_labs/mcp-server` | 0.2.0 | `skills/mcp-server` 0.2.1 | `parad0x_labs-mcp-server-0.2.1.tgz` | refusal text names the devnet `receipt_anchor` and `dark_nullifier_record` |
| `@parad0x-labs/liquefy-openclaw-plugin` | not published | `plugins/openclaw-plugin` 0.2.0 | `parad0x-labs-liquefy-openclaw-plugin-0.2.0.tgz` | first release; migrated to `defineToolPlugin`. The name uses the `@parad0x-labs` scope, not `@parad0x_labs`: confirm that scope (or rename) before publishing |

`@parad0x_labs/null-mcp` and `@parad0x_labs/web0-tip` live in the private packages
repository, not here.

Release tarballs (built from commit `2554a17`; web0-onboard from `c491171`, the other packages are unchanged between the two):

| Tarball | Files | Size (bytes) | sha256 |
|---|---:|---:|---|
| `parad0x_labs-openclaw-x402-pay-2.0.2.tgz` | 16 | 41027 | `b24d5391dc37f282a6df47079feffbfb99278330a3ba2a2b77c5e38b602d7703` |
| `parad0x_labs-openclaw-x402-gate-2.0.2.tgz` | 15 | 33246 | `6824a5e911a474d6559354cca69be9bb52fe539f25f6301d736d09abbcd0a708` |
| `parad0x_labs-openclaw-agent-passport-0.2.1.tgz` | 7 | 7087 | `baa145c9f81abb84ba29fc93d787767fe7643a77deeb58b7d805137e11e31f8b` |
| `parad0x_labs-openclaw-payment-session-0.1.2.tgz` | 8 | 7247 | `3c204602ce777fae9fc82de9901503af07a4d5a8b59e99ae974a84ce72235343` |
| `parad0x_labs-openclaw-web0-onboard-0.2.1.tgz` | 8 | 17456 | `8f42bb483a8f360e610bfced1b0819046572ab91b70e5982bcfc28458aabea1c` |
| `parad0x_labs-openclaw-context-capsule-1.7.2.tgz` | 11 | 31259 | `d3ec7ce9271ebb107b6a9c595e0f774075683ff43183698434ffeb3508e86763` |
| `parad0x_labs-mcp-server-0.2.1.tgz` | 22 | 31493 | `7195b182f51b976a1899fb576ed2ee158da23c30f4ae01a2b8a1ac105dcd95ca` |
| `parad0x-labs-liquefy-openclaw-plugin-0.2.0.tgz` | 11 | 13299 | `b3ec230300e0b2a4eb559274737d14aea4ba4f70558c5b712e0390ac1bd3ab03` |

No tarball carries a preinstall, install, postinstall or prepare script.

## How a release tarball is built

In an isolated container, never on a host that holds keys:

1. `git archive HEAD <package dir>` into the container; `npm ci --ignore-scripts`.
2. Disconnect the network; `npm run typecheck`, `npm run build`, `npm test`.
3. `npm pack --ignore-scripts`; copy the `.tgz` out and check it read-only
   (file list, no lifecycle scripts, no keys, no retired program ID as a default).
4. The owner publishes the file: `npm publish <file>.tgz --access public`.

## OpenClaw host contract (checked against OpenClaw 2026.6.9 and 2026.9.8)

A plugin that misses any of these does not load, or loads without tools:

- `package.json` `openclaw.extensions` points at the entry (`./src/index.ts`, or
  `./dist/index.js` for packages that ship `dist/`).
- `openclaw.plugin.json` lists every agent tool in `contracts.tools`. Generate it,
  do not hand-edit it: `openclaw plugins build --root . --entry src/index.ts`, then
  `openclaw plugins validate --root . --entry src/index.ts` must print "valid".
  The generated `configSchema` comes from the TypeBox `configSchema` in the entry.
- `openclaw.compat.pluginApi`, when present, is a range over the host version
  (`>=2026.6.1`), not an API major such as `1.x`.
- Plugin settings live at `plugins.entries.<id>.config`; OpenClaw rejects other
  keys on the entry. The READMEs show this layout.
- The tool plugins use `defineToolPlugin` (TypeBox `parameters` + `execute`);
  context-capsule is a context engine (`definePluginEntry` +
  `registerContextEngine`).

All eight packages above were loaded with `openclaw plugins inspect <id> --runtime`
on 2026.6.9 (Node 22) and on 2026.9.8 (Node 24, which that release requires): every
declared tool registered, `/liquefy_status` registered, context-capsule registered
its engine, and the only diagnostic was the provenance warning for a path-loaded
plugin.

## Test results at `2554a17` (container, network off)

| Package | Result |
|---|---|
| x402-pay | 14/14 (`test/prover.test.mts` skips without the circuit artifacts) |
| x402-gate | 14/14 (`test/rep.test.mts` skips without the circuit artifacts) |
| agent-passport | 16/16 |
| payment-session | 12/12 |
| web0-onboard | 44/44 (at `c491171`) |
| context-capsule | all 7 `npm test` stages pass; fixture bench matches `bench/results/latest.json`; `test/plugin-load.test.mjs` passes against the real SDK |
| mcp-server | 29/29, `test/server.smoke.mjs` 2/2 |
| liquefy-openclaw-plugin | 10/10 |

## After publishing

1. Smoke each plugin in a scratch OpenClaw: `openclaw plugins install
   @parad0x_labs/openclaw-x402-pay@2.0.2`, then `openclaw plugins inspect x402-pay
   --runtime` lists its tools. `npx @parad0x_labs/mcp-server` starts the stdio
   server with 13 tools (Node 22 or later).
2. Update `evidence/claims.json` (`npm_latest`, `npm_checked_at`,
   `publication_status`) and run `node scripts/check-claims-registry.mjs --write`.
3. Refresh the state table above.

The x402 skills are non-custodial (the agent's own signer holds the key), presenter-bound
and replay-guarded, and fail closed on unsafe mainnet config. Install them with
`--ignore-scripts` on any host that holds a wallet key.
