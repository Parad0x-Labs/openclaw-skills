/**
 * Fails when a fresh bench/fixture-bench.mjs run disagrees with the committed
 * bench/results/latest.json, ignoring timestamp, runtime and Node version.
 *
 * Usage: node bench/check-drift.mjs <committed-latest.json> <fresh-latest.json>
 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const [committed, fresh] = process.argv.slice(2);
if (!committed || !fresh) {
  console.error('usage: check-drift.mjs <committed-latest.json> <fresh-latest.json>');
  process.exit(2);
}
const VOLATILE = new Set(['timestamp', 'runtime_ms', 'node']);
const strip = (v) =>
  Array.isArray(v)
    ? v.map(strip)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k)).map(([k, x]) => [k, strip(x)]))
      : v;
const a = strip(JSON.parse(readFileSync(committed, 'utf8')));
const b = strip(JSON.parse(readFileSync(fresh, 'utf8')));
if (isDeepStrictEqual(a, b)) {
  console.log('ok    bench/results/latest.json matches a fresh run');
} else {
  console.log('DRIFT bench/results/latest.json differs from a fresh run; run `npm run build && node bench/fixture-bench.mjs` and commit the result');
  process.exit(1);
}
