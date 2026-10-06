#!/usr/bin/env node
// Validates evidence/claims.json and keeps REVIEW.md's capability table in sync with it.
//
//   node scripts/check-claims-registry.mjs           check (exit 1 on any failure)
//   node scripts/check-claims-registry.mjs --write   regenerate the REVIEW.md table from the registry
//   node scripts/check-claims-registry.mjs --strict-readme   also fail when README.md does not link REVIEW.md
//
// No dependencies: Node.js built-ins only, so CI can run it without `npm ci`.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const WRITE = args.has("--write");
const STRICT_README = args.has("--strict-readme");

const REGISTRY = "evidence/claims.json";
const REVIEW = "REVIEW.md";
const TABLE_START = "<!-- claims-table:start (generated from evidence/claims.json; edit the registry, then run scripts/check-claims-registry.mjs --write) -->";
const TABLE_END = "<!-- claims-table:end -->";

const REQUIRED_FIELDS = [
  "id",
  "plain_claim",
  "component",
  "source_sha",
  "source_paths",
  "implementation_status",
  "package_version",
  "publication_status",
  "network",
  "program_id",
  "deployed_build_hash",
  "source_build_match",
  "authority_assumptions",
  "evidence_checked_at",
  "proof_files",
  "test_command",
  "test_run",
  "mocks_or_skips",
  "demonstrated_properties",
  "not_demonstrated",
  "operational_limitations",
  "supersedes",
];

const IMPLEMENTATION_STATUS = new Set([
  "implemented",
  "prototype",
  "scaffold",
  "hash-only",
  "mocked",
  "fail-closed",
  "retired",
  "planned",
  "missing",
  "pending-review",
]);
const PUBLICATION_STATUS = new Set([
  "published",
  "published-older-version",
  "not-published",
  "deprecated",
  "not-applicable",
  "unknown",
]);
const NETWORKS = new Set(["devnet", "testnet", "mainnet-beta", "localnet"]);
const BUILD_MATCH = new Set(["match", "mismatch", "unknown", "not-applicable"]);
const TEST_RESULTS = new Set(["pass", "fail", "partial", "not-run", "pending"]);

const SHA_RE = /^[0-9a-f]{40}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ID_RE = /^[a-z0-9][a-z0-9.-]*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z)?$/;

const failures = [];
const warnings = [];
const fail = (msg) => failures.push(msg);
const warn = (msg) => warnings.push(msg);

const rel = (p) => path.join(repoRoot, p);
const isUrl = (s) => /^https:\/\//.test(s);
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(rel(file), "utf8"));
  } catch (error) {
    fail(`${file}: cannot read or parse (${error.message})`);
    return null;
  }
}

function checkPath(where, p, pending) {
  if (isUrl(p)) return;
  if (p.startsWith("/") || p.includes("..")) {
    fail(`${where}: path must be repo-relative: ${p}`);
    return;
  }
  const clean = p.split("#")[0];
  if (!existsSync(rel(clean))) {
    (pending ? warn : fail)(`${where}: path does not exist: ${p}${pending ? " (claim is pending)" : ""}`);
  }
}

