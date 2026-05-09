/**
 * PM Workspace — Work Due table column layout + typography guardrails (2026-05-09).
 *
 * Pins the post-cleanup column contract:
 *   1. Client column shows client name only — no secondary address/city line.
 *   2. Plan column shows plan name only — no secondary client/location line.
 *      Plan uses text-list-body (400 weight) — entity-primary bakes text-list-primary/500.
 *   3. Service Address column exists between Plan and Frequency.
 *      Line 1: street address (text-list-body).
 *      Line 2: city/province/postal (text-helper text-muted-foreground).
 *   4. Column order: Client → Plan → Service Address → Frequency → Due Date → Status → Action.
 *   5. Client interface declares locationAddress, locationProvince, locationPostal.
 *
 * Source-pin tests only — no JSDOM, no mounts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE_PATH = resolve(ROOT, "client/src/pages/PMWorkspacePage.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

const src = read(PAGE_PATH);

// Strip block + line comments so assertions read literal code, not doc-blocks.
const noComments = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// ─── 1. UpcomingQueueItem interface ────────────────────────────────────────

describe("UpcomingQueueItem interface — address fields declared", () => {
  it("declares locationAddress: string | null", () => {
    expect(src).toMatch(/locationAddress:\s*string\s*\|\s*null/);
  });

  it("declares locationCity: string | null", () => {
    expect(src).toMatch(/locationCity:\s*string\s*\|\s*null/);
  });

  it("declares locationProvince: string | null", () => {
    expect(src).toMatch(/locationProvince:\s*string\s*\|\s*null/);
  });

  it("declares locationPostal: string | null", () => {
    expect(src).toMatch(/locationPostal:\s*string\s*\|\s*null/);
  });
});

// ─── 2. Client column — name only ──────────────────────────────────────────

describe("Work Due — Client column: name only, no secondary", () => {
  const clientBlock = noComments.match(/id:\s*"client"[\s\S]*?(?=\},\s*\{[\s\S]*?id:|$)/)?.[0] ?? "";

  it("client column exists with id: \"client\"", () => {
    expect(src).toMatch(/id:\s*"client"/);
  });

  it("client column value renders customerName", () => {
    expect(clientBlock).toMatch(/customerName/);
  });

  it("client column has NO secondary renderer", () => {
    expect(clientBlock).not.toMatch(/secondary:/);
  });

  it("client column does NOT reference locationCity", () => {
    expect(clientBlock).not.toMatch(/locationCity/);
  });

  it("client column does NOT reference locationAddress", () => {
    expect(clientBlock).not.toMatch(/locationAddress/);
  });

  it("client column does NOT reference locationName", () => {
    expect(clientBlock).not.toMatch(/locationName/);
  });
});

// ─── 3. Plan column — non-bold, no secondary ───────────────────────────────

describe("Work Due — Plan column: non-bold plan name only", () => {
  const planBlock = noComments.match(/id:\s*"plan"[\s\S]*?(?=\},\s*\{[\s\S]*?id:|$)/)?.[0] ?? "";

  it("plan column exists with id: \"plan\"", () => {
    expect(src).toMatch(/id:\s*"plan"/);
  });

  it("plan column renders templateTitle", () => {
    expect(planBlock).toMatch(/templateTitle/);
  });

  it("plan column uses customRender (to avoid entity-primary/500 bold)", () => {
    expect(planBlock).toMatch(/type:\s*"customRender"/);
  });

  it("plan column does NOT use entity-primary (which bakes text-list-primary/500)", () => {
    expect(planBlock).not.toMatch(/type:\s*"entity-primary"/);
  });

  it("plan column applies text-list-body (400 weight) on the text node", () => {
    expect(planBlock).toMatch(/text-list-body/);
  });

  it("plan column does NOT apply text-list-primary (500 weight) on the text node", () => {
    expect(planBlock).not.toMatch(/text-list-primary/);
  });

  it("plan column does NOT apply font-bold or font-semibold", () => {
    expect(planBlock).not.toMatch(/font-bold/);
    expect(planBlock).not.toMatch(/font-semibold/);
  });

  it("plan column does NOT reference locationName", () => {
    expect(planBlock).not.toMatch(/locationName/);
  });

  it("plan column does NOT reference customerName", () => {
    expect(planBlock).not.toMatch(/customerName/);
  });
});

// ─── 4. Service Address column ─────────────────────────────────────────────

describe("Work Due — Service Address column exists and renders two lines", () => {
  const addrBlock = noComments.match(/id:\s*"serviceAddress"[\s\S]*?(?=\},\s*\{[\s\S]*?id:|$)/)?.[0] ?? "";

  it("serviceAddress column exists", () => {
    expect(src).toMatch(/id:\s*"serviceAddress"/);
  });

  it("header is \"Service Address\"", () => {
    expect(src).toMatch(/header:\s*"Service Address"/);
  });

  it("uses customRender (two-line layout requires escape hatch)", () => {
    expect(addrBlock).toMatch(/type:\s*"customRender"/);
  });

  it("line 1 renders locationAddress", () => {
    expect(addrBlock).toMatch(/locationAddress/);
  });

  it("line 1 uses text-list-body (not bold)", () => {
    // The street address line must NOT carry text-list-primary (500 weight).
    expect(addrBlock).toMatch(/text-list-body/);
  });

  it("line 1 does NOT use text-list-primary (which bakes weight 500)", () => {
    expect(addrBlock).not.toMatch(/text-list-primary/);
  });

  it("line 2 references locationCity for the city part", () => {
    expect(addrBlock).toMatch(/locationCity/);
  });

  it("line 2 references locationProvince", () => {
    expect(addrBlock).toMatch(/locationProvince/);
  });

  it("line 2 references locationPostal", () => {
    expect(addrBlock).toMatch(/locationPostal/);
  });

  it("line 2 uses text-helper (compact secondary token)", () => {
    expect(addrBlock).toMatch(/text-helper/);
  });

  it("line 2 uses text-muted-foreground for color", () => {
    expect(addrBlock).toMatch(/text-muted-foreground/);
  });

  it("line 2 is conditionally rendered (omitted when no city data)", () => {
    // The city line must be wrapped in a condition so empty rows don't show a blank line.
    expect(addrBlock).toMatch(/cityLine\s*&&/);
  });

  it("does NOT render customerName in the address column", () => {
    expect(addrBlock).not.toMatch(/customerName/);
  });

  it("does NOT render templateTitle in the address column", () => {
    expect(addrBlock).not.toMatch(/templateTitle/);
  });

  it("does NOT apply font-bold or font-semibold", () => {
    expect(addrBlock).not.toMatch(/font-bold/);
    expect(addrBlock).not.toMatch(/font-semibold/);
  });
});

// ─── 5. Column order: Client → Plan → Service Address → Frequency ──────────

describe("Work Due — column order preserved", () => {
  it("Client appears before Plan in the column array", () => {
    const clientPos = src.indexOf('"client"');
    const planPos = src.indexOf('"plan"');
    expect(clientPos).toBeGreaterThan(0);
    expect(planPos).toBeGreaterThan(0);
    expect(clientPos).toBeLessThan(planPos);
  });

  it("Plan appears before Service Address", () => {
    const planPos = src.indexOf('"plan"');
    const addrPos = src.indexOf('"serviceAddress"');
    expect(addrPos).toBeGreaterThan(0);
    expect(planPos).toBeLessThan(addrPos);
  });

  it("Service Address appears before Frequency", () => {
    const addrPos = src.indexOf('"serviceAddress"');
    const freqPos = src.indexOf('"frequency"');
    expect(freqPos).toBeGreaterThan(0);
    expect(addrPos).toBeLessThan(freqPos);
  });

  it("Frequency appears before Due Date", () => {
    const freqPos = src.indexOf('"frequency"');
    const dueDatePos = src.indexOf('"dueDate"');
    expect(dueDatePos).toBeGreaterThan(0);
    expect(freqPos).toBeLessThan(dueDatePos);
  });

  it("Due Date appears before Status", () => {
    const dueDatePos = src.indexOf('"dueDate"');
    const statusPos = src.indexOf('"status"');
    expect(statusPos).toBeGreaterThan(0);
    expect(dueDatePos).toBeLessThan(statusPos);
  });

  it("Status appears before Action", () => {
    const statusPos = src.indexOf('"status"');
    const actionPos = src.indexOf('"action"');
    expect(actionPos).toBeGreaterThan(0);
    expect(statusPos).toBeLessThan(actionPos);
  });
});

// ─── 6. Generate action behavior preserved ─────────────────────────────────

describe("Work Due — Generate action column unchanged", () => {
  it("action column still renders a Generate button", () => {
    expect(src).toMatch(/Generate/);
  });

  it("Generate button still has work-due-generate test id", () => {
    expect(src).toMatch(/data-testid=\{`work-due-generate-\$\{item\.instanceId\}`\}/);
  });

  it("Generate button still calls onGenerateOne", () => {
    expect(src).toMatch(/onGenerateOne\(item\.instanceId\)/);
  });
});

// ─── 7. No forbidden typography in Work Due columns ────────────────────────

describe("Work Due columns — no forbidden typography tokens", () => {
  // Extract all column definitions as one block for broader guards.
  const columnsBlock =
    noComments.match(/workDueColumns\s*=\s*useMemo[\s\S]*?\]\s*,\s*\[/)?.[0] ?? "";

  it("workDueColumns block exists (regex sanity)", () => {
    expect(columnsBlock.length).toBeGreaterThan(50);
  });

  it("workDueColumns does NOT use text-sm (banned size ramp)", () => {
    expect(columnsBlock).not.toMatch(/\btext-sm\b/);
  });

  it("workDueColumns does NOT use text-xs (banned size ramp)", () => {
    expect(columnsBlock).not.toMatch(/\btext-xs\b/);
  });

  it("workDueColumns does NOT use arbitrary text-[Npx] (banned raw sizes)", () => {
    // Allow text-[10px] only in the scheduling compact label block (untouched per spec).
    // The workDueColumns useMemo block should not contain any arbitrary sizes.
    expect(columnsBlock).not.toMatch(/text-\[\d+px\]/);
  });

  it("workDueColumns does NOT apply font-bold to Plan or Service Address", () => {
    expect(columnsBlock).not.toMatch(/font-bold/);
  });
});
