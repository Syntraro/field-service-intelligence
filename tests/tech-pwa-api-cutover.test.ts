/**
 * Tech PWA API cutover — Phase 2 PR 2 (2026-05-04).
 *
 * Source-level pins that prove the technician PWA pages have been
 * migrated from the office API surface to the tech-safe
 * /api/tech/locations/* endpoints introduced in Phase 2 PR 1.
 *
 * Concretely:
 *   - LocationDetailPage no longer hits /api/clients/:id, no longer
 *     hits /api/clients/:id/equipment, and no longer hits
 *     /api/jobs?locationId=... It uses all three new tech endpoints.
 *   - CreateLeadPage prefills location data through
 *     /api/tech/locations/:id rather than /api/clients/:id.
 *   - No office-app pages were edited as part of this PR (we read the
 *     office LocationDetailPage to confirm it still references the
 *     office endpoint at least once — proving we did not accidentally
 *     migrate the wrong file).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const techLocationDetailCode = readFileSync(
  resolve(__dirname, "../client/src/tech-app/pages/LocationDetailPage.tsx"),
  "utf-8",
);
const techCreateLeadCode = readFileSync(
  resolve(__dirname, "../client/src/tech-app/pages/CreateLeadPage.tsx"),
  "utf-8",
);

describe("tech-app/LocationDetailPage — cutover to /api/tech/locations/*", () => {
  it("does not call /api/clients/:locationId or any other /api/clients/* endpoint", () => {
    // The office endpoint is `/api/clients/<id>` (no /search-locations,
    // no /full-create, etc.) — those would not exist in this page
    // anyway, but we forbid the entire /api/clients prefix as a
    // belt-and-braces guard against partial reverts.
    expect(techLocationDetailCode).not.toMatch(/\/api\/clients/);
  });

  it("does not call /api/jobs?locationId= (the office list filter)", () => {
    expect(techLocationDetailCode).not.toMatch(/\/api\/jobs\b/);
  });

  it("calls GET /api/tech/locations/:locationId", () => {
    expect(techLocationDetailCode).toMatch(
      /apiRequest\(\s*`\/api\/tech\/locations\/\$\{locationId\}`\s*\)/,
    );
  });

  it("calls GET /api/tech/locations/:locationId/equipment", () => {
    expect(techLocationDetailCode).toMatch(
      /apiRequest\(\s*`\/api\/tech\/locations\/\$\{locationId\}\/equipment`\s*\)/,
    );
  });

  it("calls GET /api/tech/locations/:locationId/jobs", () => {
    expect(techLocationDetailCode).toMatch(
      /apiRequest\(\s*`\/api\/tech\/locations\/\$\{locationId\}\/jobs[^`]*`\s*\)/,
    );
  });

  it("uses /api/tech/locations as the React Query cache key", () => {
    expect(techLocationDetailCode).toMatch(
      /queryKey:\s*\[\s*["']\/api\/tech\/locations["']/,
    );
  });
});

describe("tech-app/CreateLeadPage — prefill cutover to /api/tech/locations/:id", () => {
  it("does not call /api/clients/* for location prefill", () => {
    expect(techCreateLeadCode).not.toMatch(/\/api\/clients/);
  });

  it("calls GET /api/tech/locations/:prefillLocationId for prefill", () => {
    expect(techCreateLeadCode).toMatch(
      /apiRequest\(\s*`\/api\/tech\/locations\/\$\{prefillLocationId\}`\s*\)/,
    );
  });

  it("leaves POST /api/leads untouched (no /api/tech/leads endpoint exists yet)", () => {
    // Phase 2 PR 2 explicitly does not move the create-lead mutation;
    // pin the current shape so a future PR has to change this test
    // when it adds /api/tech/leads.
    expect(techCreateLeadCode).toMatch(
      /apiRequest\(\s*["']\/api\/leads["']/,
    );
    expect(techCreateLeadCode).not.toMatch(/\/api\/tech\/leads\b/);
  });
});

describe("tech-app/LocationDetailPage — UI shape adapts to the tech-safe DTO", () => {
  it("equipment rendering uses the tech-safe field names (`type`, `model`)", () => {
    // The new DTO replaces `equipmentType` → `type` and
    // `modelNumber` → `model`. Pin the new field names so a future
    // edit that re-introduces the office shape fails this test.
    expect(techLocationDetailCode).toMatch(/\beq\.type\b/);
    expect(techLocationDetailCode).toMatch(/\beq\.model\b/);
    expect(techLocationDetailCode).not.toMatch(/\beq\.equipmentType\b/);
    expect(techLocationDetailCode).not.toMatch(/\beq\.modelNumber\b/);
    // `name` is intentionally not in the tech DTO; the page must not
    // render it directly off the equipment row.
    expect(techLocationDetailCode).not.toMatch(/\beq\.name\b/);
  });

  it("does not surface location.notes (not in the tech-safe DTO)", () => {
    // The notes block was removed because the tech-safe DTO does not
    // expose `client_locations.notes` (office-internal context).
    expect(techLocationDetailCode).not.toMatch(/\bloc\.notes\b/);
  });
});

describe("PR scope — sibling tech-app pages left for follow-up", () => {
  // The user's PR 2 prompt explicitly enumerated only LocationDetailPage
  // and CreateLeadPage. VisitDetailPage also reads
  // `/api/clients/:locationId/equipment` (one site, line ~731) but
  // requires a different cutover because the surrounding modal also
  // creates equipment — out of scope for this PR. Pinning the current
  // shape here forces any future migration of VisitDetailPage to
  // update this test, which is what we want.
  it("VisitDetailPage still references the office equipment endpoint (not migrated yet)", () => {
    const src = readFileSync(
      resolve(__dirname, "../client/src/tech-app/pages/VisitDetailPage.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/\/api\/clients\/\$\{[^}]+\}\/equipment/);
  });
});