function checkClaim(claim, index, seen) {
  const where = `${REGISTRY} claims[${index}]${claim && claim.id ? ` (${claim.id})` : ""}`;
  if (!claim || typeof claim !== "object") {
    fail(`${where}: not an object`);
    return;
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in claim)) fail(`${where}: missing field "${field}" (use null when unknown)`);
  }
  const pending = typeof claim.pending === "string" && claim.pending.length > 0;

  if (typeof claim.id !== "string" || !ID_RE.test(claim.id)) fail(`${where}: id must match ${ID_RE}`);
  else if (seen.has(claim.id)) fail(`${where}: duplicate id`);
  else seen.add(claim.id);

  if (typeof claim.plain_claim !== "string" || claim.plain_claim.length < 10) fail(`${where}: plain_claim must be a sentence`);
  if (typeof claim.component !== "string" || !claim.component) fail(`${where}: component required`);

  if (claim.source_sha !== null && !SHA_RE.test(String(claim.source_sha))) fail(`${where}: source_sha must be a full 40-hex commit or null`);

  if (!isStringArray(claim.source_paths)) fail(`${where}: source_paths must be an array of paths`);
  else claim.source_paths.forEach((p) => checkPath(`${where} source_paths`, p, pending));

  if (!IMPLEMENTATION_STATUS.has(claim.implementation_status)) {
    fail(`${where}: implementation_status "${claim.implementation_status}" not in ${[...IMPLEMENTATION_STATUS].join("|")}`);
  }
  if (claim.implementation_status === "pending-review" && !pending) fail(`${where}: pending-review claims need a "pending" note`);

  // Package publication is recorded separately from Git source state.
  const pkg = claim.package_version;
  if (!PUBLICATION_STATUS.has(claim.publication_status)) fail(`${where}: publication_status not in ${[...PUBLICATION_STATUS].join("|")}`);
  if (pkg === null) {
    if (!["not-applicable", "unknown"].includes(claim.publication_status)) fail(`${where}: publication_status must be not-applicable/unknown when package_version is null`);
  } else if (typeof pkg !== "object") {
    fail(`${where}: package_version must be null or an object`);
  } else {
    for (const k of ["name", "package_json", "git_version", "npm_latest", "npm_checked_at"]) {
      if (!(k in pkg)) fail(`${where}: package_version.${k} missing (null when unknown)`);
    }
    if (pkg.package_json) {
      checkPath(`${where} package_version.package_json`, pkg.package_json, false);
      if (existsSync(rel(pkg.package_json))) {
        const manifest = readJson(pkg.package_json);
        if (manifest && manifest.name !== pkg.name) fail(`${where}: package name ${pkg.name} != ${pkg.package_json} name ${manifest.name}`);
        if (manifest && manifest.version !== pkg.git_version) {
          fail(`${where}: git_version ${pkg.git_version} != ${pkg.package_json} version ${manifest.version} (registry is stale)`);
        }
      }
    }
    if (pkg.npm_checked_at !== null && !ISO_RE.test(String(pkg.npm_checked_at))) fail(`${where}: package_version.npm_checked_at must be ISO-8601`);
    const expected =
      pkg.npm_latest === null
        ? ["not-published"]
        : pkg.npm_latest === pkg.git_version
          ? ["published", "deprecated"]
          : ["published-older-version", "deprecated"];
    if (!expected.includes(claim.publication_status)) {
      fail(`${where}: publication_status "${claim.publication_status}" inconsistent with git ${pkg.git_version} / npm ${pkg.npm_latest} (expected ${expected.join(" or ")})`);
    }
  }

  // Deployment claims must say which network they are about.
  const programIds = claim.program_ids && typeof claim.program_ids === "object" ? Object.values(claim.program_ids) : [];
  const isDeployment = claim.program_id !== null || programIds.length > 0;
  if (claim.network !== null && !NETWORKS.has(claim.network)) fail(`${where}: network "${claim.network}" not in ${[...NETWORKS].join("|")}`);
  if (isDeployment && !NETWORKS.has(claim.network)) fail(`${where}: deployment claim (program id present) requires a network label`);
  if (claim.program_id !== null && !BASE58_RE.test(String(claim.program_id))) fail(`${where}: program_id is not a base58 address`);
  for (const id of programIds) if (!BASE58_RE.test(String(id))) fail(`${where}: program_ids entry is not a base58 address: ${id}`);

  const dbh = claim.deployed_build_hash;
  if (dbh !== null) {
    const values = typeof dbh === "object" ? Object.values(dbh) : [dbh];
    for (const h of values) if (!HEX64_RE.test(String(h))) fail(`${where}: deployed_build_hash must be sha256 hex: ${h}`);
    if (!isDeployment) fail(`${where}: deployed_build_hash without a program id`);
  }
  if (!BUILD_MATCH.has(claim.source_build_match)) fail(`${where}: source_build_match not in ${[...BUILD_MATCH].join("|")}`);
  if (claim.source_build_match === "match" && dbh === null) fail(`${where}: source_build_match "match" needs deployed_build_hash`);

  for (const k of ["authority_assumptions", "mocks_or_skips", "demonstrated_properties", "not_demonstrated", "operational_limitations"]) {
    if (!Array.isArray(claim[k]) || !claim[k].every((x) => typeof x === "string")) fail(`${where}: ${k} must be an array of strings`);
  }
  if (Array.isArray(claim.not_demonstrated) && claim.not_demonstrated.length === 0 && claim.implementation_status !== "retired") {
    fail(`${where}: not_demonstrated must list at least one limit (state what is not established)`);
  }

  if (!ISO_RE.test(String(claim.evidence_checked_at))) fail(`${where}: evidence_checked_at must be ISO-8601`);

  if (!isStringArray(claim.proof_files)) fail(`${where}: proof_files must be an array of repo paths or https URLs`);
  else claim.proof_files.forEach((p) => checkPath(`${where} proof_files`, p, pending));

  if (claim.test_command !== null && typeof claim.test_command !== "string") fail(`${where}: test_command must be a string or null`);
  const tr = claim.test_run;
  if (tr !== null) {
    if (typeof tr !== "object" || !TEST_RESULTS.has(tr.result)) fail(`${where}: test_run.result not in ${[...TEST_RESULTS].join("|")}`);
    else if (tr.result !== "pending" && tr.result !== "not-run" && !ISO_RE.test(String(tr.date))) fail(`${where}: test_run.date required for a recorded result`);
  }

  const sup = claim.supersedes;
  if (sup !== null && !(typeof sup === "string" || isStringArray(sup))) fail(`${where}: supersedes must be null, a string or an array of strings`);
  if (claim.review && typeof claim.review !== "object") fail(`${where}: review must be an object`);
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function shortId(id) {
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function whereItRuns(claim) {
  if (claim.review && claim.review.where) return claim.review.where;
  if (claim.implementation_status === "missing" || claim.implementation_status === "planned") return "n/a (not implemented)";
  if (claim.network) {
    const ids = claim.program_id ? ` \`${shortId(claim.program_id)}\`` : claim.program_ids ? ` (${Object.keys(claim.program_ids).length} programs)` : "";
    return `${claim.network}${ids}`;
  }
  return "local / off-chain";
}

function publication(claim) {
  const pkg = claim.package_version;
  if (!pkg) return "";
  const npm = pkg.npm_latest === null ? "not on npm" : `npm ${pkg.npm_latest}`;
  return `; \`${pkg.name}\` git ${pkg.git_version}, ${npm}`;
}

function renderTable(claims) {
  const lines = [
    "| ID | Capability | Exists in source | Demonstrated | Where it runs | Not established |",
    "|---|---|---|---|---|---|",
  ];
  for (const c of claims) {
    const exists = `${c.implementation_status}${c.source_paths.length ? `: \`${c.source_paths[0]}\`` : ""}`;
    const demo = c.demonstrated_properties.length ? c.demonstrated_properties.join("; ") : "none recorded";
    const test = c.test_run ? ` (test: ${c.test_run.result}${c.test_run.date ? ` ${c.test_run.date}` : ""})` : "";
    lines.push(
      `| \`${cell(c.id)}\` | ${cell(c.plain_claim)} | ${cell(exists)} | ${cell(demo + test)} | ${cell(whereItRuns(c) + publication(c))} | ${cell(c.not_demonstrated.join("; ") || "n/a")} |`,
    );
  }
  return lines.join("\n");
}

