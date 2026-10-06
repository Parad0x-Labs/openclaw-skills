# Context Capsule: dataflow from history to model input

Observed 2026-10-06 against source, not documentation. Two packages share the
name and solve different problems; this page traces both.

| | `@parad0x_labs/context-capsule` (library) | `@parad0x_labs/openclaw-context-capsule` (OpenClaw plugin) |
|---|---|---|
| Source | [dna-x402 `packages/context-capsule`](https://github.com/Parad0x-Labs/dna-x402/tree/b03fec0df462eb3d55ba939cf6e499980be6afd3/packages/context-capsule) | [`skills/context-capsule`](../skills/context-capsule) |
| Source revision read | dna-x402 `b03fec0` (package.json 1.2.0) | openclaw-skills `c103eac` (package.json 1.7.0; 1.7.1 changes comments only) |
| npm (registry, 2026-10-06 08:25 UTC) | latest **1.0.0** (2026-06-03). 1.2.0 is prepared in Git, not on npm (1.1.0 was never published). | latest **1.7.0** (2026-07-09); 1.7.1 prepared |
| What reaches the model by default | a ~53-token pointer string (topics + ratio + Merkle prefix) | an extractive capsule of older turns (up to 1,400 tokens by default) + the last 10 messages verbatim |
| Retrieval | `searchCapsule()`; the caller must call it and place its output in the prompt | none |
| Summaries | deterministic regex/heuristics; no model call in any exported function | deterministic regex/heuristics; no model call |
| Network | none, except `anchorCorrectionChain()` when `SOLANA_KEYPAIR`, an explicit RPC endpoint and `@solana/web3.js` are all present (no default cluster since 1.2.0) | none |

Neither package sends compressed bytes to a model. zlib output is an archive
for later decompression and integrity checks; a model reads text.

---

## 1. Library: `@parad0x_labs/context-capsule`

Source: [`packages/context-capsule/src/index.ts`](https://github.com/Parad0x-Labs/dna-x402/blob/b03fec0df462eb3d55ba939cf6e499980be6afd3/packages/context-capsule/src/index.ts). All line numbers refer to the revision above.

### 1.1 history -> stored representation

`compressContext(messages, { sessionId? })` (L178-226):

1. Serialises the input as JSONL, one `JSON.stringify({role, content})` per line, in input order.
2. Deflates the JSONL with zlib level 9 and stores it base64-encoded in `compressedBase64`. This is lossless; inflating it returns the exact JSONL.
3. Records `originalTokenEstimate = ceil(jsonl.length / 4)` and `compressionRatio = jsonlBytes / deflateBytes` (3.1x on the bundled 109-message fixture).
4. Extracts up to 5 `topics` (L120-154): Title Case 2-4 word runs, then capitalised words of 4+ letters, then lowercase words of 7+ letters, first-seen order, deduplicated. No ranking, no facts, no IDs, no constraints.
5. Builds a SHA-256 Merkle root over `sha256(JSON.stringify(message))` leaves (odd node duplicated) and a `capsuleId`.

The result is a plain in-memory object. The library does not write it anywhere; persisting it (and keeping the Merkle root somewhere trusted) is the caller's job. No function verifies a message against the root; a caller recomputes it.

### 1.2 stored representation -> compact prompt representation

`injectCapsule(capsule)` (L238-251) returns one line:

```text
[CONTEXT CAPSULE: session <id> compressed <ratio>. Key topics: <up to 5 topics>. Merkle: <12 hex>... Full history available on request.]
```

On the bundled fixture this is 53 chars/4 tokens. It carries no facts, decisions, identifiers or constraints beyond whatever words appear in the 5 topics. The `maxTokens` argument is unused. In the scope benchmark, 2 of 40 questions have all their keywords in this string.

`taggedCompressContext()` (L659-741) adds per-message intent tags (regex heuristics in `tagMessageIntent`, L526-611: ACK, QUERY, CORRECTION, ADDITIVE, INSTRUCTION) and an `activeInstructions` list where a CORRECTION replaces the earlier user instruction it shares the most content words with. `injectEnrichedCapsule()` (L753-773) prints only the **counts** ("Active instructions: N. Corrections applied: M") plus the same topics; the corrected instruction text stays on the object. A caller who wants the model to see the corrected instructions must render `capsule.activeInstructions` into the prompt itself.

### 1.3 search / retrieval

`searchCapsule(capsule, query, opts?)` (L279-331):

- inflates the **whole** archive on every call (no index, no partial decompression);
- splits the query on whitespace, lowercases each term, and keeps every message whose content contains **any** term as a substring (so `is` matches `this`, and `session?` keeps its `?`);
- returns the matching messages, full and untruncated, in original order, formatted `[ROLE]: content`, under a header line with counts only (before 1.2.0 the header repeated the query);
- by default has no result limit and no ranking; with `{ limit: n }` (1.2.0) it keeps the `n` messages containing the most distinct query terms, still in original order.

Retrieval is lexical, not semantic. With a natural-language question as the query, common words match most messages: on the fixture, `searchCapsule(capsule, <question>)` returns on average 92.9 of 109 messages (about 6,800 tokens). With only the question's content words it returns 22.4 messages on average (about 2,600 tokens); adding `{ limit: 8 }` returns at most 8 (about 1,130 tokens).

### 1.4 materialised text -> model input

Nothing is retrieved automatically. The documented call sequence is:

1. put `injectCapsule(capsule)` in the prompt;
2. when the model or the caller decides it needs detail, call `searchCapsule(capsule, terms)`;
3. put that returned text in a later prompt.

Step 2 is the caller's decision. If the caller never calls `searchCapsule`, the model has the 53-token pointer and nothing else from the earlier history. "Full history available on request" in the pointer is an instruction to the model; the library does not register a tool. A caller who wants model-driven retrieval must expose `searchCapsule` as a tool and count its responses as input tokens.

### 1.5 ordering and corrections

- The archive keeps exact original order and wording; `searchCapsule` returns matches in that order.
- The pointer string has no order or correction information. On the bundled fixture its topics include "Use Redis", an instruction the session later retracts ("scratch that").
- `activeInstructions` (enriched capsule) and `buildCorrectionChain()` (L840-918) resolve corrections by keyword heuristics. They are not consulted by `injectCapsule` or `searchCapsule`. `searchCapsule` returns both the original and the correcting message when both match; deciding which is current is left to the reader.

### 1.6 correction-chain anchoring

`anchorCorrectionChain(chain, rpcUrl?)` (L959-1024) computes a Merkle root over the chain's `correctionHash` values. It returns the string `dry_run:<root>`, logs the reason and sends nothing when `SOLANA_KEYPAIR` is not set, when no RPC endpoint is given (neither `rpcUrl` nor `CONTEXT_CAPSULE_ANCHOR_RPC`), or when `@solana/web3.js` is not installed; that string is not a transaction, receipt or settlement. Only with all three present does it send an SPL Memo `correction_chain:<root>`, signed by that keypair, to that endpoint and return the signature. There is no default cluster: up to 1.1.0 a missing `rpcUrl` meant mainnet-beta. `verifiableCapsule()` (L1054-1061) calls it only when corrections exist and anchoring is enabled, passing `opts.rpcUrl`.

### 1.7 files in the repository but not in the package

`src/active-state.ts` (an alternate correction graph) and `src/semantic-tagger.ts` (calls a local Ollama/LM Studio model at `http://127.0.0.1:11434` for ambiguous corrections) were in the 1.0.0 tarball's `src/` directory but never reachable: `exports` maps only `.` to `src/index.ts`, which imports neither. From 1.2.0 the package ships only `src/index.ts`, `README.md` and `CHANGELOG.md`. No exported function calls a model.

---

## 2. OpenClaw plugin: `@parad0x_labs/openclaw-context-capsule`

Source: [`skills/context-capsule/src/index.ts`](../skills/context-capsule/src/index.ts) (engine) and [`skills/context-capsule/src/compression.ts`](../skills/context-capsule/src/compression.ts) (core).

### 2.1 history -> stored representation

The plugin is stateless. `ingest()` stores nothing. OpenClaw keeps the transcript; on every model call it passes the full message list to `assemble()`. The plugin rebuilds the capsule from that list each time. `compact()` delegates transcript compaction to OpenClaw's runtime (`delegateCompactionToRuntime`); what OpenClaw does there is outside this package.

Inside `compressContext()` (compression L1111-1177) a zlib archive and Merkle root are computed over the redacted older messages, as in the library, but the plugin does not return, persist or expose them; only a 12-hex Merkle prefix and the zlib ratio appear in the capsule header.

### 2.2 compact prompt representation

`assemble()` (index L259-343):

1. Redacts every message with the vault patterns (index L33-55: PEM keys, provider key prefixes, JWT, Bearer, `key=value` credentials, card-number shapes), including the recent tail.
2. Returns the (redacted) history without compression when it has fewer than 20 messages, fewer than 900 estimated tokens, or 2 or fewer messages.
3. Otherwise splits into `older` and a verbatim `tail` of the last 10 messages. If OpenClaw passes a `tokenBudget`, the tail shrinks (to a floor of 2 messages) until it fits in `max(600, 0.35 x tokenBudget)` tokens, and the capsule budget becomes `min(maxCapsuleTokens, max(120, 0.14 x tokenBudget))`. Default capsule budget: 1,400 tokens.
4. Builds the capsule text from `older` (below) and returns it as `systemPromptAddition`, wrapped in a short instruction that the capsule is lossy and that struck items were abandoned. `messages` carries only the tail.

Capsule construction (compression L1111-1273), all deterministic:

- Redacts again with shape/prefix/context rules (L317-401) before zlib, hashing or extraction. Each redaction becomes `[REDACTED_<TYPE>#<8 hex of sha256(secret)>]`. Git SHAs, UUIDs, semver, base58 addresses and short integers are allowlisted.
- Bounds analysis input: first 1,200 messages, 64 KB per message, non-whitespace runs over 256 chars collapsed (L106-251).
- **Facts** (L1029-1081): every non-trivial line becomes a candidate, classified as error, decision, task, file/command/ref, question or durable fact by regex, and scored by role (user > assistant > tool), recency, and pattern hits (errors, decisions, tasks, paths, commands, URLs, IDs). Verbatim **atoms** (URLs, file paths, shell commands, 20+ char hashes, ports, issue refs, versions, ISO dates, hyphenated codes) are added as separate candidates with a score bonus. The top 220 by score are kept and re-sorted by source position.
- **Supersession** (L767-963): explicit pivot grammar ("forget X", "replace X with Y", "from X to Y", "X is deprecated", typed "switch to port Y" pairs, wholesale "scratch that") marks concrete tokens as abandoned unless they reappear affirmatively later.
- **Injection quarantine** (L417-438): lines matching prompt-injection grammar are emitted as quoted untrusted text.
- **Emission** (L1184-1273): header, topics (up to 8), a "Superseded" block of struck subjects, then facts grouped by kind in priority order error, decision, file/ref, task, question, fact (chronological within each group), skipping any fact that mentions an abandoned subject, until the character budget (`4 x maxOutputTokens`) is full; then a count of omitted facts.

### 2.3 search / retrieval and materialisation

There is no retrieval path. Older content that did not make the budget is not sent to the model by this plugin, and the plugin offers no way for the model to ask for it. The only text the model receives is `systemPromptAddition` (capsule) + the verbatim tail + whatever OpenClaw adds.

### 2.4 ordering and corrections

- Global order is not kept: facts are grouped by kind; order is chronological only within a group.
- Explicit pivots are resolved (abandoned subject struck and its facts omitted). An update stated without a pivot cue (for example a value restated later with no "switch"/"instead") keeps both values, with no marker of which is current.
- The verbatim tail always reflects the latest turns.

---

## 3. Which number measures which stage

| Stage | Library measurement | Plugin measurement |
|---|---|---|
| Archive size | zlib ratio 3.1x on the fixture (31,818 -> 10,382 bytes) | same zlib step, not exposed |
| Initial prompt | 7,919 (JSONL) / 7,281 (formatted) -> 53 tokens (pointer only) | 7,281 -> 2,061 tokens per call (capsule + wrapper + tail) on the same fixture |
| Information available in one call | pointer alone: 2/40 questions | capsule + tail: 21/40 questions |
| With retrieval | question as query: 34/40 (34/35 answerable) at ~6,800 tokens; content words: 33/40 at ~2,600 tokens; content words with `limit: 8`: 32/40 at ~1,130 tokens | n/a |
| End-to-end model task success, total tokens, cost | not measured | not measured |

Full numbers, method and reproduction: [CONTEXT_CAPSULE_BENCHMARK.md](CONTEXT_CAPSULE_BENCHMARK.md) (plugin) and [dna-x402 docs/CONTEXT_CAPSULE_BENCHMARK.md](https://github.com/Parad0x-Labs/dna-x402/blob/main/docs/CONTEXT_CAPSULE_BENCHMARK.md) (library).
