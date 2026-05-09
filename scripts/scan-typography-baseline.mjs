/**
 * scan-typography-baseline (2026-05-08).
 *
 * Walks `client/src/**` (.ts/.tsx), strips comments, and records the
 * count of legacy typography-ramp classes (`text-xs/-sm/-base/-lg/
 * -xl/-2xl/-3xl/-4xl`) and arbitrary `text-[Npx]` values per file.
 * The output is `tests/semantic-typography-baseline.json` — the
 * frozen baseline consumed by `tests/semantic-typography-guard.test.ts`.
 *
 * Re-run this script after a deliberate migration sweep that lowers
 * counts (so the baseline reflects the new floor). Do NOT re-run to
 * mask new drift — the test exists to catch new drift early.
 *
 * Usage:
 *   node scripts/scan-typography-baseline.mjs
 *
 * Files explicitly exempted from the baseline (see ALLOWED_FILES below):
 *   - `client/src/pages/StyleGuideTypographyPage.tsx` — the typography
 *     style-guide page itself intentionally renders every token in the
 *     legacy ramp for visual comparison.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCAN_DIR = join(ROOT, "client/src");
const OUT_PATH = join(ROOT, "tests/semantic-typography-baseline.json");

const ALLOWED_FILES = new Set([
  "client/src/pages/StyleGuideTypographyPage.tsx",
  "client/src/components/ui/typography.tsx",
]);

const LEGACY_RAMP_RE = /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl)\b/g;
const ARBITRARY_TEXT_RE = /\btext-\[[^\]]+\]/g;

// 2026-05-08 Phase S1: deprecated component-specific tokens. New code
// must reach for the preferred visual-hierarchy set (text-title /
// text-header / text-subheader / text-emphasis / text-body / text-row /
// text-caption / text-label / text-helper / text-error). Existing
// usages render unchanged via the live tailwind config; the guard
// blocks new usages.
const DEPRECATED_ALIASES = [
  "page-title",
  "section-title",
  "subhead",
  "modal-title",
  "row-emphasis",
  "table-header",
  "table-cell",
  "input",
  "email-body",
  "empty-state",
  "form-label",
  "form-helper",
  "select-label",
  "select-item",
];
// `\btext-(page-title|section-title|...)\b` — matches the alias only when
// it stands alone as a Tailwind class. Avoids false-matching `text-input`
// where `input` happens to be a substring.
const DEPRECATED_ALIAS_RE = new RegExp(
  `\\btext-(?:${DEPRECATED_ALIASES.join("|")})\\b`,
  "g",
);

function walk(dir) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function relPath(abs) {
  const rootFs = ROOT.split("\\").join("/");
  const absFs = abs.split("\\").join("/");
  return absFs.replace(rootFs + "/", "");
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const files = walk(SCAN_DIR).sort();
const baseline = {};
for (const f of files) {
  const r = relPath(f);
  if (ALLOWED_FILES.has(r)) continue;
  const src = stripComments(readFileSync(f, "utf-8"));
  const legacy = (src.match(LEGACY_RAMP_RE) || []).length;
  const arbitrary = (src.match(ARBITRARY_TEXT_RE) || []).length;
  const deprecated = (src.match(DEPRECATED_ALIAS_RE) || []).length;
  if (legacy === 0 && arbitrary === 0 && deprecated === 0) continue;
  baseline[r] = { legacy, arbitrary, deprecated };
}

const totalLegacy = Object.values(baseline).reduce((a, b) => a + b.legacy, 0);
const totalArbitrary = Object.values(baseline).reduce(
  (a, b) => a + b.arbitrary,
  0,
);
const totalDeprecated = Object.values(baseline).reduce(
  (a, b) => a + (b.deprecated || 0),
  0,
);

writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      generatedAt: "2026-05-08",
      description:
        "Frozen baseline of (a) legacy typography-ramp + arbitrary text-[Npx], and (b) deprecated component-specific aliases per Phase S1 (Simplified Semantic Typography). tests/semantic-typography-guard.test.ts fails when any file's count increases for any of the three families or a new file introduces them. Decreases (migrations) are allowed; re-run scripts/scan-typography-baseline.mjs after a sweep to lower the floor.",
      totalLegacy,
      totalArbitrary,
      totalDeprecated,
      files: baseline,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Baseline written: ${OUT_PATH}\n` +
    `  files=${Object.keys(baseline).length}\n` +
    `  totalLegacy=${totalLegacy}\n` +
    `  totalArbitrary=${totalArbitrary}\n` +
    `  totalDeprecated=${totalDeprecated}`,
);
