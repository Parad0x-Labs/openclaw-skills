/**
 * Public-fixture benchmark for the OpenClaw context-capsule plugin
 * (deterministic, no LLM, no network, no file reads outside bench/).
 *
 * Fixture: bench/fixtures/agent-session-100.json (109 messages) and
 * bench/fixtures/recovery-questions.json (40 questions). Both are byte-identical
 * copies of the fixture used by @parad0x_labs/context-capsule in
 * Parad0x-Labs/dna-x402 (packages/context-capsule/bench/fixtures), so the two
 * packages can be compared on the same data.
 *
 * Arms (the text the model would receive, per question):
 *   full_history       every message verbatim
 *   window_last_10     the 10 most recent messages verbatim
 *   plugin_default     what assemble() sends with default config and no host
 *                      token budget: systemPromptAddition (capsule of the older
 *                      99 messages at maxCapsuleTokens=1400, plus the fixed
 *                      wrapper text) + the last 10 messages verbatim
 *   capsule_all_700    extractive capsule of all 109 messages, budget 700, no tail
 *   capsule_all_1400   extractive capsule of all 109 messages, budget 1400, no tail
 *
 * Metric: keyword_pass = every required keyword of a question appears
 * (case-insensitive) in the arm's text. This is a deterministic availability
 * check — whether the answer text reaches the model — NOT model task success.
 * Tokens are chars/4 estimates (the same estimator the plugin uses).
 *
 * The plugin has no retrieval call: whatever is not in the capsule or the tail
 * is not sent to the model by this plugin.
 *
 * Run (after `npm run build`): node bench/fixture-bench.mjs [--json]
 * Writes bench/results/latest.json and bench/results/latest.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compressContext, injectCapsule } from '../dist/compression.js';

const here = dirname(fileURLToPath(import.meta.url));
const messages = JSON.parse(readFileSync(join(here, 'fixtures', 'agent-session-100.json'), 'utf8'));
const questions = JSON.parse(readFileSync(join(here, 'fixtures', 'recovery-questions.json'), 'utf8'));

const KEEP_RECENT = 10; // DEFAULT_KEEP_RECENT in src/index.ts
const PLUGIN_BUDGET = 1400; // DEFAULT_MAX_CAPSULE_TOKENS in src/index.ts

const tok = (s) => Math.ceil(s.length / 4);
const fmt = (ms) => ms.map((m) => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n');
const pass = (text, kws) => {
  const lower = text.toLowerCase();
  return kws.every((k) => lower.includes(k.toLowerCase()));
};

// Mirrors the systemPromptAddition wrapper in src/index.ts (v1.7.0).
const wrap = (summaryText) =>
  `[Context Capsule — compressed older conversation history]\n${summaryText}\n\n` +
  'The block above is a lossy extractive capsule of earlier turns (the recent ' +
  'messages below it remain verbatim). Use it for continuity; ask the user to ' +
  'restate exact wording when precision matters. Anything marked superseded/~~ ' +
  'was abandoned — do not act on it.';

const capsuleText = (msgs, budget) =>
  injectCapsule(compressContext(msgs, { sessionId: 'fixture-bench', maxOutputTokens: budget }), {
    maxOutputTokens: budget,
  });

const t0 = Date.now();
const older = messages.slice(0, -KEEP_RECENT);
const tail = messages.slice(-KEEP_RECENT);
const olderCapsule = capsuleText(older, PLUGIN_BUDGET);
const pluginSystem = wrap(olderCapsule);

const armText = {
  full_history: fmt(messages),
  window_last_10: fmt(tail),
  plugin_default: `${pluginSystem}\n\n${fmt(tail)}`,
  capsule_all_700: capsuleText(messages, 700),
  capsule_all_1400: capsuleText(messages, 1400),
};
const armNames = Object.keys(armText);
const contentText = messages.map((m) => m.content).join('\n');

const perQuestion = questions.map((q) => {
  const row = { id: q.id, category: q.category, answerable: pass(contentText, q.required_keywords) };
  for (const a of armNames) row[a] = pass(armText[a], q.required_keywords);
  return row;
});
const runtimeMs = Date.now() - t0;

const answerable = perQuestion.filter((r) => r.answerable);
const arms = Object.fromEntries(
  armNames.map((a) => {
    const passed = perQuestion.filter((r) => r[a]).length;
    return [
      a,
      {
        tokens_per_call: tok(armText[a]),
        keyword_pass: passed,
        keyword_pass_percent: Math.round((passed / questions.length) * 1000) / 10,
        keyword_pass_answerable: answerable.filter((r) => r[a]).length,
      },
    ];
  }),
);

const result = {
  schema: 'openclaw-context-capsule.fixture-bench.v1',
  package_version: JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version,
  fixture: 'agent-session-100',
  messages: messages.length,
  questions: questions.length,
  answerable_questions: answerable.length,
  unanswerable_question_ids: perQuestion.filter((r) => !r.answerable).map((r) => r.id),
  tokenizer: 'chars/4 estimate (Math.ceil(length / 4)); no model tokenizer',
  model_calls: 0,
  metric_note:
    'keyword_pass = every required keyword present in the text the model would receive. Availability check only, not model task success.',
  plugin_config: { keepRecentMessages: KEEP_RECENT, maxCapsuleTokens: PLUGIN_BUDGET, tokenBudget: null },
  plugin_default_breakdown: {
    capsule_tokens: tok(olderCapsule),
    system_prompt_addition_tokens: tok(pluginSystem),
    tail_tokens: tok(fmt(tail)),
    older_history_tokens: tok(fmt(older)),
  },
  arms,
  per_question: perQuestion,
  runtime_ms: runtimeMs,
  node: process.version,
  timestamp: new Date().toISOString(),
};

const resultsDir = join(here, 'results');
mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, 'latest.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');

const label = {
  full_history: 'Full history (no compression)',
  window_last_10: 'Sliding window, last 10 messages',
  plugin_default: 'Plugin default: capsule of older 99 @1400 + last 10 verbatim',
  capsule_all_700: 'Capsule of all 109 messages @700, no tail',
  capsule_all_1400: 'Capsule of all 109 messages @1400, no tail',
};
const md = [
  '# openclaw-context-capsule public-fixture benchmark',
  '',
  `Package ${result.package_version}. Fixture \`agent-session-100\` (${messages.length} messages), ${questions.length} questions (${answerable.length} answerable from the session text; unanswerable: ${result.unanswerable_question_ids.join(', ')}). Tokenizer: chars/4 estimate. Model calls: 0.`,
  '',
  '| Arm | Tokens per call | Keyword pass (of 40) | Of answerable |',
  '|---|---:|---:|---:|',
  ...armNames.map(
    (a) =>
      `| ${label[a]} | ${arms[a].tokens_per_call} | ${arms[a].keyword_pass}/${questions.length} (${arms[a].keyword_pass_percent}%) | ${arms[a].keyword_pass_answerable}/${answerable.length} |`,
  ),
  '',
  `Plugin default breakdown: older history ${result.plugin_default_breakdown.older_history_tokens} tokens -> capsule ${result.plugin_default_breakdown.capsule_tokens} tokens (system prompt addition incl. wrapper ${result.plugin_default_breakdown.system_prompt_addition_tokens}); verbatim tail ${result.plugin_default_breakdown.tail_tokens} tokens.`,
  '',
  'Keyword pass is an availability check (is the answer text in what the model receives), not model task success. The plugin makes no retrieval call.',
  '',
  `Generated ${result.timestamp} with Node ${process.version}. Regenerate: \`npm run build && node bench/fixture-bench.mjs\`.`,
  '',
];
writeFileSync(join(resultsDir, 'latest.md'), md.join('\n'), 'utf8');

if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else console.log(md.join('\n'));