function checkMarkdownLinks(file, text) {
  const linkRe = /\]\(([^)\s]+)\)/g;
  let m;
  while ((m = linkRe.exec(text))) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = decodeURIComponent(target.split("#")[0]);
    const resolved = path.normalize(path.join(path.dirname(file), clean));
    if (!existsSync(rel(resolved))) fail(`${file}: broken link ${target}`);
  }
}

function checkSnapshot(reg) {
  const s = reg.snapshot;
  if (!s || typeof s !== "object") {
    fail(`${REGISTRY}: snapshot object required`);
    return;
  }
  if (!SHA_RE.test(String(s.source_sha))) fail(`${REGISTRY}: snapshot.source_sha must be a full commit`);
  if (!ISO_RE.test(String(s.observed_at))) fail(`${REGISTRY}: snapshot.observed_at must be ISO-8601`);
  if (typeof s.default_branch !== "string") fail(`${REGISTRY}: snapshot.default_branch required`);
  // Source binding: the snapshot commit must be in this checkout's history.
  try {
    execFileSync("git", ["-C", repoRoot, "rev-parse", "--is-inside-work-tree"], { stdio: "pipe" });
    try {
      execFileSync("git", ["-C", repoRoot, "merge-base", "--is-ancestor", s.source_sha, "HEAD"], { stdio: "pipe" });
    } catch {
      const shallow = existsSync(rel(".git/shallow"));
      (shallow ? warn : fail)(`${REGISTRY}: snapshot.source_sha ${s.source_sha} is not an ancestor of HEAD${shallow ? " (shallow clone; use fetch-depth: 0)" : ""}`);
    }
  } catch {
    warn("not a git checkout: snapshot ancestry not checked");
  }
}

