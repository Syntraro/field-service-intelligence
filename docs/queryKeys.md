# Query Key & Cache Invalidation Contract

This document is the authoritative reference for React Query key conventions and
mutation invalidation in the main web app (`client/src/`).

Read `client/src/lib/queryKeys.md` first — it explains why two patterns coexist
(Pattern A / URL-string vs Pattern B / semantic). This doc builds on that foundation
and describes the factory modules and invalidation helpers introduced in 2026-05.

---

## Canonical key modules

All query key definitions live in `client/src/lib/queryKeys/`.

| Module | Entity | Primary pattern |
|---|---|---|
| `queryKeys/jobs.ts` | Jobs, job sub-resources | Pattern B + legacy Pattern A sub-resources |
| `queryKeys/invoices.ts` | Invoices, receivables workspace | Pattern B + re-exports receivablesQueryKeys |
| `queryKeys/quotes.ts` | Quotes | Pattern B canonical + legacy bridge (see "Quote Key Bridge Period") |
| `queryKeys/leads.ts` | Leads, lead visits | Pattern B + legacy Pattern A visits |
| `queryKeys/clients.ts` | Locations, companies | Pattern A |
| `queryKeys/servicePlans.ts` | Recurring templates, PM templates | Pattern A |
| `queryKeys/dashboard.ts` | Dashboard widgets, KPIs, capacity | Pattern B + Pattern A (capacity) |
| `queryKeys/team.ts` | Team members, roles, permissions | Pattern A |
| `queryKeys/index.ts` | Re-exports all of the above | — |

**Rule:** Import from the module, never inline string literals.

```ts
// ✅ correct
import { jobKeys } from "@/lib/queryKeys";
queryKey: jobKeys.detail(jobId)

// ❌ wrong
queryKey: ["jobs", "detail", jobId]
```

---

## Canonical invalidation modules

All mutation invalidation helpers live in `client/src/lib/queryInvalidation/`.

| Module | Helpers |
|---|---|
| `queryInvalidation/jobs.ts` | `invalidateJob`, `invalidateJobSubresources`, `invalidateJobLifecycle`, `invalidateJobExpense`, `invalidateJobParts`, `invalidateJobTimeEntries`, `invalidateJobEquipment`, `invalidateJobNotes` |
| `queryInvalidation/invoices.ts` | `invalidateInvoice`, `invalidateInvoiceFinancials` |
| `queryInvalidation/quotes.ts` | `invalidateQuote`, `invalidateQuoteList` |
| `queryInvalidation/leads.ts` | `invalidateLead`, `invalidateLeadList`, `invalidateLeadVisits` |
| `queryInvalidation/clients.ts` | `invalidateClientLocation`, `invalidateClientContacts`, `invalidateLocationEquipment` |
| `queryInvalidation/servicePlans.ts` | `invalidateServicePlans` |
| `queryInvalidation/dashboard.ts` | `invalidateDashboard` |
| `queryInvalidation/index.ts` | Re-exports all of the above |

**Rule:** Mutations must call a helper from this module — not inline `invalidateQueries` arrays.

```ts
// ✅ correct
import { invalidateInvoiceFinancials } from "@/lib/queryInvalidation";
onSuccess: () => { invalidateInvoiceFinancials(queryClient, invoiceId); }

// ❌ wrong
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
  queryClient.invalidateQueries({ queryKey: receivablesKeys.invoicesRoot() });
  // ... etc
}
```

---

## Choosing the right helper

### Job mutations

| Mutation type | Helper |
|---|---|
| Status change (close, reopen, undo-close) | `invalidateJobLifecycle(qc, jobId)` |
| Field update (header, description, assignment) | `invalidateJob(qc, jobId)` |
| Expense add/edit/delete | `invalidateJobExpense(qc, jobId)` |
| Parts / line items add/edit/delete | `invalidateJobParts(qc, jobId)` |
| Time entry add/edit/delete | `invalidateJobTimeEntries(qc, jobId)` |
| Equipment add/remove | `invalidateJobEquipment(qc, jobId)` |
| Note add/edit/delete | `invalidateJobNotes(qc, jobId)` |

