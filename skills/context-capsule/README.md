# context-capsule — OpenClaw ContextEngine plugin

Self-contained OpenClaw context engine that reduces prompt tokens in long agent
sessions. It keeps the recent tail verbatim and converts older history into a
bounded, model-readable extractive capsule.

The capsule preserves high-value older context:

- decisions and constraints
- open tasks and requested work
- errors and failed attempts
- files, commands, and links
- open questions and durable facts

It also keeps a zlib-compressed payload and Merkle root for auditability, but the
LLM is given the extractive capsule, not opaque compressed bytes.

## Measured on a public fixture

On the 109-message fixture in `bench/fixtures`, with default settings, the model
receives 2,061 estimated tokens per call (capsule of the older 99 messages plus
the last 10 verbatim) instead of 7,281 for the full history. For 21 of 40
questions written for that fixture, every answer keyword is still in that text
(35 of 40 with the full history; 5 are not answerable from the fixture). This is
keyword availability, not model-answer accuracy, which has not been measured.
There is no retrieval: what the capsule drops does not reach the model. Method
and reproduction: `docs/CONTEXT_CAPSULE_BENCHMARK.md` in the repository; how the
data moves: `docs/CONTEXT_CAPSULE_DATAFLOW.md`.

## Safety and limits

- **Lossy by design.** Older messages are not preserved verbatim in the model
  prompt. Exact wording, nuance, and low-priority details can be lost.
- **Recent context remains verbatim.** `keepRecentMessages` controls how many
  latest messages stay untouched.
- **Best-effort vault scan.** Text content is scanned for common secrets and PII
  before compression or model injection. This is useful defense-in-depth, not a
  formal guarantee.
- **No external runtime dependency.** The plugin uses only Node built-ins
  (`zlib` and `crypto`) and makes no network, file-system, or on-chain calls.

## Activation

```jsonc
// openclaw.json
{
  "plugins": {
    "slots": {
      "contextEngine": "context-capsule"
    }
  }
}
```

## Config options

| Key | Default | Description |
| --- | ---: | --- |
| `minMessages` | `20` | Sessions shorter than this pass through unchanged. |
| `keepRecentMessages` | `10` | Recent messages kept verbatim after compression. |
| `maxCapsuleTokens` | `1400` | Hard cap for the injected extractive capsule. |
| `capsuleTokenRatio` | `0.14` | If OpenClaw provides a model token budget, cap the capsule to this fraction of the budget. |
| `minCompressTokens` | `900` | Estimated transcript-token floor before compression activates. |

```jsonc
{
  "plugins": {
    "entries": {
      "context-capsule": {
        "enabled": true,
        "config": {
          "minMessages": 20,
          "keepRecentMessages": 10,
          "maxCapsuleTokens": 1400,
          "capsuleTokenRatio": 0.14,
          "minCompressTokens": 900
        }
      }
    }
  }
}
```

Settings go under `config` in the plugin entry: OpenClaw validates
`plugins.entries.context-capsule.config` against `openclaw.plugin.json` and rejects
keys placed directly on the entry.

## Packaging

The npm/ClawHub package ships compiled `dist/` JavaScript. It does not require
TypeScript support from the host runtime.

```sh
npm run typecheck
npm test
npm pack --dry-run
```

## When to use

Use this for long-running local or hosted model sessions where resending the full
conversation is too expensive or pushes the model toward context overflow.

Do not use it for workflows where old transcript wording must remain exact. For
that, keep normal OpenClaw history or use a retrieval system that can quote the
original source.
