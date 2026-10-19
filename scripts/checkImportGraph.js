/**
 * scripts/checkImportGraph.js
 *
 * Regression guard for the 2026-10-19 production incident: js/main.js
 * statically imported ./config/notificationRouting.js, but that file
 * was never committed to main — the browser's module loader fetches a
 * script's entire static import graph before considering it loaded,
 * so the resulting 404 surfaced as "js/main.js failed to load" even
 * though main.js itself was fine. A shell/CI request to js/main.js
 * alone cannot catch this class of bug; only walking the actual
 * import graph can.
 *
 * Walks every statically-imported local module (relative specifiers
 * only — no bare/https specifiers, matching this app's own existing
 * ESM conventions) starting from js/main.js, and fails (non-zero exit)
 * if any resolved file is missing or exists only under a different
 * case than the import specifier names. No network calls, no
 * dependencies beyond Node's own fs/path — deterministic and fast
 * enough to run on every merge before the Hosting deploy step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(repoRoot, 'js', 'main.js');

const importRe = /\bimport\s+(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;

function existsExactCase(absPath) {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  return entries.includes(base);
}

const visited = new Set();
const broken = [];

function walk(absFilePath, importedFrom) {
  const relFromRoot = path.relative(repoRoot, absFilePath).replace(/\\/g, '/');
  if (visited.has(relFromRoot)) return;
  visited.add(relFromRoot);

  if (!existsExactCase(absFilePath)) {
    broken.push({ file: relFromRoot, importedFrom: path.relative(repoRoot, importedFrom).replace(/\\/g, '/') });
    return;
  }

  const content = fs.readFileSync(absFilePath, 'utf8');
  const specifiers = new Set();
  importRe.lastIndex = 0;
  let m;
  while ((m = importRe.exec(content))) {
    specifiers.add(m[1]);
  }

  for (const spec of specifiers) {
    walk(path.resolve(path.dirname(absFilePath), spec), absFilePath);
  }
}

walk(entry, entry);

if (broken.length > 0) {
  console.error(`Import graph check FAILED: ${broken.length} module(s) statically imported from js/main.js are missing from the repository.`);
  for (const b of broken) {
    console.error(`  - ${b.file}  (imported from ${b.importedFrom})`);
  }
  process.exit(1);
}

console.log(`Import graph check passed: ${visited.size} modules traced from js/main.js, all present.`);
