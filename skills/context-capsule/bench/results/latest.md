# openclaw-context-capsule public-fixture benchmark

Package 1.7.1. Fixture `agent-session-100` (109 messages), 40 questions (35 answerable from the session text; unanswerable: 32, 35, 36, 39, 40). Tokenizer: chars/4 estimate. Model calls: 0.

| Arm | Tokens per call | Keyword pass (of 40) | Of answerable |
|---|---:|---:|---:|
| Full history (no compression) | 7281 | 35/40 (87.5%) | 35/35 |
| Sliding window, last 10 messages | 581 | 9/40 (22.5%) | 9/35 |
| Plugin default: capsule of older 99 @1400 + last 10 verbatim | 2061 | 21/40 (52.5%) | 21/35 |
| Capsule of all 109 messages @700, no tail | 698 | 12/40 (30%) | 12/35 |
| Capsule of all 109 messages @1400, no tail | 1400 | 15/40 (37.5%) | 15/35 |

Plugin default breakdown: older history 6699 tokens -> capsule 1400 tokens (system prompt addition incl. wrapper 1479); verbatim tail 581 tokens.

Keyword pass is an availability check (is the answer text in what the model receives), not model task success. The plugin makes no retrieval call.

Generated 2026-10-06T08:48:22.632Z with Node v22.23.3. Regenerate: `npm run build && node bench/fixture-bench.mjs`.
