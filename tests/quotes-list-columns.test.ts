/**
 * QuotesListPage column structure — source-pin tests (2026-05-09).
 *
 * Pins the column order, Service Address column presence, and Quote #
 * de-emphasis to the right-most position following the operational
 * scanning refactor.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const QUOTES_PATH = resolve(ROOT, "client/src/pages/Quotes.tsx");
const src = readFileSync(QUOTES_PATH, "utf8");

function columnsBlock(src: string): string {
  const start = src.indexOf("const quoteColumns");
  const end = src.indexOf("], []);", start) + 5;
  return src.slice(start, end);
}

const cols = columnsBlock(src);

function columnIds(block: string): string[] {
  const ids: string[] = [];
  const re = /id:\s*["'](\w+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

describe("QuotesListPage — column order matches operational spec", () => {
  const ids = columnIds(cols);

  it("column 1 is client", () => {
    expect(ids[0]).toBe("client");
  });

  it("column 2 is title (summary)", () => {
    expect(ids[1]).toBe("title");
  });

  it("column 3 is address (service address)", () => {
    expect(ids[2]).toBe("address");
  });

  it("column 4 is status", () => {
    expect(ids[3]).toBe("status");
  });

  it("column 5 is created", () => {
    expect(ids[4]).toBe("created");
  });

  it("column 6 is total", () => {
    expect(ids[5]).toBe("total");
  });

  it("column 7 is quoteNumber (far right)", () => {
    expect(ids[6]).toBe("quoteNumber");
  });

  it("owner column is removed", () => {
    expect(ids).not.toContain("owner");
  });

  it("updated column is replaced by created", () => {
    expect(ids).not.toContain("updated");
    expect(ids).toContain("created");
  });
});

describe("QuotesListPage — service address column", () => {
  it("address column uses entity-text kind", () => {
    const block = cols.match(/id:\s*["']address["'],[\s\S]+?(?=\{\s*id:\s*["'])/)?.[0] ?? "";
    expect(block).toMatch(/kind:\s*["']text["']/);
    expect(block).toMatch(/type:\s*"entity-text"/);
  });

  it("address column derives from location.address and location.city", () => {
    const block = cols.match(/id:\s*["']address["'],[\s\S]+?(?=\{\s*id:\s*["'])/)?.[0] ?? "";
    expect(block).toMatch(/location\?\.address/);
    expect(block).toMatch(/location\?\.city/);
  });

  it("address column falls back to em-dash when both fields are null", () => {
    const block = cols.match(/id:\s*["']address["'],[\s\S]+?(?=\{\s*id:\s*["'])/)?.[0] ?? "";
    expect(block).toMatch(/\|\|.*["']—["']/);
  });
});

describe("QuotesListPage — Quote # is far right and uses EntityNumber", () => {
  const ids = columnIds(cols);

  it("quoteNumber is the last column", () => {
    expect(ids[ids.length - 1]).toBe("quoteNumber");
  });

  it("quoteNumber still renders EntityNumber chip (maintained for visual identity)", () => {
    const block = cols.match(/id:\s*["']quoteNumber["'],[\s\S]+$/s)?.[0] ?? "";
    expect(block).toMatch(/<EntityNumber\b/);
  });

  it("quoteNumber per-row testId is preserved", () => {
    const block = cols.match(/id:\s*["']quoteNumber["'],[\s\S]+$/s)?.[0] ?? "";
    expect(block).toMatch(/text-quote-number-/);
  });
});

describe("QuotesListPage — title column renamed to Summary", () => {
  it("title column header is Summary", () => {
    const block = cols.match(/id:\s*["']title["'],[\s\S]+?(?=\{\s*id:\s*["'])/)?.[0] ?? "";
    expect(block).toMatch(/header:\s*["']Summary["']/);
  });
});

describe("QuotesListPage — client column secondary shows city only (not companyName)", () => {
  it("client secondary uses location.city — not location.companyName", () => {
    const block = cols.match(/id:\s*["']client["'],[\s\S]+?(?=\{\s*id:\s*["'])/)?.[0] ?? "";
    expect(block).toMatch(/location\?\.city/);
    // Must not fall back to companyName as secondary (that would duplicate location name)
    expect(block).not.toMatch(/secondary[\s\S]{0,200}companyName/);
  });

  it("client secondary does NOT show street address (no location.address in secondary)", () => {
    const block = cols.match(/id:\s*["']client["'],[\s\S]+?(?=\{\s*id:\s*["'])/)?.[0] ?? "";
    expect(block).not.toMatch(/secondary[\s\S]{0,200}location\?\.address/);
  });
});

describe("QuotesListPage — created column uses quote.createdAt", () => {
  it("created column sources from createdAt (not updatedAt)", () => {
    const block = cols.match(/id:\s*["']created["'],[\s\S]+?(?=\{\s*id:\s*["'])/)?.[0] ?? "";
    expect(block).toMatch(/createdAt/);
    expect(block).not.toMatch(/updatedAt/);
  });
});

describe("QuotesListPage — no dead team query", () => {
  it("userNameMap is removed", () => {
    expect(src).not.toMatch(/const userNameMap\s*=/);
  });

  it("teamMembers query for owner column is removed", () => {
    expect(src).not.toMatch(/Phase 2: Fetch team for owner/);
  });
});