### Invoice mutations

| Mutation type | Helper |
|---|---|
| Void, delete, status change | `invalidateInvoice(qc, invoiceId)` |
| Create invoice from job | `invalidateInvoice(qc, invoiceId, { jobId })` — job keys needed too |
| Refresh from job | `invalidateInvoice(qc, invoiceId, { jobId })` |
| Line add/edit/delete/reorder | `invalidateInvoiceFinancials(qc, invoiceId)` |
| Payment create | `invalidateInvoiceFinancials(qc, invoiceId)` |
| Payment terms, invoice number, discount | `invalidateInvoiceFinancials(qc, invoiceId)` |

### Quote mutations

| Mutation type | Helper |
|---|---|
| Line add/edit/delete | `invalidateQuote(qc, quoteId)` |
| Approve, decline, convert, owner update | `invalidateQuote(qc, quoteId)` |
| Assessment schedule/complete/cancel | `invalidateQuote(qc, quoteId)` |
| Send (via SendCommunicationModal) | `invalidateQuote(qc, quoteId)` |
| Delete quote (no detail left) | `invalidateQuoteList(qc)` — no detail to bust |
| Create quote (no detail yet) | `invalidateQuoteList(qc)` |

### Lead mutations

| Mutation type | Helper |
|---|---|
| Status change, header update, archive, hard delete | `invalidateLead(qc, leadId)` |
| Create lead (no detail yet), delete lead | `invalidateLeadList(qc)` |
| Add/cancel lead visit | `invalidateLead(qc, leadId)` + `invalidateLeadVisits(qc, leadId)` |

### Dashboard

`invalidateDashboard(qc)` covers the full set: semantic family (workflow/financial/today-summary),
action modal, and the URL-pattern capacity key.

---

## How legacy URL-pattern keys are handled

**Jobs: fully migrated as of Phase 3J (2026-05-18).** All job cache keys are Pattern B
(semantic). `jobKeys.urlFamily()` has been removed; `invalidateJobLifecycle` and all other
job helpers now bust only `["jobs", ...]` semantic keys. No `["/api/jobs", ...]` query keys
remain anywhere in the app.

Dashboard has `["dashboard"]` (semantic) AND `["/api/dashboard/capacity"]` (URL-pattern).
`invalidateDashboard` busts both explicitly.

---

## How to add a new entity query key

1. Add the key factory to the appropriate `queryKeys/*.ts` file.
2. Export it from `queryKeys/index.ts` (already re-exports the whole module).
3. Note which pattern it uses (A or B). If mixed within the same entity, document why.
4. If it introduces a new sub-resource that won't be caught by the existing family prefix,
   update the corresponding invalidation helper in `queryInvalidation/`.

```ts
// Example: adding a new sub-resource key for jobs
// In queryKeys/jobs.ts — use Pattern B (semantic) under jobKeys.detail:
newSub: (id: string) => ["jobs", "detail", id, "newSub"] as const,

// In queryInvalidation/jobs.ts — add a targeted helper:
export function invalidateJobNewSub(qc, jobId) {
  qc.invalidateQueries({ queryKey: jobKeys.newSub(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  qc.invalidateQueries({ queryKey: jobKeys.root() });
  // urlFamily() bridge if un-migrated URL-pattern consumers exist:
  qc.invalidateQueries({ queryKey: jobKeys.urlFamily() });
}
```

---

## How to add a new mutation invalidation helper

1. Add the function to the appropriate `queryInvalidation/*.ts` module.
2. Export it from `queryInvalidation/index.ts`.
3. Document which helpers it composes (if it calls other helpers).
4. Add a test in `tests/query-invalidation/` that asserts every key it should bust.

---

## Quote Key Bridge Period

As of 2026-05-17, quote keys are in a bridge period. The canonical factory
(`queryKeys/quotes.ts`) exposes both new canonical keys and legacy keys under
`quoteKeys.legacy.*`. The invalidation helpers bust both simultaneously.

**Canonical keys (use for new queries):**

