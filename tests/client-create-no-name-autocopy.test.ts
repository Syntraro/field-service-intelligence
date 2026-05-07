/**
 * Client creation: do NOT auto-copy customer/company name into the
 * primary location's name (2026-05-06 RALPH).
 *
 * Locks the contract that:
 *   • `POST /api/clients/full-create` writes `location` = NULL when the
 *     caller does not provide an explicit `primaryLocation.name`. The
 *     legacy fallback chain (companyName → firstName/lastName → null)
 *     no longer runs at the storage write site.
 *   • `POST /api/tech/clients` writes `location: null` for the primary
 *     location it creates. The pre-fix behavior wrote
 *     `location: displayName` (the customer's name) to make the
 *     dedupe key match on re-submit; that is intentionally given up
 *     so location names stop visually duplicating customer names in
 *     lists.
 *   • The validation guard at `/api/clients/full-create` still
 *     accepts a submission when EITHER an identity (company or first
 *     name) OR an address (street + city) is provided — only the
 *     stored `location` column changes, not the form's gating.
 *   • No duplicate-suppression helper was added to invoice/job list
 *     rendering. The visual duplication disappears naturally as new
 *     clients are created with NULL location names — old data is
 *     handled by the user manually.
 *   • All canonical client-create entry points still flow through
 *     these two server routes (no inline create flow re-introduces a
 *     hardcoded name fallback).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(__dirname, "..");
const CLIENTS_ROUTE = resolve(ROOT, "server/routes/clients.ts");
const TECH_FIELD_ROUTE = resolve(ROOT, "server/routes/techField.ts");
const CREATE_CLIENT_MODAL = resolve(ROOT, "client/src/components/CreateClientModal.tsx");
const CREATE_LEAD_PAGE = resolve(ROOT, "client/src/pages/CreateLeadPage.tsx");

const clientsRouteSrc = readFileSync(CLIENTS_ROUTE, "utf-8");
const techFieldSrc = readFileSync(TECH_FIELD_ROUTE, "utf-8");
const createClientModalSrc = readFileSync(CREATE_CLIENT_MODAL, "utf-8");
const createLeadPageSrc = readFileSync(CREATE_LEAD_PAGE, "utf-8");

// ── 1. /api/clients/full-create no longer falls back to company / person name ──

describe("POST /api/clients/full-create — no auto-copy of customer name into location", () => {
  it("primaryLocationName resolves to `primaryLocation?.name?.trim() || null` (no fallback chain)", () => {
    // The single line that determines what gets written to the
    // `location` column. Pin it tightly so a future refactor can't
    // re-introduce the companyName / firstName fallback.
    expect(clientsRouteSrc).toMatch(
      /const\s+primaryLocationName\s*=\s*primaryLocation\?\.name\?\.trim\(\)\s*\|\|\s*null\s*;/,
    );
  });

  it("does NOT fall back to companyName / firstName / lastName when primaryLocation.name is omitted", () => {
    // Scope the negative pin to the primaryLocationName declaration —
    // strip comments first so the doc commentary that references the
    // legacy fallback for context doesn't false-match.
    const codeOnly = clientsRouteSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const declMatch = codeOnly.match(
      /const\s+primaryLocationName\s*=[\s\S]+?;/,
    );
    expect(declMatch, "primaryLocationName declaration must exist").toBeTruthy();
    const decl = declMatch![0];
    expect(decl).not.toMatch(/companyName/);
    expect(decl).not.toMatch(/clientFirstName/);
    expect(decl).not.toMatch(/clientLastName/);
  });

  it("the `location` column is set from primaryLocationName (which can now be NULL)", () => {
    // The primaryClientData object writes `location: primaryLocationName`.
    // After the change primaryLocationName CAN be null, so the column
    // accepts NULL too. Pin the binding so a future refactor doesn't
    // silently introduce a `?? companyName` fallback at the write site.
    expect(clientsRouteSrc).toMatch(/location:\s*primaryLocationName,/);
  });

  it("validation guard still allows identity-only OR address-only submissions", () => {
    // The validation gate uses a LOCAL `primaryLocName` chain to decide
    // whether the submission is identifiable. That chain is allowed to
    // fall back to company / firstName for VALIDATION purposes (so the
    // form doesn't reject a submission that has a valid identity but no
    // address). Only the WRITE site changed — pin both sides.
    const localChain = clientsRouteSrc.match(
      /const\s+primaryLocName\s*=\s*primaryLocation\?\.name\?\.trim\(\)([\s\S]+?);/,
    );
    expect(localChain, "validation chain must still exist").toBeTruthy();
    expect(localChain![0]).toMatch(/company\?\.name\?\.trim\(\)/);
    expect(localChain![0]).toMatch(/company\?\.firstName\?\.trim\(\)/);
    // The guard itself rejects submissions with neither identity nor address.
    expect(clientsRouteSrc).toMatch(
      /if\s*\(\s*!primaryLocName\s*&&\s*!primaryAddrValid\s*\)\s*\{/,
    );
  });
});

// ── 2. /api/tech/clients no longer copies displayName into location ──

describe("POST /api/tech/clients — primary location writes location: null", () => {
  it("the createOrGetLocation call passes `location: null` (not displayName)", () => {
    // Pin the explicit null write — same guarantee as the office
    // full-create flow: the customer name is NOT copied into the
    // location column when no location-name input exists.
    expect(techFieldSrc).toMatch(
      /createOrGetLocation\(companyId,\s*userId,\s*\{[\s\S]+?location:\s*null,/,
    );
  });

  it("does NOT pass `location: displayName` (the pre-fix auto-copy)", () => {
    // The pre-fix line was `location: displayName,` — after the
    // change that exact pattern must be gone. Strip comments first so
    // the doc commentary explaining the old behavior doesn't trip.
    const codeOnly = techFieldSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/location:\s*displayName,/);
  });

  it("still writes companyName: displayName so the parent customer is linked", () => {
    // The customer-company linkage (companyName field on the
    // clientLocations row) is unchanged — only the location-name
    // column went to NULL.
    expect(techFieldSrc).toMatch(
      /createOrGetLocation\(companyId,\s*userId,\s*\{[\s\S]+?companyName:\s*displayName,/,
    );
  });
});

// ── 3. Frontend canonical entry points still hit the canonical routes ──

describe("Frontend client-create flows route through canonical endpoints", () => {
  it("CreateClientModal posts to /api/clients/full-create without a primaryLocation.name", () => {
    expect(createClientModalSrc).toMatch(/\/api\/clients\/full-create/);
    // The modal does NOT have a location-name input — the
    // `primaryLocation` payload only carries serviceAddress + flags.
    // Pin the absence of any `name:` field on the primaryLocation
    // object literal in the request body.
    const codeOnly = createClientModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const primaryLocBlock = codeOnly.match(
      /primaryLocation:\s*\{([\s\S]+?)\},\s*contacts\b/,
    );
    expect(primaryLocBlock, "primaryLocation request block must exist").toBeTruthy();
    expect(primaryLocBlock![1]).not.toMatch(/\bname:/);
  });

  it("CreateLeadPage's inline create posts to /api/clients/full-create without a primaryLocation.name", () => {
    expect(createLeadPageSrc).toMatch(/\/api\/clients\/full-create/);
    const codeOnly = createLeadPageSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const primaryLocBlock = codeOnly.match(
      /primaryLocation:\s*\{([\s\S]+?)\},?\s*\}/,
    );
    expect(primaryLocBlock, "primaryLocation request block must exist").toBeTruthy();
    expect(primaryLocBlock![1]).not.toMatch(/\bname:/);
  });
});

// ── 4. No duplicate-suppression helper added to list rendering ──

describe("No duplicate-suppression logic added to invoice/job list rendering", () => {
  // Per the brief: "Do not add duplicate-suppression logic." Once new
  // clients are created with NULL location names, the duplicate visual
  // disappears on its own. This guard makes sure no helper that hides
  // a location name when it equals the customer name was added.

  function collectSrcFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === "dist" || name === "build") continue;
        collectSrcFiles(full, acc);
      } else if (/\.(tsx?|jsx?)$/.test(name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("no helper named like `suppressDuplicateLocation` / `hideDuplicateLocationName` exists", () => {
    const files = collectSrcFiles(resolve(ROOT, "client/src"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      if (/suppressDuplicateLocation|hideDuplicateLocationName|isDuplicateLocationName|deduplicateLocationName/.test(src)) {
        offenders.push(f.replace(ROOT, ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no list-row component compares `location.name === customer.name` to hide one of them", () => {
    // A common shape this kind of helper takes inline. Scan for the
    // pattern in client/src — if a future hand-rolled fix lands, this
    // catches it.
    const files = collectSrcFiles(resolve(ROOT, "client/src"));
    const offenders: Array<{ file: string; line: string }> = [];
    const pattern =
      /(locationName|location\.name|location\.companyName)\s*===\s*(customerName|customer\.name|companyName|parent.*\.name)/;
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      const lines = src.split("\n");
      for (const line of lines) {
        if (pattern.test(line)) {
          offenders.push({ file: f.replace(ROOT, ""), line: line.trim() });
        }
      }
    }
    if (offenders.length > 0) {
      const formatted = offenders.map((o) => `  ${o.file}\n    ${o.line}`).join("\n");
      throw new Error(
        `Found ${offenders.length} duplicate-suppression site(s). The brief disallows ` +
          `helpers that hide location.name when it matches the customer name — the visual ` +
          `duplicate is supposed to disappear naturally as new rows save NULL location names.\n` +
          formatted,
      );
    }
  });
});
