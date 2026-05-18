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
| `queryInvalidation/jobs.ts` | `invalidateJob`, `invalidateJobSubresources`, `invalidateJobLifecycle`, `invalidateJobExpense` |
| `queryInvalidation/invoices.ts` | `invalidateInvoice`, `invalidateInvoiceFinancials` |
| `queryInvalidation/quotes.ts` | `invalidateQuote`, `invalidateQuoteList` |
| `queryInvalidation/leads.ts` | `invalidateLead`, `invalidateLeadVisits` |
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
| Parts / line items (handled by `useJobsFeed` refetch + `["jobs"]` invalidation) | Parts mutations already call both; keep existing pattern |

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
| Add/cancel lead visit | `invalidateLead(qc, leadId)` + `invalidateLeadVisits(qc, leadId)` |

### Dashboard

`invalidateDashboard(qc)` covers the full set: semantic family (workflow/financial/today-summary),
action modal, and the URL-pattern capacity key.

---

## How legacy URL-pattern keys are handled

Jobs have both semantic keys (`["jobs", "detail", id]`) and URL-pattern sub-resource keys
(`["/api/jobs", id, "parts"]`). The semantic family prefix `["jobs"]` does NOT match the
URL-pattern keys via React Query prefix matching.

This is why `invalidateJobLifecycle` explicitly busts:
- `["jobs"]` — semantic family
- `["jobs", "detail", id]` — explicit detail
- `["/api/jobs", id, "parts"]` — URL-pattern parts
- `["/api/jobs", id, "expenses"]` — URL-pattern expenses
- `["/api/jobs", id, "time-entries"]` — URL-pattern time entries
- `["/api/jobs"]` — URL-pattern family prefix (catches any other sub-resource added later)

Similarly, dashboard has `["dashboard"]` (semantic) AND `["/api/dashboard/capacity"]` (URL-pattern).
`invalidateDashboard` busts both explicitly.

---

## How to add a new entity query key

1. Add the key factory to the appropriate `queryKeys/*.ts` file.
2. Export it from `queryKeys/index.ts` (already re-exports the whole module).
3. Note which pattern it uses (A or B). If mixed within the same entity, document why.
4. If it introduces a new sub-resource that won't be caught by the existing family prefix,
   update the corresponding invalidation helper in `queryInvalidation/`.

```ts
// Example: adding "job notes" sub-resource key
// In queryKeys/jobs.ts:
notes: (id: string) => ["/api/jobs", id, "notes"] as const,

// In queryInvalidation/jobs.ts — add to invalidateJobLifecycle if it should
// refresh on status change; or add a new targeted helper if it's only needed
// in specific mutations.
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

## Known open items (do not fix without the associated audit task)

| Item | Status |
|---|---|
| `["/api/pm/templates"]` vs `["/api/recurring-templates"]` possible duplication | Needs investigation (F-13) |
| `receivablesKeys` in `client/src/lib/receivablesQueryKeys.ts` | Not migrated into `queryKeys/invoices.ts` call sites — still imported directly where receivables surface uses it |
| Notes queries for non-invoice entities (jobs, clients, leads) | Not yet under factory keys; `EntityNoteDialog` invalidation not audited |
| Lead visit mutations | `invalidateLeadVisits` helper exists; no mutations currently exist in `LeadDetailPage.tsx` — wire up when visit mutations are added |
| Quote notes key retirement | `QuoteActionsRail.tsx` `["quote", id, "notes"]` and `EntityNotesPanel.tsx` `["/api/quotes", id, "notes"]` — deferred; covered by bridge helper prefix matching |
