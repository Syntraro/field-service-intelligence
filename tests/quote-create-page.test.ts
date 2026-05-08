/**
 * Quote create-flow migration source-pin tests (2026-05-06).
 *
 * The "New Quote" entry path moved from a modal mount on Quotes / App
 * header / ClientDetailPage to a dedicated `/quotes/new` page that
 * reuses Quote Detail components in draft mode. The follow-up PR2
 * deleted the retired modal and routed Lead → Quote conversion
 * through `/quotes/new?leadId=…` so users can review and edit the
 * prefilled draft before saving. These pins fail if a future refactor:
 *
 *   - drops the /quotes/new route
 *   - registers /quotes/:id before /quotes/new (which would let `:id`
 *     swallow "new" and resolve to QuoteDetailPage)
 *   - reverts a New Quote button to opening any modal
 *   - resurrects NewQuoteModal.tsx on disk
 *   - re-introduces a NewQuoteModal import or JSX mount anywhere in
 *     client/src
 *   - changes the create-quote payload contract CreateQuotePage owns
 *   - removes the inline "Create new client" affordance from the new page
 *   - removes the create-then-apply-template flow
 *   - re-inlines the QuoteSummaryCard / QuoteDescriptionCard contents
 *     into QuoteDetailPage
 *   - reverts LeadDetailPage's Convert button to a direct POST mutation
 *   - drops the lead-prefill or already-converted blocked state from
 *     CreateQuotePage
 *
 * Mirrors the source-pin style used in `lead-create-page.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const appSrc = readFileSync(
  resolve(__dirname, "../client/src/App.tsx"),
  "utf-8",
);
const quotesPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/Quotes.tsx"),
  "utf-8",
);
const createQuotePageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/CreateQuotePage.tsx"),
  "utf-8",
);
const quoteDetailPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/QuoteDetailPage.tsx"),
  "utf-8",
);
const summaryCardSrc = readFileSync(
  resolve(__dirname, "../client/src/components/quotes/QuoteSummaryCard.tsx"),
  "utf-8",
);
const descriptionCardSrc = readFileSync(
  resolve(__dirname, "../client/src/components/quotes/QuoteDescriptionCard.tsx"),
  "utf-8",
);
const draftAdapterSrc = readFileSync(
  resolve(
    __dirname,
    "../client/src/components/quotes/draftQuoteLineItemsAdapter.ts",
  ),
  "utf-8",
);
const clientDetailPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/ClientDetailPage.tsx"),
  "utf-8",
);
const leadDetailPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/LeadDetailPage.tsx"),
  "utf-8",
);

// Walk client/src and collect every .ts/.tsx file, so we can assert
// that no NewQuoteModal import or JSX usage survives anywhere in the
// tree (not just the spec-listed files). Skips test files.
function collectClientSources(): string[] {
  const root = resolve(__dirname, "../client/src");
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === "__tests__") continue;
        stack.push(full);
      } else if (st.isFile()) {
        if (!/\.(ts|tsx)$/i.test(entry)) continue;
        if (/\.test\.(ts|tsx)$/i.test(entry)) continue;
        out.push(full);
      }
    }
  }
  return out;
}

// ── Routing ─────────────────────────────────────────────────────────

describe("App.tsx — /quotes/new is registered and ordered correctly", () => {
  it("imports CreateQuotePage", () => {
    expect(appSrc).toMatch(
      /import\s+CreateQuotePage\s+from\s+["']@\/pages\/CreateQuotePage["']/,
    );
  });

  it("registers a /quotes/new route that mounts CreateQuotePage", () => {
    expect(appSrc).toMatch(
      /<Route\s+path="\/quotes\/new">[\s\S]*?<CreateQuotePage\s*\/>[\s\S]*?<\/Route>/,
    );
  });

  it("/quotes/new is gated by ProtectedRoute requireAdmin (matches /quotes, /quotes/:id)", () => {
    expect(appSrc).toMatch(
      /<Route\s+path="\/quotes\/new">[\s\S]*?<ProtectedRoute\s+requireAdmin>[\s\S]*?<CreateQuotePage\s*\/>[\s\S]*?<\/ProtectedRoute>[\s\S]*?<\/Route>/,
    );
  });

  it("/quotes/new is registered BEFORE /quotes/:id (otherwise :id swallows 'new')", () => {
    const newIdx = appSrc.indexOf('path="/quotes/new"');
    const dynIdx = appSrc.indexOf('path="/quotes/:id"');
    expect(newIdx).toBeGreaterThan(-1);
    expect(dynIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeLessThan(dynIdx);
  });

  it("App.tsx no longer mounts NewQuoteModal", () => {
    expect(appSrc).not.toMatch(/<NewQuoteModal[\s/>]/);
    expect(appSrc).not.toMatch(/from\s+["']@\/components\/NewQuoteModal["']/);
  });
});

// ── Quotes list page entry-point migration ──────────────────────────

describe("Quotes list page — New Quote button now navigates to /quotes/new", () => {
  it("the button-new-quote onClick navigates via setLocation('/quotes/new')", () => {
    expect(quotesPageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setLocation\(\s*["']\/quotes\/new["']\s*\)\}[\s\S]*?data-testid="button-new-quote"/,
    );
  });

  it("does NOT mount the legacy NewQuoteModal", () => {
    expect(quotesPageSrc).not.toMatch(/<NewQuoteModal[\s/>]/);
    expect(quotesPageSrc).not.toMatch(
      /from\s+["']@\/components\/NewQuoteModal["']/,
    );
  });

  it("data-testid='button-new-quote' is preserved on the trigger (existing tests rely on it)", () => {
    expect(quotesPageSrc).toMatch(/data-testid="button-new-quote"/);
  });

  it("`?create=true` deep-link redirects to /quotes/new (replaces the legacy modal-open)", () => {
    expect(quotesPageSrc).toMatch(
      /params\.get\(\s*["']create["']\s*\)\s*===\s*["']true["'][\s\S]*?setLocation\(\s*["']\/quotes\/new["']/,
    );
  });
});

// ── App-header / ClientDetailPage entry-point migration ─────────────

describe("App header and ClientDetailPage — Create Quote entries navigate to /quotes/new", () => {
  it("App.tsx's quick-new-quote dropdown item navigates to /quotes/new", () => {
    expect(appSrc).toMatch(
      /data-testid="quick-new-quote"[\s\S]*?onClick=\{\(\)\s*=>\s*setLocation\(\s*["']\/quotes\/new["']/,
    );
  });

  it("ClientDetailPage's header-create-quote button navigates to /quotes/new", () => {
    expect(clientDetailPageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setLocation\(\s*["']\/quotes\/new["']\s*\)\}[\s\S]*?data-testid="header-create-quote"/,
    );
  });

  it("ClientDetailPage no longer mounts NewQuoteModal", () => {
    expect(clientDetailPageSrc).not.toMatch(/<NewQuoteModal[\s/>]/);
    expect(clientDetailPageSrc).not.toMatch(
      /from\s+["']@\/components\/NewQuoteModal["']/,
    );
  });

  it("data-testid='header-create-quote' is preserved on ClientDetailPage", () => {
    expect(clientDetailPageSrc).toMatch(/data-testid="header-create-quote"/);
  });
});

// ── CreateQuotePage payload + behavior ──────────────────────────────

describe("CreateQuotePage — payload contract matches NewQuoteModal", () => {
  it("posts to /api/quotes with method POST", () => {
    expect(createQuotePageSrc).toMatch(/apiRequest[^(]*\(\s*["']\/api\/quotes["']/);
    expect(createQuotePageSrc).toMatch(/method:\s*["']POST["']/);
  });

  it("sends locationId, issueDate, expiryDate, plus optional title / notesCustomer / leadId / lines", () => {
    expect(createQuotePageSrc).toMatch(/locationId:\s*selectedLocation\.id/);
    expect(createQuotePageSrc).toMatch(/issueDate,/);
    expect(createQuotePageSrc).toMatch(/expiryDate,/);
    expect(createQuotePageSrc).toMatch(/title:\s*title\.trim\(\)/);
    expect(createQuotePageSrc).toMatch(/notesCustomer:\s*description\.trim\(\)/);
    expect(createQuotePageSrc).toMatch(/leadId:\s*leadIdFromQuery/);
    expect(createQuotePageSrc).toMatch(/lines:\s*inlineLines/);
  });

  it("title + notesCustomer are only included when no template is selected (matches modal)", () => {
    expect(createQuotePageSrc).toMatch(
      /const\s+includeBlankFields\s*=\s*!selectedTemplateId/,
    );
  });

  it("preserves the create-then-apply-template flow", () => {
    expect(createQuotePageSrc).toMatch(
      /apiRequest\(\s*`\/api\/quote-templates\/\$\{selectedTemplateId\}\/apply`/,
    );
    expect(createQuotePageSrc).toMatch(/mode:\s*["']replace["']/);
  });

  it("invalidates the same query keys NewQuoteModal invalidated", () => {
    expect(createQuotePageSrc).toMatch(
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']\/api\/quotes["']\s*\]\s*\}\s*\)/,
    );
    expect(createQuotePageSrc).toMatch(
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']\/api\/quotes\/list["']\s*\]\s*\}\s*\)/,
    );
  });

  it("navigates to /quotes/:id on successful create", () => {
    expect(createQuotePageSrc).toMatch(/setLocationRoute\(`\/quotes\/\$\{quote\.id\}`\)/);
  });

  it("Cancel + back navigate to /quotes", () => {
    expect(createQuotePageSrc).toMatch(/setLocationRoute\(\s*["']\/quotes["']\s*\)/);
  });

  it("renders a 'Create Quote' submit button with data-testid='button-create-quote'", () => {
    expect(createQuotePageSrc).toMatch(/data-testid="button-create-quote"/);
  });

  it("renders a Cancel button with data-testid='button-cancel-quote'", () => {
    expect(createQuotePageSrc).toMatch(/data-testid="button-cancel-quote"/);
  });
});

// ── Client / location create-new behavior is preserved ──────────────

describe("CreateQuotePage — preserves search + create-new client behavior", () => {
  it("uses the canonical CreateOrSelectField for client/location selection", () => {
    expect(createQuotePageSrc).toMatch(
      /from\s+["']@\/components\/shared\/CreateOrSelectField["']/,
    );
    expect(createQuotePageSrc).toMatch(/<CreateOrSelectField/);
  });

  it("uses the canonical useLocationSearch hook for the search feed", () => {
    expect(createQuotePageSrc).toMatch(
      /from\s+["']@\/lib\/entities\/locationEntity["']/,
    );
    expect(createQuotePageSrc).toMatch(/useLocationSearch\(\s*locationSearch\s*\)/);
  });

  it("offers a 'Create new client' action that opens the canonical CreateClientModal", () => {
    expect(createQuotePageSrc).toMatch(/createLabel="Create new client"/);
    expect(createQuotePageSrc).toMatch(/setCreateClientOpen\(true\)/);
    expect(createQuotePageSrc).toMatch(
      /from\s+["']@\/components\/CreateClientModal["']/,
    );
    expect(createQuotePageSrc).toMatch(/<CreateClientModal/);
  });

  it("invalidates the canonical client query keys after inline client creation", () => {
    expect(createQuotePageSrc).toMatch(
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']\/api\/clients\/search-locations["']/,
    );
  });

  it("after inline client creation, the new location is auto-selected for the quote", () => {
    expect(createQuotePageSrc).toMatch(/setSelectedLocation\(/);
    expect(createQuotePageSrc).toMatch(/handleClientCreated/);
  });
});

// ── Detail-page parity (extracted shared components) ────────────────

describe("CreateQuotePage — reuses Quote Detail components in draft mode", () => {
  it("imports QuoteSummaryCard and renders it (shared with saved page)", () => {
    expect(createQuotePageSrc).toMatch(
      /from\s+["']@\/components\/quotes\/QuoteSummaryCard["']/,
    );
    expect(createQuotePageSrc).toMatch(/<QuoteSummaryCard/);
  });

  it("imports QuoteDescriptionCard and renders it in mode='draft'", () => {
    expect(createQuotePageSrc).toMatch(
      /from\s+["']@\/components\/quotes\/QuoteDescriptionCard["']/,
    );
    expect(createQuotePageSrc).toMatch(/<QuoteDescriptionCard\s+mode="draft"/);
  });

  it("uses the canonical DetailPageShell layout primitive (same as the saved page)", () => {
    expect(createQuotePageSrc).toMatch(
      /from\s+["']@\/components\/layout\/DetailPageShell["']/,
    );
    expect(createQuotePageSrc).toMatch(/<DetailPageShell/);
  });

  it("does NOT render saved-only sections (Send / Approve / Decline / Convert / Notes / Activity / Reference)", () => {
    // Imports of saved-only components must be absent — the surest
    // signal that the page is not mounting them. Tightened regexes
    // (no JSX-shape pins; comments mentioning the component name are
    // acceptable but imports/mounts are not).
    // 2026-05-08 Tier 4 Notes canonicalization — pin both names so
    // a future refactor that re-exposes notes on the create page
    // through either the retired or the canonical primitive fails.
    expect(createQuotePageSrc).not.toMatch(
      /import\s+\{[^}]*EntityNotesSection[^}]*\}\s+from/,
    );
    expect(createQuotePageSrc).not.toMatch(
      /import\s+\{[^}]*EntityNotesPanel[^}]*\}\s+from/,
    );
    expect(createQuotePageSrc).not.toMatch(
      /import\s+\{[^}]*ActivityCard[^}]*\}\s+from/,
    );
    expect(createQuotePageSrc).not.toMatch(
      /import\s+\{[^}]*ReferenceFieldsSection[^}]*\}\s+from/,
    );
    expect(createQuotePageSrc).not.toMatch(
      /import\s+\{[^}]*QuoteHeaderCard[^}]*\}\s+from/,
    );
    expect(createQuotePageSrc).not.toMatch(
      /import\s+\{[^}]*ApplyQuoteTemplateModal[^}]*\}\s+from/,
    );
    expect(createQuotePageSrc).not.toMatch(
      /import\s+\{[^}]*SendCommunicationModal[^}]*\}\s+from/,
    );
    // Saved-only test ids must not appear on the create page either.
    expect(createQuotePageSrc).not.toMatch(/data-testid="button-send-quote"/);
    expect(createQuotePageSrc).not.toMatch(/data-testid="button-approve-quote"/);
    expect(createQuotePageSrc).not.toMatch(/data-testid="button-decline-quote"/);
    expect(createQuotePageSrc).not.toMatch(/data-testid="button-convert-to-job"/);
  });

  it("QuoteDetailPage consumes the same shared components in saved mode", () => {
    expect(quoteDetailPageSrc).toMatch(
      /from\s+["']@\/components\/quotes\/QuoteSummaryCard["']/,
    );
    expect(quoteDetailPageSrc).toMatch(/<QuoteSummaryCard/);
    expect(quoteDetailPageSrc).toMatch(
      /from\s+["']@\/components\/quotes\/QuoteDescriptionCard["']/,
    );
    expect(quoteDetailPageSrc).toMatch(/<QuoteDescriptionCard\s+mode="saved"/);
  });

  it("QuoteDetailPage no longer renders the inline description Collapsible/Textarea/Pencil block", () => {
    // After the extraction the saved page must consume the shared
    // QuoteDescriptionCard. The prior inline implementation hard-coded
    // a `descriptionExpanded` collapse state and a `setEditingDescription`
    // setter — neither should remain.
    expect(quoteDetailPageSrc).not.toMatch(/setDescriptionExpanded/);
    expect(quoteDetailPageSrc).not.toMatch(/setEditingDescription/);
  });

  it("QuoteDetailPage no longer renders an inline Quote Summary Card composed of MetaRow rows", () => {
    expect(quoteDetailPageSrc).not.toMatch(
      /<CardTitle[^>]*>Quote Summary<\/CardTitle>/,
    );
  });
});

// ── Draft line items adapter ────────────────────────────────────────

describe("draftQuoteLineItemsAdapter — mirrors the saved adapter's flags", () => {
  it("declares the surface as 'quote'", () => {
    expect(draftAdapterSrc).toMatch(/surface:\s*["']quote["']/);
  });

  it("matches the saved adapter capability flags (showCost / showTax / allowReorder / allowEditExisting)", () => {
    expect(draftAdapterSrc).toMatch(/showCost:\s*false/);
    expect(draftAdapterSrc).toMatch(/showTax:\s*false/);
    expect(draftAdapterSrc).toMatch(/allowReorder:\s*false/);
    expect(draftAdapterSrc).toMatch(/allowEditExisting:\s*true/);
  });

  it("saveAll hands the SavePlan back via onCommit (no API calls)", () => {
    expect(draftAdapterSrc).toMatch(/saveAll:\s*async\s*\(plan\)\s*=>/);
    expect(draftAdapterSrc).toMatch(/options\.onCommit\?\.\(plan\)/);
  });

  it("CreateQuotePage wires the draft adapter (no second line-items UI)", () => {
    expect(createQuotePageSrc).toMatch(
      /from\s+["']@\/components\/quotes\/draftQuoteLineItemsAdapter["']/,
    );
    expect(createQuotePageSrc).toMatch(/createDraftQuoteLineItemsAdapter/);
    expect(createQuotePageSrc).toMatch(/<LineItemsCard/);
  });
});

// ── Shared component shapes ─────────────────────────────────────────

describe("QuoteSummaryCard — pure presentational, no mode prop", () => {
  it("renders a Card titled 'Quote Summary' with subtotal / tax / total rows", () => {
    expect(summaryCardSrc).toMatch(/Quote Summary/);
    expect(summaryCardSrc).toMatch(/subtotal/);
    expect(summaryCardSrc).toMatch(/taxTotal/);
    expect(summaryCardSrc).toMatch(/total/);
  });

  it("uses formatCurrency from the canonical formatters helper", () => {
    expect(summaryCardSrc).toMatch(
      /from\s+["']@\/lib\/formatters["']/,
    );
    expect(summaryCardSrc).toMatch(/formatCurrency/);
  });
});

describe("QuoteDescriptionCard — supports both saved and draft modes", () => {
  it("discriminates on a `mode` prop with both 'saved' and 'draft' branches", () => {
    expect(descriptionCardSrc).toMatch(/mode:\s*"saved"/);
    expect(descriptionCardSrc).toMatch(/mode:\s*"draft"/);
  });

  it("saved mode exposes onSave + isSaving for the parent's PATCH mutation", () => {
    expect(descriptionCardSrc).toMatch(/onSave:/);
    expect(descriptionCardSrc).toMatch(/isSaving\?:/);
  });

  it("draft mode exposes a controlled `value` + `onChange` pair (no mutation, no PATCH)", () => {
    expect(descriptionCardSrc).toMatch(/onChange:\s*\(next:\s*string\)\s*=>\s*void/);
  });
});

// ── NewQuoteModal — fully retired (PR2) ─────────────────────────────

describe("NewQuoteModal — fully retired", () => {
  it("the modal source file no longer exists on disk", () => {
    const modalPath = resolve(
      __dirname,
      "../client/src/components/NewQuoteModal.tsx",
    );
    expect(existsSync(modalPath)).toBe(false);
  });

  it("App.tsx contains no NewQuoteModal import or JSX usage", () => {
    expect(appSrc).not.toMatch(
      /import\s+\{[^}]*NewQuoteModal[^}]*\}\s+from/,
    );
    expect(appSrc).not.toMatch(/<NewQuoteModal[\s/>]/);
  });

  it("Quotes.tsx contains no NewQuoteModal import or JSX usage", () => {
    expect(quotesPageSrc).not.toMatch(
      /import\s+\{[^}]*NewQuoteModal[^}]*\}\s+from/,
    );
    expect(quotesPageSrc).not.toMatch(/<NewQuoteModal[\s/>]/);
  });

  it("ClientDetailPage.tsx contains no NewQuoteModal import or JSX usage", () => {
    expect(clientDetailPageSrc).not.toMatch(
      /import\s+\{[^}]*NewQuoteModal[^}]*\}\s+from/,
    );
    expect(clientDetailPageSrc).not.toMatch(/<NewQuoteModal[\s/>]/);
  });

  it("LeadDetailPage.tsx contains no NewQuoteModal import or JSX usage", () => {
    expect(leadDetailPageSrc).not.toMatch(
      /import\s+\{[^}]*NewQuoteModal[^}]*\}\s+from/,
    );
    expect(leadDetailPageSrc).not.toMatch(/<NewQuoteModal[\s/>]/);
  });

  it("no client/src file contains a NewQuoteModal import or JSX usage", () => {
    const offenders: { file: string; line: number; content: string }[] = [];
    for (const file of collectClientSources()) {
      const src = readFileSync(file, "utf-8");
      const lines = src.split("\n");
      lines.forEach((line, idx) => {
        if (
          /import\s+\{[^}]*NewQuoteModal[^}]*\}\s+from/.test(line) ||
          /<NewQuoteModal[\s/>]/.test(line)
        ) {
          offenders.push({
            file,
            line: idx + 1,
            content: line.trim(),
          });
        }
      });
    }
    expect(
      offenders,
      `Unexpected NewQuoteModal references found:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.content}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});

// ── Lead → Quote conversion routes through /quotes/new ──────────────

describe("LeadDetailPage — Convert to Quote navigates to /quotes/new?leadId=…", () => {
  it("uses setLocation to navigate; no direct POST mutation", () => {
    expect(leadDetailPageSrc).toMatch(
      /setLocation\(`\/quotes\/new\?leadId=\$\{lead\.id\}`\)/,
    );
  });

  it("does NOT POST to /api/quotes from LeadDetailPage on convert click", () => {
    // The legacy convertMutation POSTed to /api/quotes here. After
    // PR2 the page never POSTs that path itself — the create flow
    // belongs to CreateQuotePage. (Other lead mutations remain on
    // /api/leads/:id paths, so this assertion is scoped to /api/quotes.)
    expect(leadDetailPageSrc).not.toMatch(
      /apiRequest[^(]*\(\s*["']\/api\/quotes["']/,
    );
  });

  it("does NOT mount the legacy convert-confirmation AlertDialog", () => {
    expect(leadDetailPageSrc).not.toMatch(/showConvertConfirm/);
    expect(leadDetailPageSrc).not.toMatch(/data-testid="button-convert-confirm"/);
  });

  it("button is gated by canConvert + !lead.convertedQuoteId (eligibility preserved)", () => {
    expect(leadDetailPageSrc).toMatch(
      /\{canConvert\s*&&\s*!lead\.convertedQuoteId\s*&&\s*\(/,
    );
  });

  it("renders a 'Convert to Quote' button with a stable test id", () => {
    expect(leadDetailPageSrc).toMatch(/data-testid="button-convert-to-quote"/);
    expect(leadDetailPageSrc).toMatch(/Convert to Quote/);
  });
});

// ── /quotes/new?leadId=… prefill behavior ───────────────────────────

describe("CreateQuotePage — ?leadId=… fetches the lead and prefills the draft", () => {
  it("reads leadId from the URL search params", () => {
    expect(createQuotePageSrc).toMatch(/params\.get\(\s*["']leadId["']\s*\)/);
  });

  it("fetches /api/leads/:id when leadId is present", () => {
    expect(createQuotePageSrc).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/leads\/\$\{leadIdFromQuery\}`/,
    );
  });

  it("uses the same query key shape LeadDetailPage uses (cache shared)", () => {
    expect(createQuotePageSrc).toMatch(
      /queryKey:\s*\[\s*["']leads["']\s*,\s*["']detail["']\s*,\s*leadIdFromQuery\s*\]/,
    );
  });

  it("the lead query is gated on leadIdFromQuery (does not fire for direct /quotes/new)", () => {
    expect(createQuotePageSrc).toMatch(/enabled:\s*!!leadIdFromQuery/);
  });

  it("prefills location, title, and description from the lead exactly once", () => {
    expect(createQuotePageSrc).toMatch(/prefillAppliedRef/);
    expect(createQuotePageSrc).toMatch(/setSelectedLocation\(\s*\{/);
    expect(createQuotePageSrc).toMatch(/lead\.locationId/);
    expect(createQuotePageSrc).toMatch(/lead\.title/);
    expect(createQuotePageSrc).toMatch(/lead\.description/);
  });

  it("includes leadId in the POST /api/quotes payload when present", () => {
    expect(createQuotePageSrc).toMatch(
      /\.\.\.\(leadIdFromQuery\s*\?\s*\{\s*leadId:\s*leadIdFromQuery\s*\}\s*:\s*\{\}\)/,
    );
  });
});

describe("CreateQuotePage — already-converted leads cannot create a duplicate quote", () => {
  it("renders a blocked state when lead.convertedQuoteId is set", () => {
    expect(createQuotePageSrc).toMatch(/leadAlreadyConverted/);
    expect(createQuotePageSrc).toMatch(
      /data-testid="create-quote-already-converted"/,
    );
  });

  it("offers an 'Open existing quote' affordance pointing at the lead's existing quote", () => {
    expect(createQuotePageSrc).toMatch(
      /setLocationRoute\(`\/quotes\/\$\{lead\.convertedQuoteId\}`\)/,
    );
    expect(createQuotePageSrc).toMatch(
      /data-testid="button-open-existing-quote"/,
    );
  });

  it("offers a back-to-lead affordance for both the blocked and load-error states", () => {
    expect(createQuotePageSrc).toMatch(/data-testid="button-back-to-lead"/);
  });

  it("renders a clear error state when the lead can't be loaded", () => {
    expect(createQuotePageSrc).toMatch(/leadLoadFailed/);
    expect(createQuotePageSrc).toMatch(/data-testid="create-quote-lead-error"/);
  });

  it("the prefill effect skips converted leads (no clobbering of edits)", () => {
    expect(createQuotePageSrc).toMatch(
      /if\s*\(\s*lead\.convertedQuoteId\s*\)\s*return;[\s\S]{0,200}prefillAppliedRef\.current\s*=\s*true/,
    );
  });
});

describe("CreateQuotePage — direct /quotes/new flow is unaffected", () => {
  it("the lead query is disabled when no leadId is in the URL", () => {
    // Same enabled-gate above — explicit pin so this contract does
    // not regress accidentally.
    expect(createQuotePageSrc).toMatch(/enabled:\s*!!leadIdFromQuery/);
  });

  it("location selector + create-new client + template flow are unconditional (no leadId branching)", () => {
    // The CreateOrSelectField mounts at the page level regardless
    // of leadId. Branching the selector behind a leadId check would
    // break direct /quotes/new.
    expect(createQuotePageSrc).toMatch(/<CreateOrSelectField/);
    expect(createQuotePageSrc).toMatch(/createLabel="Create new client"/);
    expect(createQuotePageSrc).toMatch(/select-quote-template/);
  });
});