| Key | Shape |
|---|---|
| `quoteKeys.root()` | `["quotes"]` |
| `quoteKeys.list(filters?)` | `["quotes", "list", filters ?? null]` |
| `quoteKeys.detail(id)` | `["quotes", "detail", id]` |
| `quoteKeys.notes(id)` | `["quotes", "detail", id, "notes"]` |
| `quoteKeys.stats()` | `["quotes", "stats"]` |
| `quoteKeys.viewCounts()` | `["quotes", "views", "counts"]` |

**Legacy keys (still live — covered via `quoteKeys.legacy.*`):**

| Call site | Legacy key | Status |
|---|---|---|
| `QuoteActionsRail.tsx` (notes query) | `["quote", id, "notes"]` | Deferred |
| `EntityNotesPanel.tsx` (quote notes) | `["/api/quotes", id, "notes"]` | Deferred |

Once the notes queries are migrated, remove the `legacy.*` property from the factory
and delete the bridge bust calls in `queryInvalidation/quotes.ts`.

---

## Job sub-resource migration status (as of 2026-05-18)

| Sub-resource | Factory key shape | Canonical? | Helpers |
|---|---|---|---|
| `equipment` | `["jobs", "detail", id, "equipment"]` | ✅ Pattern B | `invalidateJobEquipment` |
| `notes` | `["jobs", "detail", id, "notes"]` | ✅ Pattern B | `invalidateJobNotes` |
| `parts` | `["jobs", "detail", id, "parts"]` | ✅ Pattern B | `invalidateJobParts` |
| `expenses` | `["jobs", "detail", id, "expenses"]` | ✅ Pattern B | `invalidateJobExpense` |
| `timeEntries` | `["jobs", "detail", id, "timeEntries"]` | ✅ Pattern B | `invalidateJobTimeEntries` |
| `timeSummary` | `["jobs", "detail", id, "timeSummary"]` | ✅ Pattern B | `invalidateJobTimeEntries` (co-busted) |
| `billablePreview` | `["jobs", "detail", id, "billablePreview"]` | ✅ Pattern B | bust via `invalidateJob` root |
| `requiredSkills` | `["jobs", "detail", id, "requiredSkills"]` | ✅ Pattern B | `invalidateJobRequiredSkills` |
| `statusEvents` | `["jobs", "detail", id, "statusEvents"]` | ✅ Pattern B | bust via `invalidateJob` root |
| `scheduleHistory` | `["jobs", "detail", id, "scheduleHistory"]` | ✅ Pattern B | bust via `invalidateJob` root |
| `assignmentRecs` | `["jobs", "detail", id, "assignmentRecs", date]` | ✅ Pattern B | bust via `invalidateJob` root |

**Phase 3J complete (2026-05-18):** `jobKeys.urlFamily()` removed. All job helpers emit only canonical Pattern B keys. Zero `["/api/jobs", ...]` query keys anywhere in the app. Fetch URLs (`/api/jobs/...`) are unaffected — they are not cache keys.

---

## Known open items (do not fix without the associated audit task)

| Item | Status |
|---|---|
| `["/api/pm/templates"]` vs `["/api/recurring-templates"]` possible duplication | Needs investigation (F-13) |
| `receivablesKeys` in `client/src/lib/receivablesQueryKeys.ts` | Not migrated into `queryKeys/invoices.ts` call sites — still imported directly where receivables surface uses it |
| Quote notes key retirement | `QuoteActionsRail.tsx` `["quote", id, "notes"]` and `EntityNotesPanel.tsx` `["/api/quotes", id, "notes"]` — deferred; covered by bridge helper prefix matching |
| Phase 3H (low-risk sub-resource consumers) | ✅ Complete (2026-05-18) |
| Phase 3I (search/list + dispatch bridge) | ✅ Complete (2026-05-18): `useDispatchPreviewMutations`, `ServicePlanDispatchTab`, `NewInvoicePage`, `JobSession*Modal`, `TimeEntryEditModal`, `JobDetailPage` stray ghost all migrated |
| Phase 3J — remove `jobKeys.urlFamily()` | ✅ Complete (2026-05-18): bridge removed; all helpers emit Pattern B only |
