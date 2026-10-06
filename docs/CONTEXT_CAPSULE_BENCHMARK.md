# Context Capsule plugin benchmark: method and results

Package: `@parad0x_labs/openclaw-context-capsule` ([`skills/context-capsule`](../skills/context-capsule)), v1.7.0.
Results last refreshed 2026-10-06 in a network-isolated container (method below).
Dataflow of the plugin: [CONTEXT_CAPSULE_DATAFLOW.md](CONTEXT_CAPSULE_DATAFLOW.md).

All numbers are deterministic and model-free. No LLM was called. Token counts
are `ceil(chars / 4)` estimates, the same estimator the plugin uses.

## What each number means

| Scope | Question it answers | Measured here |
|---|---|---|
| Tokens per call | How large is what the plugin sends (capsule + verbatim tail)? | yes |
| Information available in one call | Are a question's answer keywords in that text? | yes |
| Key-signal recall | What share of paths, URLs, commands, IDs, error and decision lines from the older history appear verbatim in the capsule? | yes |
| Supersession, redaction, hardening | Do pivots, secrets and hostile inputs behave as specified? | yes (test suites) |
| Model task success, total task tokens, cost per successful answer | Does a model answer correctly, and at what total cost? | **no** |

The plugin has no retrieval call. Older content the capsule omits does not
reach the model through this plugin, so "tokens per call" is also the total
context this plugin contributes to a call.

## Dataset

[`skills/context-capsule/bench/fixtures`](../skills/context-capsule/bench/fixtures) holds byte-identical copies of the
fixture used by `@parad0x_labs/context-capsule` in dna-x402:

- `agent-session-100.json`: 109 messages (55 user, 54 assistant), synthetic, about building a receipt-anchoring package. SHA-256 `18b4a6590cbde822835a70d107a2c7b29f72753edcb9e2c8c905fdaa4d1942aa`.
- `recovery-questions.json`: 40 questions with `required_keywords`. SHA-256 `9aae0170004d30e0cbd9cb40a28e3aaaed6af42e2c1fcf0160ee4462a6c65729`.
- The questions were written together with the session by the maintainers: a development set, not a held-out evaluation. 5 questions (32, 35, 36, 39, 40) are not answerable from the session text.

## Results

### Tokens per call and keyword availability (`bench/fixture-bench.mjs`)

| Arm | Tokens per call | Pass (of 40) | Pass (of 35 answerable) |
|---|---:|---:|---:|
| Full history, no plugin | 7,281 | 35 | 35 |
| Sliding window, last 10 messages | 581 | 9 | 9 |
| **Plugin default**: capsule of older 99 messages @1,400 + last 10 verbatim | **2,061** | **21** | **21** |
| Capsule of all 109 messages @700, no tail | 698 | 12 | 12 |
| Capsule of all 109 messages @1,400, no tail | 1,400 | 15 | 15 |

Plugin default breakdown: older history 6,699 tokens -> capsule 1,400 tokens
(1,479 with the fixed wrapper text); verbatim tail 581 tokens. Defaults:
`keepRecentMessages` 10, `maxCapsuleTokens` 1,400, no host `tokenBudget`.

"Pass" = every required keyword occurs in the text the model would receive. It
shows the answer is present, not that a model answers correctly.

### Key-signal recall on the fixture (`test/fidelity-bench.mjs`)

Older history = first 99 messages (about 6,426 tokens); tail of 10 kept verbatim.

| Capsule budget | Capsule tokens | Older-history reduction | Overall reduction (capsule + tail) | Key-signal recall |
|---:|---:|---:|---:|---:|
| 300 | 300 | 21.4x | 8.2x | 19% (8/43) |
| 500 | 497 | 12.9x | 6.6x | 30% (13/43) |
| 700 | 700 | 9.2x | 5.6x | 42% (18/43) |
| 1,200 | 1,199 | 5.4x | 4.0x | 65% (28/43) |
| 2,000 | 1,999 | 3.2x | 2.7x | 86% (37/43) |

Key signals are file paths, URLs, shell commands, numbers/IDs, long hashes, and
lines containing error or decision words, matched verbatim. Earlier docs quoted
about 79% at about 5x and about 93% at about 3.4x from the maintainer's private
sessions; those sessions are not in the repository and those figures are not
reproducible from it, so the public-fixture numbers above replace them.

### Test suites (`npm test`)

