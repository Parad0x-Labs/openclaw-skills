# Changelog

## Unreleased

- **Docs: measured scope.** SKILL.md fidelity figures from private sessions
  (~79% / ~93% key-signal recall) replaced with numbers from a public fixture
  (`bench/fixtures`, shared with `@parad0x_labs/context-capsule`), reproducible
  with `bench/fixture-bench.mjs` and `test/fidelity-bench.mjs`. Supersession
  figure restated as measured on the 6-case set in `test/supersession-bench.mjs`
  (6/6 at v1.7.0; the 83% figure is the test's floor).
- **CI.** The skills CI lane now runs `npm test` and the fixture benchmark for this
  skill. Before this, CI ran typecheck only and `npm test` ran locally and in
  `prepublishOnly`; the 1.7.0 notes below calling these checks "CI-gated" refer to
  that `npm test` run.

## 1.7.0

- **Value-atom preservation.** A lone distinctive value — a bare port (`5433`), an
  issue ref (`#4821`), a version (`v2.13.0`), an ISO date, or a hyphenated code
  (`NEEDLE-ZX-7742`) — is now emitted as its own dense atom, so it survives
  compression even when its surrounding sentence loses the budget race. Previously
  such a value only survived when its whole line was selected. New regression:
  `test/value-survival.test.mjs` (wired into `npm test`).
- **Docs accuracy.** Corrected the documented config defaults (`maxCapsuleTokens`
  `700` → `1400`, `capsuleTokenRatio` `0.08` → `0.14`) to match the shipped values.
  Reframed the fidelity figures to state plainly that they are measured on the
  maintainer's own private sessions via `test/fidelity-bench.mjs` (reproduce on your
  own `~/.openclaw` sessions), not a repo fixture. The supersession clean rate (83%
  floor) and value-survival remain CI-gated by `npm test`.

## 1.6.0

- Self-contained compression core bundled in `src/compression.ts` (no external
  runtime dependency; no network / file-system / on-chain calls).
