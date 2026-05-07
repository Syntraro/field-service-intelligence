/**
 * Service Address — location label dedupe (2026-05-06 RALPH).
 *
 * Locks the contract that:
 *   • The shared `resolveServiceLocationName(rawLocation, customerName)`
 *     helper is the single source of truth for whether the SERVICE
 *     ADDRESS block on Job Detail or Invoice Detail renders an
 *     emphasized location-name row above the address lines.
 *   • The helper returns null when the raw value is empty / whitespace
 *     OR when it case/whitespace-insensitively matches the customer
 *     name. Otherwise it returns the trimmed raw value verbatim — no
 *     synthesis, no fallback to a COALESCE display name.
 *   • Job Detail mounts `<AddressBlock variant="job">` with
 *     `locationName={resolveServiceLocationName(job.location?.location,
 *     clientName)}` — the RAW `clients.location` column, NOT the
 *     COALESCE display name carried by `job.location.companyName`.
 *   • Invoice Detail mounts `<InvoiceMetaCard locationName=
 *     {resolveServiceLocationName(location.location, clientName)}>` —
 *     the RAW column, dropping the prior `location.companyName ||
 *     location.location || ""` chain that fell back to the COALESCE
 *     display name first.
 *   • The AddressBlock invoice variant collapses the location-name row
 *     entirely when locationName is falsy (no dash placeholder). The
 *     label header + street/city lines still render so the section is
 *     still recognizable.
 *   • The AddressBlock job variant continues to hide the row when
 *     locationName is falsy (pre-existing behavior preserved).
 *   • Address lines (street + city) render in all three cases (null,
 *     duplicate, distinct location name) — the brief requires "Always
 *     show the address lines."
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import { resolveServiceLocationName } from "../client/src/lib/serviceAddress";

const ROOT = resolve(__dirname, "..");
const JOB_DETAIL = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
const INVOICE_DETAIL = resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx");
const ADDRESS_BLOCK = resolve(ROOT, "client/src/components/common/AddressBlock.tsx");
const INVOICE_META_CARD = resolve(ROOT, "client/src/components/invoice/InvoiceMetaCard.tsx");
const HELPER = resolve(ROOT, "client/src/lib/serviceAddress.ts");

const jobDetailSrc = readFileSync(JOB_DETAIL, "utf-8");
const invoiceDetailSrc = readFileSync(INVOICE_DETAIL, "utf-8");
const addressBlockSrc = readFileSync(ADDRESS_BLOCK, "utf-8");
const invoiceMetaCardSrc = readFileSync(INVOICE_META_CARD, "utf-8");
const helperSrc = readFileSync(HELPER, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ── 1. Helper semantics — the user-visible contract ─────────────────

describe("resolveServiceLocationName — render contract", () => {
  it("returns null when raw location name is null", () => {
    expect(resolveServiceLocationName(null, "Fady's Hockey")).toBeNull();
  });

  it("returns null when raw location name is undefined", () => {
    expect(resolveServiceLocationName(undefined, "Fady's Hockey")).toBeNull();
  });

  it("returns null when raw location name is an empty string", () => {
    expect(resolveServiceLocationName("", "Fady's Hockey")).toBeNull();
  });

  it("returns null when raw location name is whitespace-only", () => {
    expect(resolveServiceLocationName("   ", "Fady's Hockey")).toBeNull();
  });

  it("returns null when raw location name equals the customer name (case-insensitive, trim)", () => {
    // Catches the legacy auto-copied data from before the previous
    // RALPH change. Old `clients.location` columns still carry the
    // customer name verbatim; the helper suppresses that visual
    // duplicate without a data migration.
    expect(resolveServiceLocationName("Fady's Hockey", "Fady's Hockey")).toBeNull();
    expect(resolveServiceLocationName("fady's hockey", "Fady's Hockey")).toBeNull();
    expect(resolveServiceLocationName("  Fady's Hockey  ", "Fady's Hockey")).toBeNull();
    expect(resolveServiceLocationName("Fady's Hockey", "  Fady's Hockey  ")).toBeNull();
  });

  it("returns the trimmed raw value when it is a real distinct location label", () => {
    expect(resolveServiceLocationName("Warehouse B", "Fady's Hockey")).toBe("Warehouse B");
    expect(resolveServiceLocationName("  Main Office  ", "Fady's Hockey")).toBe("Main Office");
    expect(resolveServiceLocationName("Downtown Branch", "ACME Corp")).toBe("Downtown Branch");
  });

  it("does NOT synthesize a fallback to the customer name when raw is missing", () => {
    // Pin the no-fallback rule from the brief: when the raw column is
    // absent the row should be SUPPRESSED, never substituted with the
    // customer/company name.
    expect(resolveServiceLocationName(null, "Fady's Hockey")).toBeNull();
    expect(resolveServiceLocationName("", "Fady's Hockey")).toBeNull();
  });

  it("returns the raw value when customer name is missing (no false-positive suppress)", () => {
    // If the customer name is unavailable, the helper has no basis to
    // suppress — render the raw value so the section is still useful.
    expect(resolveServiceLocationName("Branch A", null)).toBe("Branch A");
    expect(resolveServiceLocationName("Branch A", undefined)).toBe("Branch A");
    expect(resolveServiceLocationName("Branch A", "")).toBe("Branch A");
  });
});

// ── 2. Helper source-pin: lives in the canonical lib path ──────────

describe("resolveServiceLocationName — source contract", () => {
  it("exports the helper from client/src/lib/serviceAddress.ts", () => {
    expect(helperSrc).toMatch(/export\s+function\s+resolveServiceLocationName\s*\(/);
  });

  it("uses ONLY the raw inputs — no fallback synthesis from a COALESCE display name", () => {
    const codeOnly = stripComments(helperSrc);
    // Must not reach for `locationDisplayName` / `customerDisplayName`
    // / a COALESCE chain. The brief explicitly forbids this.
    expect(codeOnly).not.toMatch(/locationDisplayName/);
    expect(codeOnly).not.toMatch(/customerDisplayName/);
    expect(codeOnly).not.toMatch(/COALESCE/i);
  });

  it("compares case-insensitively after trimming both sides", () => {
    expect(helperSrc).toMatch(
      /raw\.toLowerCase\(\)\s*===\s*customer\.toLowerCase\(\)/,
    );
    expect(helperSrc).toMatch(/\(rawLocationName\s*\?\?\s*""\)\.trim\(\)/);
    expect(helperSrc).toMatch(/\(customerName\s*\?\?\s*""\)\.trim\(\)/);
  });
});

// ── 3. Job Detail mounts the helper with raw `location.location` ───

describe("JobDetailPage SERVICE ADDRESS block — uses raw location.location via the resolver", () => {
  it("imports resolveServiceLocationName from the canonical helper module", () => {
    expect(jobDetailSrc).toMatch(
      /from\s+["']@\/lib\/serviceAddress["']/,
    );
    expect(jobDetailSrc).toMatch(/\bresolveServiceLocationName\b/);
  });

  it("AddressBlock locationName binding goes through the resolver with job.location?.location and clientName", () => {
    expect(jobDetailSrc).toMatch(
      /<AddressBlock[\s\S]+?variant="job"[\s\S]+?label="Service Address"[\s\S]+?locationName=\{resolveServiceLocationName\(job\.location\?\.location,\s*clientName\)\}/,
    );
  });

  it("does NOT pass job.location?.companyName as the locationName (the prior duplicate source)", () => {
    // Strip comments first — doc commentary explaining the prior bug
    // legitimately references `job.location?.companyName`.
    const codeOnly = stripComments(jobDetailSrc);
    expect(codeOnly).not.toMatch(
      /<AddressBlock[\s\S]+?locationName=\{job\.location\?\.companyName\}/,
    );
  });

  it("passes streetLine + cityLine unconditionally — address lines are always present", () => {
    // The brief: "Always show the address lines." Pin both bindings so
    // a future refactor can't accidentally hide them.
    expect(jobDetailSrc).toMatch(
      /<AddressBlock[\s\S]+?street=\{streetLine\}[\s\S]+?cityLine=\{cityLine\}/,
    );
  });
});

// ── 4. Invoice Detail mounts the helper with raw `location.location` ─

describe("InvoiceDetailPage SERVICE ADDRESS block — uses raw location.location via the resolver", () => {
  it("imports resolveServiceLocationName from the canonical helper module", () => {
    expect(invoiceDetailSrc).toMatch(
      /from\s+["']@\/lib\/serviceAddress["']/,
    );
    expect(invoiceDetailSrc).toMatch(/\bresolveServiceLocationName\b/);
  });

  it("InvoiceMetaCard locationName binding goes through the resolver with location.location and clientName", () => {
    expect(invoiceDetailSrc).toMatch(
      /locationName=\{resolveServiceLocationName\(location\.location,\s*clientName\)\}/,
    );
  });

  it("does NOT pass location.companyName as the locationName (the prior duplicate source)", () => {
    const codeOnly = stripComments(invoiceDetailSrc);
    // Pin the absence of the prior fallback chain. Strip comments so
    // doc commentary mentioning the prior code doesn't false-trip.
    expect(codeOnly).not.toMatch(
      /locationName=\{location\.companyName\s*\|\|\s*location\.location\s*\|\|\s*""\}/,
    );
    expect(codeOnly).not.toMatch(
      /locationName=\{location\.companyName\}/,
    );
  });

  it("passes serviceAddress unchanged — address lines are always rendered", () => {
    // The brief: "Always show the address lines." InvoiceMetaCard
    // owns the street/city render via `serviceAddress`; pin it so a
    // refactor can't drop the binding.
    expect(invoiceDetailSrc).toMatch(/serviceAddress=\{serviceAddress\s*\?\?\s*null\}/);
  });
});

// ── 5. AddressBlock invoice variant collapses row when locationName is falsy ─

describe("AddressBlock — invoice variant suppresses location-name row when falsy", () => {
  it("renders the location-name row ONLY when locationName is truthy (no dash placeholder)", () => {
    // The post-RALPH invoice variant gates the emphasized name row on
    // `{locationName && (...)}`. The label header + street/city lines
    // render unconditionally so the section's structure remains.
    expect(addressBlockSrc).toMatch(
      /\{locationName && \(\s*<div[\s\S]+?className="text-row-emphasis text-text-primary"[\s\S]+?data-testid=\{testId\}[\s\S]+?>\s*\{locationName\}\s*<\/div>\s*\)\}/,
    );
  });

  it("removes the prior DASH placeholder constant + ReactNode import", () => {
    // The dash placeholder used to render `{locationName || DASH}`.
    // Both the constant and its render path are gone post-RALPH.
    const codeOnly = stripComments(addressBlockSrc);
    expect(codeOnly).not.toMatch(/const\s+DASH\s*:\s*ReactNode/);
    expect(codeOnly).not.toMatch(/\{locationName\s*\|\|\s*DASH\}/);
    // The `ReactNode` import was the only consumer — it's also gone.
    expect(codeOnly).not.toMatch(/import\s+type\s+\{\s*ReactNode\s*\}\s+from\s+"react"/);
  });

  it("street + cityLine still render unconditionally (when present)", () => {
    // The brief: "Always show the address lines." Pin both renders.
    expect(addressBlockSrc).toMatch(
      /\{street && <div className="text-row text-text-secondary">\{street\}<\/div>\}/,
    );
    expect(addressBlockSrc).toMatch(
      /\{cityLine && \(\s*<div className="text-row text-text-secondary">\{cityLine\}<\/div>\s*\)\}/,
    );
  });

  it("job variant still hides the location-name row when locationName is falsy (unchanged)", () => {
    // Pre-existing behavior — the job variant guards on
    // `{locationName && ...}`. Pin so the RALPH pass didn't accidentally
    // change it.
    expect(addressBlockSrc).toMatch(
      /\{locationName && \(\s*<div className="text-row font-semibold text-text-primary truncate">\s*\{locationName\}\s*<\/div>\s*\)\}/,
    );
  });
});

// ── 6. InvoiceMetaCard prop type accepts null ─────────────────────

describe("InvoiceMetaCard — locationName prop is nullable post-RALPH", () => {
  it("declares locationName as `string | null` so the resolver's null result type-checks", () => {
    // The pre-RALPH type was `string`. After widening, callers must
    // pass the resolver's nullable result.
    expect(invoiceMetaCardSrc).toMatch(
      /locationName:\s*string\s*\|\s*null;/,
    );
  });
});

// ── 7. Three-case smoke test — exercises the resolver against
//      realistic data shapes for both pages. ────────────────────────

describe("three render cases (Job Detail + Invoice Detail) — resolver decides the row", () => {
  // Case A: raw location is null → no row.
  // Case B: raw location matches the customer name → no row.
  // Case C: raw location is a real distinct label → row renders that
  //         label.
  // Address lines are independent of the resolver (always present).

  const customer = "Fady's Hockey";

  it("case A — null raw location → resolver returns null (row hidden)", () => {
    expect(resolveServiceLocationName(null, customer)).toBeNull();
  });

  it("case B — raw location equals customer name → resolver returns null (row hidden)", () => {
    expect(resolveServiceLocationName("Fady's Hockey", customer)).toBeNull();
    expect(resolveServiceLocationName("fady's hockey", customer)).toBeNull();
  });

  it("case C — raw location is a real distinct name → resolver returns the trimmed value", () => {
    expect(resolveServiceLocationName("Warehouse B", customer)).toBe("Warehouse B");
    expect(resolveServiceLocationName(" Main Office ", customer)).toBe("Main Office");
  });
});