| Suite | Result |
|---|---|
| `test/compression-smoke.mjs`, `test/quality.test.mjs`, `test/value-survival.test.mjs` | pass |
| `test/supersession-bench.mjs` (5 pivot cases + 1 control, 6 abandoned subjects) | 6/6 abandoned subjects struck or omitted, 0 live choices flagged, 0 mangled lines, at budgets 700 and 1,400 (gate: >= 83%, 0 flagged, 0 mangled) |
| `test/hardening-bench.mjs` | 8/8 (never-throw, bounded output, time bound, secret leak, injection quarantine, multi-pivot, determinism, schema field) |
| `test/secret-bench.mjs` | 5/5 (no planted secret in injected text or decompressed audit blob, no over-redaction of look-alikes, fingerprint format, determinism) |
| `test/platform-parity.test.mjs` | 40 assertions pass (Node vs browser backends) |
| `test/plugin-load.test.mjs` (not in `npm test`) | skipped: needs the OpenClaw SDK, not present in the container |

The supersession set is small and was used during development; 6/6 there does
not establish a rate on other sessions. An earlier note cited 83% on a separate
held-out split that is not in the repository.

## Result files

- [`skills/context-capsule/bench/results/latest.json`](../skills/context-capsule/bench/results/latest.json) and [`latest.md`](../skills/context-capsule/bench/results/latest.md): `bench/fixture-bench.mjs`, per question and per arm.
- [`skills/context-capsule/bench/results/fidelity-fixture.json`](../skills/context-capsule/bench/results/fidelity-fixture.json): `test/fidelity-bench.mjs --json` on the fixture.

CI (`.github/workflows/skills-ts.yml`, context-capsule lane) runs `npm test`
and `bench/fixture-bench.mjs`, and fails if the committed `latest.json` differs
from a fresh run in anything other than timestamp, runtime or Node version.

## Reproduce

Dependencies are dev-only (TypeScript, `@types/node`, `pako`, `@noble/hashes`;
none has an install script). The recorded run installed them with
`npm ci --ignore-scripts` into a container volume, then ran everything with
networking disabled, a read-only root filesystem, a tmpfs work directory and
the skill copied in through stdin (no host mounts):

```sh
# from skills/context-capsule
docker volume create capsule-oc-nm
tar -cf - package.json package-lock.json | docker run --rm -i --read-only \
  --tmpfs /work:rw,exec,size=256m --tmpfs /tmp:rw,size=128m -e npm_config_cache=/tmp/npmcache \
  -v capsule-oc-nm:/nm -w /work node:22-bookworm-slim sh -c '
  tar -xf - -C /work && npm ci --ignore-scripts --no-audit --no-fund && cp -a node_modules/. /nm/'

tar --exclude=node_modules --exclude=dist -cf - . | docker run --rm -i --network none --read-only \
  --tmpfs /work:rw,exec,size=256m --tmpfs /tmp:rw,size=128m -v capsule-oc-nm:/nm:ro \
  -w /work node:22-bookworm-slim sh -c '
  tar -xf - -C /work && cp -a /nm node_modules &&
  npm test && node bench/fixture-bench.mjs &&
  mkdir -p /tmp/s && node -e "const fs=require(\"fs\");const m=JSON.parse(fs.readFileSync(\"bench/fixtures/agent-session-100.json\",\"utf8\"));fs.writeFileSync(\"/tmp/s/agent-session-100.jsonl\",m.map(x=>JSON.stringify({type:\"message\",message:x})).join(\"\n\"))" &&
  node test/fidelity-bench.mjs /tmp/s 10'
```

Image `node:22-bookworm-slim` (`sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c`), Node v22.23.3.
Without Docker: `cd skills/context-capsule && npm ci --ignore-scripts && npm test && node bench/fixture-bench.mjs`.

## Not yet measured: end-to-end model tasks

A total-token or cost claim needs the same held-out tasks, model, system text
and grader run across full history, a sliding window, a model-written summary,
ordinary retrieval, and this plugin, counting every input and output token
(cached tokens separately), retries and summarization calls, with task success
and cost per successful answer reported together. The harness for the
standalone library ([dna-x402 `scripts/e2e-harness.ts`](https://github.com/Parad0x-Labs/dna-x402/blob/main/packages/context-capsule/scripts/e2e-harness.ts), spec in [dna-x402 docs/CONTEXT_CAPSULE_BENCHMARK.md](https://github.com/Parad0x-Labs/dna-x402/blob/main/docs/CONTEXT_CAPSULE_BENCHMARK.md)) defines those arms and the accounting; a plugin arm (capsule + tail as built by `assemble()`) is the addition needed for this package. It has not been run.

## Wording these numbers support

- "On the public 109-message fixture, default settings send 2,061 estimated tokens per call instead of 7,281 (capsule of older turns + last 10 verbatim)."
- "Lossy: on that fixture 21 of 40 development questions keep their answer keywords in what the model receives, versus 35 with full history. Model-answer accuracy has not been measured."
- "Key-signal recall 65% at a 1,200-token capsule, 86% at 2,000, on the same fixture."
