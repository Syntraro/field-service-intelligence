/**
 * Jobs list — column order and Property Address column pins.
 * (2026-05-09)
 *
 * Locks:
 *   • Both liveJobColumns and historyJobColumns have exactly 6 column ids in
 *     the canonical order: location → summary → address → schedule → status → jobNumber.
 *   • "address" column uses entity-text cell type with inline construction
 *     from locationAddress + locationCity (no shared formatter exists).
 *   • Job # (id="jobNumber") is the LAST column in both arrays (position 6).
 *   • No typography overrides inside address cell (no text-xs, text-sm, etc.)
 *   • Header label for Job # column is "Job #" (updated from "Job").
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const JOBS_PAGE = resolve(ROOT, "client/src/pages/Jobs.tsx");

const src = readFileSync(JOBS_PAGE, "utf-8");

// ── 1. Column order (source-pin approach) ─────────────────────────────

describe("Jobs list — liveJobColumns column order", () => {
  it("declares 6 column ids in the required order", () => {
    // Extract the liveJobColumns useMemo block and assert id order.
    const block = src.match(/liveJobColumns\s*=\s*useMemo[\s\S]+?\], \[\]\);/)?.[0] ?? "";
    expect(block, "liveJobColumns block must be found").toBeTruthy();

    const ids = [...block.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
      "location",
      "summary",
      "address",
      "schedule",
      "status",
      "jobNumber",
    ]);
  });

  it("jobNumber column is the last id", () => {
    const block = src.match(/liveJobColumns\s*=\s*useMemo[\s\S]+?\], \[\]\);/)?.[0] ?? "";
    const ids = [...block.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ids[ids.length - 1]).toBe("jobNumber");
  });

  it("address column uses entity-text cell type", () => {
    expect(src).toMatch(/id:\s*"address"[\s\S]{0,200}type:\s*"entity-text"/);
  });

  it("address column header is 'Property Address'", () => {
    expect(src).toMatch(/id:\s*"address"[\s\S]{0,200}header:\s*"Property Address"/);
  });

  it("address column sources from locationAddress and locationCity", () => {
    expect(src).toMatch(/locationAddress[\s\S]{0,100}locationCity/);
  });

  it("address construction joins non-null parts with ', '", () => {
    expect(src).toMatch(/\.filter\(Boolean\)\.join\(",\s*"\)/);
  });

  it("jobNumber column header is 'Job #'", () => {
    // header precedes sortKey in the column definition, so match via id → header.
    expect(src).toMatch(/id:\s*"jobNumber"[\s\S]{0,150}header:\s*"Job #"[\s\S]{0,150}sortKey:\s*"jobNumber"/);
  });
});

describe("Jobs list — historyJobColumns column order", () => {
  it("declares 6 column ids in the required order", () => {
    const block = src.match(/historyJobColumns\s*=\s*useMemo[\s\S]+?\], \[\]\);/)?.[0] ?? "";
    expect(block, "historyJobColumns block must be found").toBeTruthy();

    const ids = [...block.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
      "location",
      "summary",
      "address",
      "schedule",
      "status",
      "jobNumber",
    ]);
  });

  it("jobNumber column is the last id", () => {
    const block = src.match(/historyJobColumns\s*=\s*useMemo[\s\S]+?\], \[\]\);/)?.[0] ?? "";
    const ids = [...block.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ids[ids.length - 1]).toBe("jobNumber");
  });

  it("address column present with entity-text type", () => {
    const block = src.match(/historyJobColumns\s*=\s*useMemo[\s\S]+?\], \[\]\);/)?.[0] ?? "";
    expect(block).toMatch(/id:\s*"address"/);
    expect(block).toMatch(/type:\s*"entity-text"/);
  });

  it("historyJobColumns jobNumber header is 'Job #'", () => {
    const block = src.match(/historyJobColumns\s*=\s*useMemo[\s\S]+?\], \[\]\);/)?.[0] ?? "";
    // Find the jobNumber column's header within history block
    expect(block).toMatch(/id:\s*"jobNumber"[\s\S]{0,100}header:\s*"Job #"/);
  });
});

// ── 2. No raw typography class overrides inside address cell ──────────

describe("Jobs list — address column typography", () => {
  it("does not use ad-hoc text-xs / text-sm inside the address value function", () => {
    // Strip the address column definition to check its value fn only.
    // The column definition is identified by id="address" and should not
    // contain raw size overrides — entity-text type handles rendering.
    const addrBlock = src.match(/id:\s*"address"[\s\S]{0,400}(?=\{[\s\n]*id:|\]\s*,\s*\[\])/)?.[0] ?? "";
    expect(addrBlock, "address column definition must be extractable").toBeTruthy();
    // No ad-hoc size classes (text-xs, text-sm, text-base, text-lg, text-xl)
    expect(addrBlock).not.toMatch(/className="[^"]*text-xs/);
    expect(addrBlock).not.toMatch(/className="[^"]*text-sm/);
  });
});

// ── 3. Fallback when both address fields are null ─────────────────────

describe("Jobs list — address fallback to em-dash", () => {
  it("uses '—' em-dash as the empty fallback for address", () => {
    expect(src).toMatch(/\.filter\(Boolean\)\.join\([\s\S]{0,10}\)\s*\|\|\s*"—"/);
  });
});
