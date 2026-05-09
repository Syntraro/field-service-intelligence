/**
 * StateBlock adoption — list page migration pins (2026-05-09).
 *
 * Verifies that migrated list pages pass typed StateBlock descriptors
 * through EntityListTable instead of hand-rolled ReactNode JSX.
 *
 * Migrated pages: Jobs, Leads, Quotes, Invoices, Suppliers, Inventory,
 *                 Clients, Locations, PMWorkspacePage.
 *
 * These pins fail if a future refactor:
 *   - Reintroduces hand-rolled loading/empty blocks on migrated pages
 *   - Re-adds CanonicalEmpty local function in InventoryPage
 *   - Re-imports EmptyState on migrated pages that now use descriptors
 *   - Re-adds Wrench/Loader2 imports to Jobs for state blocks
 *   - Removes errorState wiring from Inventory tables
 *   - Reverts Clients.tsx to legacyEmptyStateNode / EmptyState shim
 *   - Removes Locations typed descriptors or errorState
 *   - Reintroduces hand-rolled loading/empty divs in PMWorkspacePage tables
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function read(rel: string) { return readFileSync(resolve(ROOT, rel), "utf-8"); }

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const jobs        = read("client/src/pages/Jobs.tsx");
const jobsCode    = stripComments(jobs);
const leads       = read("client/src/pages/LeadsPage.tsx");
const leadsCode   = stripComments(leads);
const quotes      = read("client/src/pages/Quotes.tsx");
const quotesCode  = stripComments(quotes);
const invoices    = read("client/src/pages/InvoicesListPage.tsx");
const invCode     = stripComments(invoices);
const suppliers   = read("client/src/pages/SuppliersListPage.tsx");
const suppCode    = stripComments(suppliers);
const inventory   = read("client/src/pages/InventoryPage.tsx");
const invtCode    = stripComments(inventory);
const clients     = read("client/src/pages/Clients.tsx");
const clientsCode = stripComments(clients);
const locations   = read("client/src/pages/Locations.tsx");
const locsCode    = stripComments(locations);
const pmWorkspace = read("client/src/pages/PMWorkspacePage.tsx");
const pmCode      = stripComments(pmWorkspace);

// ── Jobs ─────────────────────────────────────────────────────────────

describe("Jobs — StateBlock descriptor adoption", () => {
  it("passes emptyState as typed descriptor object (not JSX)", () => {
    // Conditional ternary: emptyState={ condition ? { kind: "empty" } : { kind: "no-results" } }
    expect(jobs).toMatch(/emptyState=\{[\s\S]{0,300}?kind:\s*"(empty|no-results)"/);
  });

  it("passes loadingState as typed descriptor (not JSX block)", () => {
    expect(jobs).toMatch(/loadingState=\{[\s\S]{0,200}?kind:\s*"loading"/);
  });

  it("passes errorState descriptor with Retry action", () => {
    expect(jobs).toMatch(/errorState=[\s\S]{0,300}?kind:\s*"error"[\s\S]{0,300}?Retry/);
  });
});

describe("Jobs — no hand-rolled state JSX", () => {
  it("does not import Loader2 from lucide", () => {
    expect(jobsCode).not.toMatch(/\bLoader2\b/);
  });

  it("does not import Wrench from lucide for empty state", () => {
    // Wrench was only used in the old hand-rolled emptyState block
    expect(jobsCode).not.toMatch(/\bWrench\b/);
  });

  it("has no hand-rolled text-center loading div", () => {
    expect(jobsCode).not.toMatch(/className="text-center\s[^"]*py-8[^"]*"\s*>\s*<Loader2/);
    expect(jobsCode).not.toMatch(/className="text-center\s[^"]*py-12[^"]*"\s*>\s*<Loader2/);
  });

  it("has no flex flex-col items-center gap-2 empty block (old Jobs empty pattern)", () => {
    expect(jobsCode).not.toMatch(/flex\s+flex-col\s+items-center\s+gap-2/);
  });
});

// ── Leads ─────────────────────────────────────────────────────────────

describe("Leads — StateBlock descriptor adoption", () => {
  it("passes emptyState as typed descriptor", () => {
    expect(leads).toMatch(/emptyState=\{[\s\S]{0,300}?kind:\s*"(empty|no-results)"/);
  });

  it("uses loadingState boolean (isLoading)", () => {
    expect(leads).toMatch(/loadingState=\{isLoading\}/);
  });

  it("passes errorState with Retry action", () => {
    expect(leads).toMatch(/errorState=[\s\S]{0,200}?kind:\s*"error"[\s\S]{0,200}?Retry/);
  });
});

describe("Leads — no hand-rolled state JSX", () => {
  it("does not import EmptyState", () => {
    expect(leadsCode).not.toMatch(/from\s+["']@\/components\/ui\/empty-state["']/);
  });

  it("has no 'Loading leads...' text literal", () => {
    expect(leadsCode).not.toMatch(/Loading leads\.\.\./);
  });
});

// ── Quotes ────────────────────────────────────────────────────────────

describe("Quotes — StateBlock descriptor adoption", () => {
  it("passes emptyState as typed descriptor", () => {
    expect(quotes).toMatch(/emptyState=\{[\s\S]{0,300}?kind:\s*"(empty|no-results)"/);
  });

  it("passes loadingState as typed descriptor with testId", () => {
    expect(quotes).toMatch(/loadingState=\{[\s\S]{0,200}?testId:\s*"quotes-loading"/);
  });

  it("passes errorState with Retry action", () => {
    expect(quotes).toMatch(/errorState=[\s\S]{0,200}?kind:\s*"error"[\s\S]{0,200}?Retry/);
  });
});

describe("Quotes — no hand-rolled state JSX", () => {
  it("does not import EmptyState", () => {
    expect(quotesCode).not.toMatch(/from\s+["']@\/components\/ui\/empty-state["']/);
  });

  it("has no 'Loading quotes...' text literal", () => {
    expect(quotesCode).not.toMatch(/Loading quotes\.\.\./);
  });
});

// ── Invoices ──────────────────────────────────────────────────────────

describe("Invoices — StateBlock descriptor adoption", () => {
  it("passes emptyState as typed descriptor", () => {
    expect(invoices).toMatch(/emptyState=\{[\s\S]{0,300}?kind:\s*"(empty|no-results)"/);
  });

  it("passes loadingState as typed descriptor with testId", () => {
    expect(invoices).toMatch(/loadingState=\{[\s\S]{0,200}?testId:\s*"invoices-loading"/);
  });

  it("passes errorState with Retry action", () => {
    expect(invoices).toMatch(/errorState=[\s\S]{0,200}?kind:\s*"error"[\s\S]{0,200}?Retry/);
  });
});

describe("Invoices — no hand-rolled state JSX", () => {
  it("does not import EmptyState", () => {
    expect(invCode).not.toMatch(/from\s+["']@\/components\/ui\/empty-state["']/);
  });

  it("has no 'Loading invoices...' text literal", () => {
    expect(invCode).not.toMatch(/Loading invoices\.\.\./);
  });
});

// ── Suppliers ─────────────────────────────────────────────────────────

describe("Suppliers — StateBlock descriptor adoption", () => {
  it("passes emptyState as typed descriptor", () => {
    expect(suppliers).toMatch(/emptyState=\{[\s\S]{0,300}?kind:\s*"(empty|no-results)"/);
  });

  it("uses loadingState boolean", () => {
    expect(suppliers).toMatch(/loadingState=\{isLoading\}/);
  });

  it("passes errorState with Retry action", () => {
    expect(suppliers).toMatch(/errorState=[\s\S]{0,200}?kind:\s*"error"[\s\S]{0,200}?Retry/);
  });
});

describe("Suppliers — no hand-rolled state JSX", () => {
  it("has no text-center text-sm text-muted-foreground py-8 empty block", () => {
    expect(suppCode).not.toMatch(/className="text-center text-sm text-muted-foreground py-8"/);
  });
});

// ── Inventory ─────────────────────────────────────────────────────────

describe("Inventory — StateBlock descriptor adoption", () => {
  it("passes emptyState as typed descriptor for Items table", () => {
    expect(inventory).toMatch(/testId:\s*"inventory-items-empty"/);
  });

  it("passes emptyState as typed descriptor for Locations table", () => {
    expect(inventory).toMatch(/testId:\s*"inventory-locations-empty"/);
  });

  it("passes emptyState as typed descriptor for Low Stock table", () => {
    expect(inventory).toMatch(/testId:\s*"inventory-low-stock-empty"/);
  });

  it("uses StateBlock directly for Transfers tab", () => {
    expect(inventory).toMatch(/<StateBlock[\s\S]{0,400}?testId="inventory-transfers-empty"/);
  });

  it("uses StateBlock directly for Adjustments tab", () => {
    expect(inventory).toMatch(/<StateBlock[\s\S]{0,400}?testId="inventory-adjustments-empty"/);
  });

  it("uses StateBlock directly for Counts tab", () => {
    expect(inventory).toMatch(/<StateBlock[\s\S]{0,400}?testId="inventory-counts-empty"/);
  });

  it("skeleton loading preserved via legacyLoadingStateNode (intentional UX pattern)", () => {
    expect(inventory).toMatch(/legacyLoadingStateNode/);
  });
});

describe("Inventory — CanonicalEmpty removed", () => {
  it("does not define local CanonicalEmpty function", () => {
    expect(invtCode).not.toMatch(/function CanonicalEmpty\b/);
  });

  it("does not call <CanonicalEmpty in any JSX", () => {
    expect(invtCode).not.toMatch(/<CanonicalEmpty\b/);
  });
});

describe("Inventory — errorState wired on all EntityListTable instances", () => {
  it("Items table passes errorState with kind='error'", () => {
    expect(inventory).toMatch(/itemsQuery\.isError[\s\S]{0,300}?kind:\s*"error"/);
  });

  it("Items table errorState has Retry primaryAction", () => {
    expect(inventory).toMatch(/itemsQuery\.isError[\s\S]{0,400}?Retry/);
  });

  it("Items table Retry onClick calls itemsQuery.refetch", () => {
    expect(inventory).toMatch(/itemsQuery\.isError[\s\S]{0,500}?itemsQuery\.refetch/);
  });

  it("Locations table passes errorState with kind='error'", () => {
    expect(inventory).toMatch(/locationsQuery\.isError[\s\S]{0,300}?kind:\s*"error"/);
  });

  it("Locations table errorState has Retry primaryAction", () => {
    expect(inventory).toMatch(/locationsQuery\.isError[\s\S]{0,400}?Retry/);
  });

  it("Locations table Retry onClick calls locationsQuery.refetch", () => {
    expect(inventory).toMatch(/locationsQuery\.isError[\s\S]{0,500}?locationsQuery\.refetch/);
  });

  it("LowStock table passes errorState with kind='error'", () => {
    expect(inventory).toMatch(/lowStockQuery\.isError[\s\S]{0,300}?kind:\s*"error"/);
  });

  it("LowStock table errorState has Retry primaryAction", () => {
    expect(inventory).toMatch(/lowStockQuery\.isError[\s\S]{0,400}?Retry/);
  });

  it("LowStock table Retry onClick calls lowStockQuery.refetch", () => {
    expect(inventory).toMatch(/lowStockQuery\.isError[\s\S]{0,500}?lowStockQuery\.refetch/);
  });

  it("skeleton loading preserved — legacyLoadingStateNode still present", () => {
    // Skeleton rows are intentionally better UX than a generic spinner.
    // This pin fails if legacyLoadingStateNode is removed and replaced by loadingState.
    expect(inventory).toMatch(/legacyLoadingStateNode/);
  });

});

// ── Clients ───────────────────────────────────────────────────────────

describe("Clients — StateBlock descriptor adoption", () => {
  it("passes emptyState as typed descriptor (not legacyEmptyStateNode)", () => {
    expect(clients).toMatch(/emptyState=\{[\s\S]{0,200}?kind:\s*"empty"/);
  });

  it("uses loadingState boolean (not legacyLoadingStateNode text div)", () => {
    expect(clients).toMatch(/loadingState=\{isLoading\}/);
  });

  it("passes errorState with Retry action", () => {
    expect(clients).toMatch(/errorState=[\s\S]{0,200}?kind:\s*"error"[\s\S]{0,200}?Retry/);
  });

  it("Retry onClick calls refetchClients", () => {
    expect(clients).toMatch(/refetchClients\(\)/);
  });
});

describe("Clients — no legacy state JSX", () => {
  it("does not import EmptyState", () => {
    expect(clientsCode).not.toMatch(/from\s+["']@\/components\/ui\/empty-state["']/);
  });

  it("does not use legacyEmptyStateNode", () => {
    expect(clientsCode).not.toMatch(/legacyEmptyStateNode/);
  });

  it("does not use legacyLoadingStateNode", () => {
    expect(clientsCode).not.toMatch(/legacyLoadingStateNode/);
  });

  it("has no 'Loading clients...' text literal", () => {
    expect(clientsCode).not.toMatch(/Loading clients\.\.\./);
  });
});

// ── Locations ─────────────────────────────────────────────────────────

describe("Locations — StateBlock descriptor adoption", () => {
  it("uses loadingState boolean (isLoading)", () => {
    expect(locations).toMatch(/loadingState=\{isLoading\}/);
  });

  it("passes emptyState as typed descriptor", () => {
    expect(locations).toMatch(/emptyState=\{[\s\S]{0,200}?kind:\s*"(empty|no-results)"/);
  });

  it("passes errorState with Retry action", () => {
    expect(locations).toMatch(/errorState=[\s\S]{0,200}?kind:\s*"error"[\s\S]{0,200}?Retry/);
  });

  it("Retry onClick calls refetchLocations", () => {
    expect(locations).toMatch(/refetchLocations\(\)/);
  });
});

describe("Locations — no legacy state JSX", () => {
  it("does not use legacyEmptyStateNode", () => {
    expect(locsCode).not.toMatch(/legacyEmptyStateNode/);
  });

  it("does not use legacyLoadingStateNode", () => {
    expect(locsCode).not.toMatch(/legacyLoadingStateNode/);
  });

  it("has no 'Loading locations...' text literal", () => {
    expect(locsCode).not.toMatch(/Loading locations\.\.\./);
  });

  it("has no hand-rolled text-center empty div", () => {
    expect(locsCode).not.toMatch(/className="text-center text-muted-foreground py-8"/);
  });
});

// ── PMWorkspacePage ───────────────────────────────────────────────────

describe("PMWorkspacePage — PlansTab legacy empty removed", () => {
  it("PlansTab EntityListTable uses typed emptyState (no-results) for filter-empty case", () => {
    expect(pmWorkspace).toMatch(/emptyState=\{[\s\S]{0,100}?kind:\s*"no-results"[\s\S]{0,100}?No plans match/);
  });

  it("PlansTab no longer uses legacyEmptyStateNode for filter-empty div", () => {
    // The hand-rolled <div className="text-center py-8 ..."> was the legacy path.
    expect(pmCode).not.toMatch(/legacyEmptyStateNode[\s\S]{0,200}?No plans match your filters/);
  });
});

describe("PMWorkspacePage — TemplatesTab typed descriptors", () => {
  it("TemplatesTab uses loadingState on EntityListTable", () => {
    expect(pmWorkspace).toMatch(/loadingState=\{isLoading\}[\s\S]{0,300}?No templates match/);
  });

  it("TemplatesTab uses typed emptyState (no-results) for search-empty case", () => {
    expect(pmWorkspace).toMatch(/emptyState=\{[\s\S]{0,100}?kind:\s*"no-results"[\s\S]{0,100}?No templates match/);
  });

  it("TemplatesTab passes errorState with Retry action", () => {
    expect(pmWorkspace).toMatch(/Retry[\s\S]{0,100}?refetchTemplates/);
  });

  it("TemplatesTab no longer uses legacyEmptyStateNode for search-empty div", () => {
    expect(pmCode).not.toMatch(/legacyEmptyStateNode[\s\S]{0,200}?No templates match your search/);
  });

  it("has no 'Loading templates...' text literal (collapsed into loadingState)", () => {
    expect(pmCode).not.toMatch(/Loading templates\.\.\./);
  });
});

describe("PMWorkspacePage — WorkDueTab typed loading+error, documented legacy empty", () => {
  it("WorkDueTab EntityListTable passes loadingState descriptor", () => {
    expect(pmWorkspace).toMatch(/loadingState=\{isLoading[\s\S]{0,100}?kind:\s*"loading"/);
  });

  it("WorkDueTab EntityListTable passes errorState descriptor with Retry", () => {
    expect(pmWorkspace).toMatch(/errorState=[\s\S]{0,200}?kind:\s*"error"[\s\S]{0,200}?Retry/);
  });

  it("WorkDueTab Retry onClick calls onRetry", () => {
    expect(pmWorkspace).toMatch(/onRetry[\s\S]{0,300}?Retry/);
  });

  it("WorkDueTab legacyEmptyStateNode retained (intentional success/all-clear state)", () => {
    // The green ring + CheckCircle2 'Nothing due right now' state is documented
    // as intentionally not expressible via StateBlock — this pin ensures it stays
    // as legacyEmptyStateNode and is not silently converted or removed.
    expect(pmWorkspace).toMatch(/legacyEmptyStateNode[\s\S]{0,400}?Nothing due right now/);
  });

  it("has no outer isLoading ternary wrapping a loading div for WorkDue (collapsed into loadingState prop)", () => {
    // The old pattern: isLoading ? (\n  <div className="flex items-center justify-center py-16">
    // After migration, the only isLoading ternary is inside the loadingState prop itself.
    // Check the JSX ternary form specifically (not the if-statement form used by PlansTab).
    expect(pmCode).not.toMatch(/isLoading\s*\?\s*\n[\s\S]{0,100}?flex items-center justify-center py-16/);
  });
});
