/**
 * Jobs page counts consumer — activeTotal lock (2026-04-09)
 *
 * Source-level guardrail. The Jobs page used to compute its "All" tab number
 * with `counts.total - counts.lifecycle.archived`. That manual subtraction was
 * promoted into the canonical `JobCounts.activeTotal` field. This test makes
 * sure nobody silently reintroduces the subtraction in Jobs.tsx.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const JOBS_PATH = resolve(process.cwd(), "client/src/pages/Jobs.tsx");
const source = readFileSync(JOBS_PATH, "utf8");

describe("Jobs.tsx — counts consumer uses activeTotal", () => {
  it("uses counts.activeTotal for the All tab total", () => {
    expect(source).toContain("counts.activeTotal");
  });

  it("does NOT subtract counts.lifecycle.archived from counts.total manually", () => {
    // Catches both `counts.total - counts.lifecycle.archived` and minor whitespace variants.
    expect(source).not.toMatch(/counts\.total\s*-\s*counts\.lifecycle\.archived/);
  });

  it("default counts fallback object includes activeTotal: 0", () => {
    // Make sure the SSR/loading-state fallback stays in sync with the new shape.
    expect(source).toMatch(/activeTotal:\s*0/);
  });
});