function main() {
  const reg = readJson(REGISTRY);
  if (!reg) return finish();
  if (reg.schema_version !== 1) fail(`${REGISTRY}: schema_version must be 1`);
  if (typeof reg.repository !== "string") fail(`${REGISTRY}: repository required`);
  checkSnapshot(reg);
  if (!Array.isArray(reg.claims) || reg.claims.length === 0) {
    fail(`${REGISTRY}: claims must be a non-empty array`);
    return finish();
  }
  const seen = new Set();
  reg.claims.forEach((c, i) => checkClaim(c, i, seen));
  for (const c of reg.claims) {
    const sup = c.supersedes === null ? [] : [].concat(c.supersedes);
    for (const s of sup) if (ID_RE.test(s) && !s.includes("/") && !seen.has(s)) warn(`${c.id}: supersedes unknown id ${s}`);
  }
  if (failures.length) return finish();

  // REVIEW.md: generated table must match the registry; links must resolve.
  if (!existsSync(rel(REVIEW))) {
    fail(`${REVIEW} missing`);
    return finish();
  }
  const review = readFileSync(rel(REVIEW), "utf8");
  const start = review.indexOf(TABLE_START);
  const end = review.indexOf(TABLE_END);
  if (start === -1 || end === -1 || end < start) {
    fail(`${REVIEW}: claims-table markers missing`);
    return finish();
  }
  const table = renderTable(reg.claims);
  const current = review.slice(start + TABLE_START.length, end).trim();
  if (current !== table) {
    if (WRITE) {
      writeFileSync(rel(REVIEW), `${review.slice(0, start + TABLE_START.length)}\n${table}\n${review.slice(end)}`);
      console.log(`${REVIEW}: table regenerated`);
    } else {
      fail(`${REVIEW}: capability table differs from ${REGISTRY}; run node scripts/check-claims-registry.mjs --write`);
    }
  }
  checkMarkdownLinks(REVIEW, review);
  if (!review.includes(String(reg.snapshot.source_sha).slice(0, 7))) fail(`${REVIEW}: must state the snapshot commit ${reg.snapshot.source_sha}`);

  // Entry points must lead to the review path.
  for (const [file, strict] of [["AGENTS.md", true], ["README.md", STRICT_README]]) {
    if (!existsSync(rel(file))) {
      (strict ? fail : warn)(`${file} missing`);
      continue;
    }
    if (!/\]\(\.?\/?REVIEW\.md\)/.test(readFileSync(rel(file), "utf8"))) (strict ? fail : warn)(`${file}: no link to REVIEW.md`);
  }
  finish();
}

function finish() {
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (failures.length) {
    console.error("Claims registry check failed:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.log(`Claims registry check passed (${warnings.length} warning${warnings.length === 1 ? "" : "s"}).`);
}

main();
