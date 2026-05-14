/**
 * Lead create-flow migration source-pin tests (2026-05-06).
 *
 * The "New Lead" entry path moved from a modal mount on LeadsPage to a
 * dedicated `/leads/new` page that reuses Lead Detail components in
 * draft mode. These pins fail if a future refactor:
 *   - drops the /leads/new route
 *   - registers /leads/:id before /leads/new (which would let `:id`
 *     swallow "new" and resolve to LeadDetailPage)
 *   - reverts the LeadsPage button to opening the old modal
 *   - changes the create-lead payload contract CreateLeadPage owns
 *   - removes the inline "create new client" affordance from the new page
 *   - re-introduces the legacy CreateLeadModal source file
 *
 * Mirrors the source-pin style used in `recurring-jobs-nav-rename.test.ts`
 * and other pin tests under `tests/`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const appSrc = readFileSync(
  resolve(__dirname, "../client/src/App.tsx"),
  "utf-8",
);
const leadsPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/LeadsPage.tsx"),
  "utf-8",
);
const createLeadPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/CreateLeadPage.tsx"),
  "utf-8",
);
const summaryCardSrc = readFileSync(
  resolve(__dirname, "../client/src/components/leads/LeadSummaryCard.tsx"),
  "utf-8",
);
const detailsRailSrc = readFileSync(
  resolve(__dirname, "../client/src/components/leads/LeadDetailsRail.tsx"),
  "utf-8",
);
const leadDetailPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/LeadDetailPage.tsx"),
  "utf-8",
);

// ── Routing ─────────────────────────────────────────────────────────

describe("App.tsx — /leads/new is registered and ordered correctly", () => {
  it("imports CreateLeadPage", () => {
    expect(appSrc).toMatch(
      /import\s+CreateLeadPage\s+from\s+["']@\/pages\/CreateLeadPage["']/,
    );
  });

  it("registers a /leads/new route that mounts CreateLeadPage", () => {
    // <Route path="/leads/new"> ... <CreateLeadPage /> ... </Route>
    expect(appSrc).toMatch(
      /<Route\s+path="\/leads\/new">[\s\S]*?<CreateLeadPage\s*\/>[\s\S]*?<\/Route>/,
    );
  });

  it("/leads/new is gated by ProtectedRoute requireAdmin (matches /leads, /leads/:id)", () => {
    // The wrapping ProtectedRoute carries requireAdmin between the two
    // tags inside the /leads/new Route. Pin both that the gate is
    // present AND that it carries the admin flag.
    expect(appSrc).toMatch(
      /<Route\s+path="\/leads\/new">[\s\S]*?<ProtectedRoute\s+requireAdmin>[\s\S]*?<CreateLeadPage\s*\/>[\s\S]*?<\/ProtectedRoute>[\s\S]*?<\/Route>/,
    );
  });

  it("/leads/new is registered BEFORE /leads/:id (otherwise :id swallows 'new')", () => {
    const newIdx = appSrc.indexOf('path="/leads/new"');
    const dynIdx = appSrc.indexOf('path="/leads/:id"');
    expect(newIdx).toBeGreaterThan(-1);
    expect(dynIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeLessThan(dynIdx);
  });
});

// ── LeadsPage button migration ──────────────────────────────────────

describe("LeadsPage — New Lead button now navigates to /leads/new", () => {
  it("the button-new-lead onClick navigates via setLocation('/leads/new')", () => {
    // Pin the data-testid + the click handler shape together so a
    // future refactor cannot accidentally split them.
    expect(leadsPageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setLocation\(\s*["']\/leads\/new["']\s*\)\}[\s\S]*?data-testid="button-new-lead"/,
    );
  });

  it("does NOT mount the legacy CreateLeadModal", () => {
    expect(leadsPageSrc).not.toMatch(/<CreateLeadModal[\s/>]/);
    expect(leadsPageSrc).not.toMatch(
      /from\s+["']@\/components\/CreateLeadModal["']/,
    );
  });

  it("data-testid='button-new-lead' is preserved on the trigger (existing tests rely on it)", () => {
    expect(leadsPageSrc).toMatch(/data-testid="button-new-lead"/);
  });
});

// ── CreateLeadPage payload + behavior ───────────────────────────────

describe("CreateLeadPage — payload contract", () => {
  it("posts to /api/leads with method POST", () => {
    expect(createLeadPageSrc).toMatch(/apiRequest[^(]*\(\s*["']\/api\/leads["']/);
    expect(createLeadPageSrc).toMatch(/method:\s*["']POST["']/);
  });

  it("sends locationId, originTechnicianId, title, description, priority, estimatedValue, sourceType=office", () => {
    // Must match the modal's payload shape exactly (the audit's
    // "current behavior" contract). Allow whitespace flexibility.
    expect(createLeadPageSrc).toMatch(/locationId:\s*selectedLocation\?\.id/);
    expect(createLeadPageSrc).toMatch(/originTechnicianId:\s*capturedByUserId\s*\|\|\s*null/);
    expect(createLeadPageSrc).toMatch(/title,/);
    expect(createLeadPageSrc).toMatch(/description:\s*description\s*\|\|\s*null/);
    expect(createLeadPageSrc).toMatch(/priority,/);
    expect(createLeadPageSrc).toMatch(/estimatedValue:\s*estimatedValue\s*\|\|\s*null/);
    expect(createLeadPageSrc).toMatch(/sourceType:\s*SOURCE_TYPE/);
    // SOURCE_TYPE constant is "office"
    expect(createLeadPageSrc).toMatch(/SOURCE_TYPE\s*=\s*["']office["']/);
  });

  it("invalidates the ['leads'] query key on success — same key the list page reads", () => {
    expect(createLeadPageSrc).toMatch(
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']leads["']\s*\]\s*\}\s*\)/,
    );
  });

  it("navigates to /leads/:id on successful create", () => {
    expect(createLeadPageSrc).toMatch(/setLocation\(`\/leads\/\$\{data\.id\}`\)/);
  });

  it("Cancel + back navigate to /leads", () => {
    expect(createLeadPageSrc).toMatch(/setLocation\(\s*["']\/leads["']\s*\)/);
  });

  it("passes testId='button-create-lead' to CanonicalCreateHeader primaryAction", () => {
    // The data-testid is rendered by CanonicalCreateHeader; CreateLeadPage
    // owns the value passed as primaryAction.testId.
    expect(createLeadPageSrc).toMatch(/testId:\s*["']button-create-lead["']/);
  });

  it("passes cancelTestId='button-cancel-lead' to CanonicalCreateHeader", () => {
    expect(createLeadPageSrc).toMatch(/cancelTestId="button-cancel-lead"/);
  });
});

// ── Client / location create-new behavior ───────────────────────────

describe("CreateLeadPage — client search + canonical create-new flow", () => {
  it("wires client search state into CanonicalCreateHeader (CreateOrSelectField lives inside the header)", () => {
    // CreateOrSelectField is rendered by CanonicalCreateHeader — pin the
    // props CreateLeadPage passes so the wiring contract is tested here.
    expect(createLeadPageSrc).toMatch(/clientSearchText=\{locationSearch\}/);
    expect(createLeadPageSrc).toMatch(/clientSearchResults=\{searchResults\}/);
    expect(createLeadPageSrc).toMatch(/clientSearchLoading=\{searchLoading\}/);
    expect(createLeadPageSrc).toMatch(/selectedLocation=\{selectedLocation\}/);
    expect(createLeadPageSrc).toMatch(/onLocationChange=\{setSelectedLocation\}/);
  });

  it("uses useLocationSearch (same hook the modal uses) for the search feed", () => {
    expect(createLeadPageSrc).toMatch(
      /from\s+["']@\/hooks\/useLocationSearch["']/,
    );
    expect(createLeadPageSrc).toMatch(/useLocationSearch\(\s*locationSearch\s*\)/);
  });

  it("offers a 'Create new client' action that opens the canonical CreateClientModal", () => {
    expect(createLeadPageSrc).toMatch(/clientCreateLabel="Create new client"/);
    expect(createLeadPageSrc).toMatch(/setCreateClientOpen\(true\)/);
  });

  it("imports and mounts CreateClientModal at page level (not inline)", () => {
    expect(createLeadPageSrc).toMatch(
      /from\s+["']@\/components\/CreateClientModal["']/,
    );
    expect(createLeadPageSrc).toMatch(/<CreateClientModal\s+open=/);
  });

  it("does NOT contain an inline client creation form or clientReplaceSlot", () => {
    expect(createLeadPageSrc).not.toMatch(/clientReplaceSlot/);
    expect(createLeadPageSrc).not.toMatch(/setShowCreateClient/);
    expect(createLeadPageSrc).not.toMatch(/newCompanyName/);
  });

  it("delegates client creation to CreateClientModal — no page-local /api/clients/full-create call", () => {
    expect(createLeadPageSrc).not.toMatch(
      /apiRequest[^(]*\(\s*["']\/api\/clients\/full-create["']/,
    );
  });

  it("handleClientCreated invalidates client queries and auto-selects the new location", () => {
    expect(createLeadPageSrc).toMatch(/setSelectedLocation\(/);
    expect(createLeadPageSrc).toMatch(
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']\/api\/clients["']\s*\]\s*\}\s*\)/,
    );
  });

  it("preserves the typed name as CreateClientModal initialValues", () => {
    expect(createLeadPageSrc).toMatch(/initialValues=\{\{\s*companyName:\s*createClientInitialName\s*\}\}/);
  });
});

// ── Detail-page parity (extracted shared components) ─────────────────

describe("CreateLeadPage — reuses Lead Detail components in draft mode", () => {
  it("imports and mounts CanonicalCreateHeader as the page chrome (not LeadSummaryCard)", () => {
    // The create page uses CanonicalCreateHeader rather than LeadSummaryCard.
    // LeadSummaryCard is only used on the saved LeadDetailPage.
    expect(createLeadPageSrc).toMatch(
      /from\s+["']@\/components\/create\/CanonicalCreateHeader["']/,
    );
    expect(createLeadPageSrc).toMatch(/<CanonicalCreateHeader/);
    expect(createLeadPageSrc).toMatch(/entityLabel="New Lead"/);
    expect(createLeadPageSrc).toMatch(/testId="create-lead-header"/);
  });

  it("imports LeadDetailsRail and renders it in mode='draft'", () => {
    expect(createLeadPageSrc).toMatch(
      /from\s+["']@\/components\/leads\/LeadDetailsRail["']/,
    );
    expect(createLeadPageSrc).toMatch(/<LeadDetailsRail\s+mode="draft"/);
  });

  it("LeadDetailPage consumes the same shared components in mode='saved'", () => {
    // Saved-mode pin guarantees the two pages share a single visual
    // source — the entire reason the components were extracted.
    expect(leadDetailPageSrc).toMatch(/<LeadSummaryCard\s+mode="saved"/);
    expect(leadDetailPageSrc).toMatch(/<LeadDetailsRail\s+mode="saved"/);
  });

  it("LeadDetailPage no longer renders an inline summary card or details rail (only via the shared components)", () => {
    // After PR1 the inline `<MetaRow ... value={fmtValue(lead.estimatedValue)} />`
    // row that lived directly in LeadDetailPage is gone — the rail
    // owns it. This pin fails if a future refactor accidentally
    // re-inlines either.
    expect(leadDetailPageSrc).not.toMatch(/value=\{fmtValue\(lead\.estimatedValue\)\}/);
    expect(leadDetailPageSrc).not.toMatch(
      /label="Estimated Value"\s+value=\{fmtValue\(/,
    );
  });

  it("does NOT render LeadVisitsCard, EntityNotesPanel, or convert-to-quote on the create page", () => {
    // Saved-only sections must stay off /leads/new — they have no
    // meaning before first save. 2026-05-08 Tier 4: pin both legacy
    // `EntityNotesSection` (retired) and canonical `EntityNotesPanel`
    // for forward-compat.
    expect(createLeadPageSrc).not.toMatch(/<LeadVisitsCard[\s/>]/);
    expect(createLeadPageSrc).not.toMatch(/<EntityNotesSection[\s/>]/);
    expect(createLeadPageSrc).not.toMatch(/<EntityNotesPanel[\s/>]/);
    // Text-label negatives use JSX-context patterns so they do not
    // accidentally match inline comments that explain what's excluded.
    expect(createLeadPageSrc).not.toMatch(/"Convert to Quote"|>\s*Convert to Quote\s*</);
    expect(createLeadPageSrc).not.toMatch(/"Mark Contacted"|>\s*Mark Contacted\s*</);
    expect(createLeadPageSrc).not.toMatch(/"Archive Lead"|>\s*Archive Lead\s*</);
  });
});

// ── Shared component shape ──────────────────────────────────────────

describe("LeadSummaryCard — supports both saved and draft modes", () => {
  it("discriminates on a `mode` prop with both 'saved' and 'draft' branches", () => {
    expect(summaryCardSrc).toMatch(/mode:\s*"saved"/);
    expect(summaryCardSrc).toMatch(/mode:\s*"draft"/);
  });

  it("draft mode accepts a clientLocationSlot ReactNode for the selector", () => {
    expect(summaryCardSrc).toMatch(/clientLocationSlot:\s*ReactNode/);
  });

  it("saved mode reads lead status via getLeadStatusMeta from @/lib/statusBadges", () => {
    // Migrated from the local ./shared/leadBadges to the canonical
    // cross-entity statusBadges library.
    expect(summaryCardSrc).toMatch(/from\s+["']@\/lib\/statusBadges["']/);
    expect(summaryCardSrc).toMatch(/getLeadStatusMeta/);
  });
});

// ── Title affordance + required-state contract (2026-05-07) ─────────

describe("LeadSummaryCard — draft-mode title affordance reads as an editable, required input", () => {
  it("renders a visible 'Title' label with a required-marker indicator", () => {
    // The label binds to the input via htmlFor. The required marker is
    // a separate testable element so a future restyling can move it
    // without breaking the contract.
    expect(summaryCardSrc).toMatch(/htmlFor="lead-title-input"/);
    expect(summaryCardSrc).toMatch(/data-testid="lead-title-required-indicator"/);
    // sr-only "(required)" text for screen readers — pin so an
    // accessibility regression fails fast.
    expect(summaryCardSrc).toMatch(/<span\s+className="sr-only">\(required\)<\/span>/);
  });

  it("the title input declares aria-required and binds aria-invalid to emptiness", () => {
    // aria-required="true" announces required-ness to screen readers
    // even when the visual marker is missed; aria-invalid={titleEmpty}
    // flips after any keystroke that empties the field.
    expect(summaryCardSrc).toMatch(/aria-required="true"/);
    expect(summaryCardSrc).toMatch(/aria-invalid=\{titleEmpty\s*\|\|\s*undefined\}/);
  });

  it("uses input chrome (border + background + shadow + cursor) so it cannot read as passive header text", () => {
    // The previous render was border-0 / px-0 / py-0 / shadow-none /
    // bg-transparent — affordance-free. These pins fail if any of
    // those return.
    expect(summaryCardSrc).toMatch(/bg-white/);
    expect(summaryCardSrc).toMatch(/border\s+border-slate-300/);
    expect(summaryCardSrc).toMatch(/shadow-sm/);
    expect(summaryCardSrc).toMatch(/cursor-text/);
    expect(summaryCardSrc).not.toMatch(/className="[^"]*\bborder-0\b[^"]*"\s+data-testid="input-lead-title"/);
    expect(summaryCardSrc).not.toMatch(/className="[^"]*\bbg-transparent\b[^"]*"\s+data-testid="input-lead-title"/);
    expect(summaryCardSrc).not.toMatch(/className="[^"]*\bfocus-visible:ring-0\b[^"]*"\s+data-testid="input-lead-title"/);
  });

  it("hover + focus styles surface the field's interactivity", () => {
    expect(summaryCardSrc).toMatch(/hover:border-slate-400/);
    expect(summaryCardSrc).toMatch(/focus-visible:ring-2/);
    expect(summaryCardSrc).toMatch(/focus-visible:ring-brand\/25/);
    expect(summaryCardSrc).toMatch(/focus-visible:border-brand/);
  });

  it("placeholder uses readable slate-400 (not the prior near-invisible slate-300)", () => {
    expect(summaryCardSrc).toMatch(/placeholder:text-slate-400/);
    // Pin against the placeholder appearing in a className value
    // rather than anywhere in the file (a JSDoc comment that
    // describes the historical regression is allowed to mention the
    // old token by name without breaking this assertion).
    expect(summaryCardSrc).not.toMatch(/className="[^"]*placeholder:text-slate-300/);
  });

  it("retains the existing data-testid='input-lead-title' for downstream tests", () => {
    expect(summaryCardSrc).toMatch(/data-testid="input-lead-title"/);
  });
});

// ── Disabled-button reason hint (2026-05-07) ─────────────────────────

describe("CreateLeadPage — explains why Create Lead is disabled", () => {
  it("computes a disabledReason string listing missing required fields", () => {
    expect(createLeadPageSrc).toMatch(/missingFields:\s*string\[\]\s*=\s*\[\]/);
    expect(createLeadPageSrc).toMatch(/!selectedLocation\?\.id\)\s*missingFields\.push\(/);
    expect(createLeadPageSrc).toMatch(/title\.trim\(\)\.length\s*===\s*0\)\s*missingFields\.push\(/);
    expect(createLeadPageSrc).toMatch(/const\s+disabledReason\s*=/);
  });

  it("only surfaces the hint AFTER the user has interacted (no aggressive red on first paint)", () => {
    // The hint gates on `isDirty` — same flag the discard-confirm
    // uses. Pin so a future refactor can't accidentally show the
    // hint on initial render.
    expect(createLeadPageSrc).toMatch(/!canSubmit[\s\S]{0,120}?isDirty[\s\S]{0,80}?missingFields/);
  });

  it("renders the hint inline beneath Create Lead with a stable test id", () => {
    expect(createLeadPageSrc).toMatch(/data-testid="text-create-lead-disabled-reason"/);
  });

  it("wires aria-describedby through primaryAction.ariaDescribedBy so screen readers announce the disabled reason", () => {
    // The button lives in CanonicalCreateHeader; the page passes the
    // hint element id via primaryAction.ariaDescribedBy.
    expect(createLeadPageSrc).toMatch(
      /ariaDescribedBy:\s*disabledReason\s*\?\s*"create-lead-disabled-reason"\s*:\s*undefined/,
    );
  });

  it("does NOT add a separate Save button for description (single Create Lead action saves everything)", () => {
    // Description input is a textarea; it must NOT have its own
    // submit button. The page's single Create Lead button submits
    // the full payload including description.
    expect(createLeadPageSrc).not.toMatch(/data-testid="button-save-description"/);
    expect(createLeadPageSrc).not.toMatch(/data-testid="button-create-description"/);
    // Confirm description still rides on the single create payload.
    expect(createLeadPageSrc).toMatch(
      /apiRequest[^(]*\(\s*["']\/api\/leads["'][\s\S]*?description:\s*description/,
    );
  });
});

describe("LeadDetailsRail — supports both saved and draft modes", () => {
  it("discriminates on a `mode` prop with both 'saved' and 'draft' branches", () => {
    expect(detailsRailSrc).toMatch(/mode:\s*"saved"/);
    expect(detailsRailSrc).toMatch(/mode:\s*"draft"/);
  });

  it("draft mode renders an editable Estimated Value input + a capturedBySlot", () => {
    expect(detailsRailSrc).toMatch(/onEstimatedValueChange/);
    expect(detailsRailSrc).toMatch(/capturedBySlot:\s*ReactNode/);
  });

  it("draft mode renders saved-only metadata as '—' placeholders, never as real values", () => {
    // Created By / Created rows in draft must not pull from any lead
    // field — they're literal "—" strings. LeadDetailsRail uses
    // RailContentCardField with children, not a value= prop.
    expect(detailsRailSrc).toMatch(
      /<RailContentCardField\s+label="Created By">—<\/RailContentCardField>/,
    );
    expect(detailsRailSrc).toMatch(
      /<RailContentCardField\s+label="Created">—<\/RailContentCardField>/,
    );
  });
});

// ── Modal is deleted (cleanup PR) ───────────────────────────────────

describe("CreateLeadModal — fully retired", () => {
  it("the modal source file no longer exists on disk", () => {
    const modalPath = resolve(
      __dirname,
      "../client/src/components/CreateLeadModal.tsx",
    );
    expect(existsSync(modalPath)).toBe(false);
  });

  it("zero active CreateLeadModal references inside the page+component trees", () => {
    // Doc-comment mentions of the deleted modal are noise — the brief
    // says "no active comments in client/src still mention CreateLeadModal
    // unless necessary". After the cleanup PR, the only files that
    // mention the name are CHANGELOG history and this test file. Any
    // re-introduction of an import / JSX / lazy / `from "..."` reference
    // in client/src trips this pin.
    const filesToScan = [
      readFileSync(resolve(__dirname, "../client/src/App.tsx"), "utf-8"),
      readFileSync(resolve(__dirname, "../client/src/pages/LeadsPage.tsx"), "utf-8"),
      readFileSync(resolve(__dirname, "../client/src/pages/LeadDetailPage.tsx"), "utf-8"),
      createLeadPageSrc,
      summaryCardSrc,
      detailsRailSrc,
    ];
    for (const src of filesToScan) {
      expect(src).not.toMatch(/<CreateLeadModal[\s/>]/);
      expect(src).not.toMatch(/from\s+["'].*CreateLeadModal["']/);
      expect(src).not.toMatch(/lazy\s*\(\s*\(\)\s*=>\s*import\([^)]*CreateLeadModal/);
    }
  });
});

// ── QA pass: validation gating, duplicate-submit, dirty-form guard,
//    error preservation, captured-by clarity ─────────────────────────

describe("CreateLeadPage — required-field gating", () => {
  it("Save button is disabled until a location is selected AND a non-empty title is entered", () => {
    expect(createLeadPageSrc).toMatch(
      /canSubmit\s*=\s*[\s\S]*?!!selectedLocation\?\.id\s*&&\s*title\.trim\(\)\.length\s*>\s*0/,
    );
    // disabled is passed as a property of primaryAction (rendered by
    // CanonicalCreateHeader), not as a direct JSX attribute here.
    expect(createLeadPageSrc).toMatch(/disabled:\s*!canSubmit/);
  });
});

describe("CreateLeadPage — duplicate-submit prevention", () => {
  it("canSubmit also checks createLeadMutation.isPending so a second click is blocked", () => {
    expect(createLeadPageSrc).toMatch(
      /!createLeadMutation\.isPending/,
    );
  });

  it("Cancel is disabled while the create mutation is in flight", () => {
    // Cancel button is rendered by CanonicalCreateHeader; CreateLeadPage
    // passes the disabled state via the cancelDisabled prop.
    expect(createLeadPageSrc).toMatch(
      /cancelDisabled=\{createLeadMutation\.isPending\}/,
    );
  });
});

describe("CreateLeadPage — dirty-form guard uses AlertDialog (not window.confirm)", () => {
  it("does NOT call window.confirm for the discard prompt", () => {
    expect(createLeadPageSrc).not.toMatch(/window\.confirm\b/);
  });

  it("imports the canonical AlertDialog primitive from @/components/ui/alert-dialog", () => {
    expect(createLeadPageSrc).toMatch(
      /from\s+["']@\/components\/ui\/alert-dialog["']/,
    );
  });

  it("mounts <AlertDialog> driven by showDiscardConfirm state", () => {
    expect(createLeadPageSrc).toMatch(/showDiscardConfirm/);
    expect(createLeadPageSrc).toMatch(
      /<AlertDialog\s+open=\{showDiscardConfirm\}/,
    );
  });

  it("clean form (isDirty=false) navigates to /leads immediately without opening the dialog", () => {
    // navigateBack body must hit setLocation("/leads") in the
    // non-dirty path (i.e., outside the `if (isDirty)` branch).
    expect(createLeadPageSrc).toMatch(
      /const navigateBack[\s\S]*?if\s*\(isDirty\)\s*\{[\s\S]*?setShowDiscardConfirm\(true\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?setLocation\(\s*["']\/leads["']\s*\)/,
    );
  });

  it("isDirty considers location, title, description, estimatedValue, priority, capturedBy", () => {
    // A single regex with [\s\S]*? between each clause keeps the
    // assertion robust to whitespace + reorder.
    expect(createLeadPageSrc).toMatch(
      /const isDirty\s*=\s*[\s\S]*?title\.trim\(\)\.length\s*>\s*0/,
    );
    expect(createLeadPageSrc).toMatch(/description\.trim\(\)\.length\s*>\s*0/);
    expect(createLeadPageSrc).toMatch(/estimatedValue\.trim\(\)\.length\s*>\s*0/);
    expect(createLeadPageSrc).toMatch(/!!selectedLocation/);
    expect(createLeadPageSrc).toMatch(/priority\s*!==\s*DEFAULT_PRIORITY/);
    expect(createLeadPageSrc).toMatch(/capturedByUserId\s*!==\s*\(user\?\.id\s*\?\?\s*""\)/);
    // Modal open state does NOT pollute the page's dirty-form guard.
    expect(createLeadPageSrc).not.toMatch(/isDirty[\s\S]{0,200}showCreateClient/);
  });

  it("renders explicit Discard / Keep editing buttons in the AlertDialog", () => {
    expect(createLeadPageSrc).toMatch(/data-testid="button-discard-confirm"/);
    expect(createLeadPageSrc).toMatch(/data-testid="button-discard-cancel"/);
    // Pin the literal user-facing copy so a future copy-edit doesn't
    // accidentally produce ambiguous wording.
    expect(createLeadPageSrc).toMatch(/Discard this lead\?/);
    expect(createLeadPageSrc).toMatch(/Keep editing/);
  });
});

describe("CreateLeadPage — server failure preserves form input", () => {
  it("createLeadMutation onError shows a toast and does NOT reset state", () => {
    // Pin the onError block: it must contain a toast call AND must NOT
    // touch any of the form-state setters. We capture the onError
    // function body and assert it's free of setTitle/setDescription/
    // setSelectedLocation/etc. mutations.
    const m = createLeadPageSrc.match(
      /createLeadMutation\s*=\s*useMutation\(\{[\s\S]*?onError:\s*\(err:[^)]*\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(m).not.toBeNull();
    const onErrorBody = m![1];
    expect(onErrorBody).toMatch(/toast\(/);
    // Must not reset any of the form fields.
    expect(onErrorBody).not.toMatch(/\bsetTitle\b/);
    expect(onErrorBody).not.toMatch(/\bsetDescription\b/);
    expect(onErrorBody).not.toMatch(/\bsetSelectedLocation\b/);
    expect(onErrorBody).not.toMatch(/\bsetEstimatedValue\b/);
    expect(onErrorBody).not.toMatch(/\bsetPriority\b/);
    expect(onErrorBody).not.toMatch(/\bsetCapturedByUserId\b/);
    expect(onErrorBody).not.toMatch(/resetForm/);
  });
});

describe("LeadDetailsRail — draft mode communicates Captured By immutability", () => {
  it("renders the canonical 'Cannot be changed after creation' hint", () => {
    expect(detailsRailSrc).toMatch(/Cannot be changed after creation/);
    expect(detailsRailSrc).toMatch(
      /data-testid="text-captured-by-immutable-hint"/,
    );
  });
});

describe("leadBadges — STATUS_BADGE map is encapsulated", () => {
  const leadBadgesSrc = readFileSync(
    resolve(__dirname, "../client/src/components/leads/shared/leadBadges.ts"),
    "utf-8",
  );
  it("only getLeadStatusColors is exported (STATUS_BADGE / interface stay private)", () => {
    expect(leadBadgesSrc).toMatch(/export\s+function\s+getLeadStatusColors\b/);
    // The map itself and its row interface are NOT exported — the
    // single public surface is the helper function above.
    expect(leadBadgesSrc).not.toMatch(/export\s+const\s+STATUS_BADGE\b/);
    expect(leadBadgesSrc).not.toMatch(/export\s+interface\s+LeadStatusBadgeColors\b/);
  });
});
