# Import System Audit — Syntraro HVAC Platform

**Date:** 2026-04-21
**Scope:** Historical job imports, client imports, product/service imports
**Mode:** Read-only audit, no code changes

---

## 1. Current architecture map

### Backend — routes (mounted in `server/routes/index.ts`)

| Path | File | LOC | Auth |
|---|---|---|---|
| `POST /api/client-import/preview`, `/execute` | `server/routes/clientImport.ts` | 286 | `requireAuth` → `requireRole(["owner","admin"])` |
| `POST /api/job-import/preview`, `/execute` | `server/routes/jobImport.ts` | 227 | same |
| `POST /api/product-import/preview`, `/execute` | `server/routes/productImport.ts` | 219 | same |

All three are **JSON-body** endpoints that accept `{ csvText, mappings }` — **no `multer`, no multipart uploads**. CSV text is sent inline, capped at 5 MB / 10 MB / 5 MB respectively, and 500 / 2 000 / 1 000 rows.

### Backend — services (the "thick" import logic)

| File | LOC | Writes via |
|---|---|---|
| `server/services/clientImport.ts` | 829 | `customerCompanyRepository.createOrGetCustomerCompanyTx`, `clientRepository.createOrGetLocationTx`, `clientContactRepository.createOrGetPersonTx` — all inside `db.transaction()` |
| `server/services/jobImport.ts` | 613 | `jobRepository.createJobWithExplicitNumber`, `clientRepository.createOrGetLocationTx` inside `db.transaction()`; **raw `tx.insert(jobNotes)`** at `server/services/jobImport.ts:584` |
| `server/services/productImport.ts` | 451 | `itemRepository.createOrGet` — **no `db.transaction()` anywhere** (zero matches); comment at L414–418 relies on DB unique-index as the race catch-net |

### Backend — shared contracts

| File | LOC | Purpose |
|---|---|---|
| `shared/clientImportTypes.ts` | 373 | `ValidatedRow`, `ImportRowResult`, field-group map. **No Zod schemas.** |
| `shared/jobImportTypes.ts` | 375 | `JobValidatedRow`, `JobImportRowResult`. Errors are flat `string[]`, not typed. |
| `shared/productImportTypes.ts` | 215 | `ProductValidatedRow`, `ProductImportRowResult`. Typed `ProductRowError`. |
| `shared/csvParser` *(consumed by all three services — parser location in shared folder)* | — | `parseCSV()` — quote-aware CSV split. This is the **only** genuinely shared piece of backend logic. |

### Backend — separate QBO import surface (not consolidated)

| File | LOC (approx) | Writes via |
|---|---|---|
| `server/services/qbo/QboCustomerImportService.ts` | ~1 045 | **Raw Drizzle** — 12 direct `db.*` writes |
| `server/services/qbo/QboCatalogImportService.ts` | ~1 045 | **Raw Drizzle** — 2 direct `db.*` writes |

These are mounted via `server/routes/qbo.ts`, log through `QboSyncLogger` (not `audit_logs`), and **share zero code with the CSV import services**. They implement their own dedup, dry-run, overwrite-vs-merge policy.

### Frontend — three parallel pages

| Route | File | LOC |
|---|---|---|
| `/settings/import-clients` | `client/src/pages/ClientImportPage.tsx` | 814 |
| `/settings/import-jobs` | `client/src/pages/JobImportPage.tsx` | 743 |
| `/settings/import-products` | `client/src/pages/ProductImportPage.tsx` | 681 |

All three are registered under `<ProtectedRoute requireAdmin>` (App.tsx:508–522) and surfaced as three Upload-icon cards inside Settings → Data (SettingsPage.tsx:176–186). They do not appear in the main sidebar. **No shared wizard, step component, column mapper, preview table, or summary card** — every primitive is re-implemented per page.

### Infrastructure / observability

- **No `import_runs` / `import_history` / `import_batches` table** in `shared/schema.ts`. Only hit is two QBO-onboarding timestamps (`qboOnboardingCatalogImportedAt`, `qboOnboardingCustomersImportedAt`).
- **No audit-log integration.** Grep for `auditLogService` / `audit_logs` / `auditService` in the three CSV import services returns **zero matches**.
- **No logger calls.** The import services do not log progress, errors, or counts to any logging framework.
- **No progress reporting, no streaming, no resumability.** Preview + execute are synchronous JSON POSTs.

### Tests

| File | LOC | Covers | Does NOT cover |
|---|---|---|---|
| `tests/csv-import-column-safety.test.ts` | 256 | parser quoting, Jobber header aliases, sample rendering | DB writes, tenant isolation |
| `tests/csv-import-hardening.test.ts` | 348 | `normalizeForMatch`, address composite key, within-CSV dedup, identity classification | DB writes, transaction failure, concurrency |
| `tests/csv-import-preview-ux.test.ts` | 334 | multi-email extraction, warning codes, row filter, postal normalization | anything post-preview |
| `scripts/verify-job-import.ts` | 323 | manual end-to-end job import smoke test | not wired into CI; hardcoded `COMPANY_ID`/`USER_ID` |

### Totals

~5 826 LOC of CSV import code + ~2 090 LOC of QBO import code = **~7 900 LOC** across **two parallel import systems with zero code share**.

---

## 2. Per-import flow map

### 2A. Client import (`clientImport.ts`)

```
UI upload (ClientImportPage:126)
  → client reads file → csvText string
  → parseCSV() client-side for header/sample only (ClientImportPage:598)
POST /api/client-import/preview  (JSON, 5MB cap, 500 rows)
  → server parseCSV() (clientImport.ts)
  → suggestMappings()                                           [clientImport.ts:51-86]
  → normalizeRow() per row                                      [clientImport.ts:130-176]
     - email split on , ; |
     - postal via normalizePostalCode()
     - booleans via coerceBoolean() (accepts yes/y/1/active)    [clientImport.ts:95]
  → validateRow() per row                                       [clientImport.ts:352-495]
  → classifyWithinCsvEntities()  (mutates row.*Action in place) [clientImport.ts:514-616]
  → load company/location/contact caches from DB (whole tenant)
  → return PreviewResponse { rows[], summary, conflicts }
USER clicks "Import X Row(s)"
POST /api/client-import/execute
  → re-parse CSV (no preview state carried forward)
  → per-row db.transaction(tx):
     customerCompanyRepository.createOrGetCustomerCompanyTx     [clientImport.ts:656]
     → billing fill-only merge                                  [clientImport.ts:669-688]
     clientRepository.createOrGetLocationTx                     [clientImport.ts:789]
     clientContactRepository.createOrGetPersonTx                [clientImport.ts:810]
  → per-row try/catch → continue on failure
  → subscription limit checked: canAddLocation()                [clientImport.ts: route L231]
  → return ExecuteResponse { created counts, failedRows[] }
```

**Shared with other imports:** `parseCSV`, `trimOrNull`, `normalizeForMatch`, `buildAddressCompositeKey`.
**Duplicated elsewhere:** `coerceBoolean` (different table vs product's `coerceBool`), header normalization, preview/execute state machine, summary response shape.
**Fragile:** `classifyWithinCsvEntities` mutates the `ValidatedRow` in place (non-idempotent on re-preview); billing-address conflicts are warning-only and silently fill-only-merged.

### 2B. Historical job import (`jobImport.ts`)

```
UI upload (JobImportPage:186)
POST /api/job-import/preview  (JSON, 10MB cap, 2000 rows)
  → parseCSV
  → suggestJobMappings()                                        [jobImport.ts:120-131]
  → normalizeJobRow() per row                                   [jobImport.ts:137-186]
     - dates via `new Date(str)` — TIMEZONE-NAIVE               [jobImport.ts:103-114]
     - job number parsed to int
  → validateJobRow() per row                                    [jobImport.ts:192-471]
     - multi-strategy location match: full addr → street+city
       → location-name → field-swap fallback
     - job number uniqueness checked within CSV AND in DB
       via canonical activeJobFilter()                          [routes/jobImport.ts:83]
  → return preview
POST /api/job-import/execute
  → per-row db.transaction(tx):
     jobRepository.createJobWithExplicitNumber(...)             [jobImport.ts:552]
       - status is HARDCODED "archived"                         [jobImport.ts:5, docstring]
     clientRepository.createOrGetLocationTx(...)                [jobImport.ts:502]
     tx.insert(jobNotes)  ← RAW DRIZZLE, not repository         [jobImport.ts:584]
  → unique-constraint conflicts caught by code                  [jobImport.ts:603]
  → NO subscription limit check
  → return ExecuteResponse { imported, locationsCreated, blocked, errors }
```

**Shared:** `parseCSV`.
**Duplicated:** header normalization (slightly different than client — collapses spaces same way but errors are flat `string[]` instead of typed). Preview/execute machine.
**Fragile:** `new Date()` is timezone-naive → a "2024-01-15" string becomes UTC midnight, off-by-one in some user zones. Raw `jobNotes` insert breaks the "always go through a repo" pattern. No subscription gate. Preview state discarded, CSV re-parsed on execute.

### 2C. Products / services import (`productImport.ts`)

```
UI upload (ProductImportPage:321)
POST /api/product-import/preview  (JSON, 5MB cap, 1000 rows)
  → parseCSV
  → suggestMappings()                                           [productImport.ts:35-41]
  → normalizeRow() per row                                      [productImport.ts:104-139]
     - coerceBool() (slightly different from client's coerceBoolean)  [productImport.ts:47-54]
     - coerceNumericString() strips $ € £ commas                      [productImport.ts:75-83]
     - type normalized: product/material/part → "product"; service/labor/labour → "service"
     - isTaxable DEFAULTS TO true; isActive DEFAULTS TO true          [productImport.ts:121]
  → validateRow() per row — LOADS FULL TENANT ITEM LIST PER ROW [productImport.ts:213-221]
  → classifyWithinCsvDuplicates()  (mutates rows)               [productImport.ts:296-338]
  → return preview
POST /api/product-import/execute
  → NO db.transaction()  (zero matches for `db.transaction` or `.transaction(`)
  → itemRepository.createOrGet(companyId, userId, ...)          [productImport.ts:419]
  → relies on DB unique index to catch concurrent duplicates
  → per-row try/catch → continue on failure
  → no subscription limit check
  → return ExecuteResponse
```

**Shared:** `parseCSV`, `normalizeForMatch`.
**Duplicated:** `coerceBool` duplicates client's `coerceBoolean` with divergent truthy set; preview/execute machine.
**Fragile:** no transaction wrapping (single-write atomicity is fine; the concern is that the pattern diverges from client/job and a future multi-write addition would silently inherit the missing `tx`). Taxability silently defaults to `true` if the CSV has no `taxable` column mapped. `validateRow` loads all tenant items per row (N×M DB reads) — memory + perf concern at scale.

---

## 3. Findings, severity-grouped

### CRITICAL

| # | Finding | Evidence |
|---|---|---|
| C1 | **No import audit trail.** No `import_runs` / `import_history` table. No `audit_logs` writes from any of the three services. An admin cannot answer "who imported what, when, how many rows landed?" | `shared/schema.ts` contains only `qboOnboardingCatalogImportedAt`/`qboOnboardingCustomersImportedAt`; grep of `auditLogService` in `server/services/{client,job,product}Import.ts` → 0 hits |
| C2 | **Three fully parallel frontend pipelines.** ~2 238 LOC of React across three pages with ~40–50 % copy-paste: upload handler, step machine, mapping UI, preview table, filter logic, summary cards, results — all re-implemented three times with divergent badge semantics ("new/exists/skip" vs "matched/create/blocked"). | `ClientImportPage.tsx` vs `JobImportPage.tsx` vs `ProductImportPage.tsx`; `ActionBadge` extracted only in Client (ClientImportPage:90-95); Job & Product inline equivalents |
| C3 | **QBO and CSV imports are two parallel universes.** Grepping `QboCatalogImportService` / `QboCustomerImportService` inside `server/services/*Import.ts` returns zero; grep of the reverse is also zero. Dedup rules, conflict policy, and logging are duplicated independently. | `server/services/qbo/*ImportService.ts` vs `server/services/{client,product}Import.ts` |
| C4 | **No feature/subscription gate on jobs or products.** Only client import calls `storage.canAddLocation(companyId)` (routes/clientImport.ts:231). A tenant can import unlimited jobs/products regardless of plan. | `server/routes/jobImport.ts:143-147`, `server/routes/productImport.ts:176-183` |

### HIGH

| # | Finding | Evidence |
|---|---|---|
| H1 | **Timezone-naive date parsing** in job import. `new Date("2024-01-15")` is interpreted as UTC midnight; the archived job's `createdAt`/`closedAt` can shift by a day for non-UTC tenants. | `server/services/jobImport.ts:103-114` |
| H2 | **Raw `jobNotes` insert bypasses the repository pattern.** `tx.insert(jobNotes)` is the only raw Drizzle write inside the CSV import services — asymmetric with the rest of the job-import flow. | `server/services/jobImport.ts:584` |
| H3 | **`coerceBoolean` / `coerceBool` drift.** Two implementations, different truthy sets. Client accepts `"active"`; product accepts `"active"`/`"inactive"`. A CSV uploaded via client import with `"inactive"` coerces to `null`, silently creating active records. | `server/services/clientImport.ts:95-102` vs `server/services/productImport.ts:47-54` |
| H4 | **Header normalization drift.** Client and job collapse whitespace + strip `-_`. Product only trims + lowercases. A column titled `"unit_price"` maps cleanly in job but only by exact match in product. | `clientImport.ts` header normalizer vs `productImport.ts` |
| H5 | **Product dedup relies on unique index only.** `productImport.ts` has zero `db.transaction()` calls; `itemRepository.createOrGet` is the only write. Comment at productImport.ts:414-418 explicitly documents reliance on DB unique-index as the race catch-net. Single-write case is safe today, but diverges from the client/job pattern and is a hidden contract. | `server/services/productImport.ts:419` |
| H6 | **Billing-address conflict is silent fill-only.** When CSV billing address conflicts with existing company, a warning is emitted but the service always executes the fill-only merge. User may expect "update address"; gets "keep old". | `server/services/clientImport.ts:468-471, 669-688` |
| H7 | **Preview state not carried into execute.** Both `clientImport` and `jobImport` re-parse CSV on execute. Between preview and execute, DB state can change (new row added); a row that was "valid in preview" may collide on execute. | `server/routes/clientImport.ts` execute handler, `routes/jobImport.ts` execute handler |
| H8 | **Action-badge vocabulary is not a shared contract.** Client says `new / exists / skip`; Job says `matched / create / blocked / not found`; Product says `new / exists`. An admin trained on Client will misread Job's "matched". | `ClientImportPage:90-95`, `JobImportPage:422-435`, `ProductImportPage:552-573` |

### MEDIUM

| # | Finding | Evidence |
|---|---|---|
| M1 | **No idempotency key.** Re-running the same CSV creates duplicates on types whose dedup is weak (e.g., jobs whose job numbers collide abort, but products with no SKU and slightly different name normalize-match inconsistently). | No `idempotency_key` column or `import_run_id` plumbed |
| M2 | **`classifyWithinCsvEntities` mutates `ValidatedRow` in place.** If the preview call is re-fired with the same input, rows are in a different state the second time. | `server/services/clientImport.ts:514-616` |
| M3 | **Product taxability defaults to `true` silently** when no `taxable` column is mapped. | `server/services/productImport.ts:121` |
| M4 | **Item dedup does per-row full tenant catalog load.** `validateRow` fetches all items each call; combined with within-row work this is approximately N × M. | `server/services/productImport.ts:213-221` |
| M5 | **Client tenant cache pre-loads entire customer tree.** All locations + contacts for every tenant company are loaded before per-row validation — memory risk for large tenants. | `server/services/clientImport.ts:256-320` |
| M6 | **No row-level "fix this row" affordance.** If row 42 fails validation, the user must fix the CSV and re-upload from scratch. Product hides blocked rows from preview entirely. | `ProductImportPage.tsx` preview filter |
| M7 | **No template download.** All three pages describe required columns but none serve a downloadable CSV template. | `ClientImportPage.tsx`, `JobImportPage.tsx`, `ProductImportPage.tsx` |
| M8 | **No irreversibility warning before commit.** No modal confirmation; job import button reads "Import X Job(s) as Archived" but doesn't say "this cannot be undone." | `ClientImportPage:775`, `JobImportPage:704`, `ProductImportPage:598` |
| M9 | **No logging.** Import services have zero `logger.*` calls. Errors are returned in the HTTP response and vanish. | `server/services/{client,job,product}Import.ts` — 0 logger hits |

### LOW / INFO

| # | Finding | Evidence |
|---|---|---|
| L1 | Product page uses a flat field list without category grouping; Client and Job group by Company / Billing / Location / Contact. | `ProductImportPage:397-405` vs `ClientImportPage:237-241` |
| L2 | Column-count mismatch warnings exist in Client + Product but **not Job**. A malformed Jobber export would be accepted silently. | `ClientImportPage:712-734`, `ProductImportPage:480-486`, `JobImportPage` — absent |
| L3 | Step-indicator visual differs (horizontal timeline in Client/Job vs numbered circles in Product). | `ProductImportPage:288-305` vs others |
| L4 | `scripts/verify-job-import.ts` is a local-only manual regression script; not wired into CI; hardcoded tenant IDs. | `scripts/verify-job-import.ts:17-18` |

---

## 4. Drift / duplication map

| Area | Where it's duplicated | Status |
|---|---|---|
| CSV parsing | `parseCSV()` in `@shared/csvParser` | **Already shared** ✓ |
| Match normalizers | `normalizeForMatch`, `buildAddressCompositeKey` in `@shared/*` | **Already shared** ✓ |
| Header normalization | `clientImport.ts`, `jobImport.ts`, `productImport.ts` | **Divergent** — product doesn't strip `-_`/collapse spaces |
| Boolean coercion | `coerceBoolean` (client) vs `coerceBool` (product) | **Near-duplicate, divergent truthy set** |
| Money parsing | Only in product (`coerceNumericString`) | **Not duplicated — but missing** in jobs where currency fields exist |
| Date parsing | Only in job, `new Date(str)` | **Not shared + timezone-naive** |
| Phone normalization | All three fall back to `trimOrNull` | **No canonical normalizer anywhere** |
| Dedup matcher for entities | Shared `normalizeForMatch` | **Shared** ✓ |
| Preview response shape | `ImportPreviewResponse` / `JobImportPreviewResponse` / `ProductImportPreviewResponse` | **Three independent types** |
| Row error envelope | `RowValidationError {field,message}` / flat `string[]` / `ProductRowError {field,message}` | **Divergent** — job breaks the typed pattern |
| Row action vocabulary | `new/exists/skip` / `matched/create/blocked/not found` / `new/exists` | **Incompatible** |
| Route guard chain | `requireAuth` + `requireRole(["owner","admin"])` | **Consistent** ✓ |
| Storage-layer discipline | `customerCompanyRepository`, `jobRepository`, `itemRepository` | **Consistent** ✓ — with the one raw `jobNotes` exception |
| Transaction strategy | `db.transaction` per row (client, job) vs **none** (product) | **Divergent** |
| Frontend step machine | 3× copy-paste `useState` + wizard state + handlers | **No shared wizard** |
| Frontend preview table | 3× copy-paste filter/export/table/badge | **No shared component** |
| Frontend summary cards | 3× copy-paste grids (8 / 6 / 4 cards) | **No shared component** |
| QBO vs CSV imports | Zero shared helpers | **Two parallel systems** |

---

## 5. UX findings

1. **Not one system — three tools that look alike.** 5-step wizard is common, but step indicators, button phrasing ("Validate & Preview" vs "Next: Preview"), badge colors, and summary card layouts all differ. Badge semantics in particular are incompatible — an admin who learns Client import *cannot* transfer the mental model to Job import.
2. **No template downloads.** All three pages describe required columns in text, but the user must hand-build a matching CSV. Offering `/settings/import-*/template.csv` would remove the single biggest source of malformed uploads.
3. **Silent column unmapping.** Mapping Column 6 to a field that Column 5 was already mapped to silently unmaps Column 5. No "conflict" affordance; Product page makes this worse because its fields are flat and not grouped.
4. **Blocked-row disclosure is inconsistent.** Client and Job explicitly label *"X blocked rows will be skipped"* before commit (ClientImportPage:765-768, JobImportPage:697-700). Product filters blocked rows silently.
5. **No "this is permanent" confirmation.** The commit button fires immediately. Job import says "…as Archived" but doesn't say "this creates records that can't be undone with one click."
6. **No row-level recovery.** If row 42 fails, the user must fix the CSV and re-upload — there is no "edit row in place" affordance anywhere.
7. **Results summaries under-inform.** Preview says "100 rows, 50 valid, 30 warnings, 20 blocked". Execute says "80 imported, 0 failed". The user has no visibility into whether any of the 30 "warning" rows actually landed, or whether any "valid" rows failed at commit.
8. **Terminology drift.** "Matched" in Client means "linked to existing entity, not updated". In Job it means "client resolved successfully". In Product it means "duplicate skipped".
9. **Hidden in settings.** Imports live under Settings → Data; there's no Import button from the Clients / Jobs / Products list pages themselves, which is where the user would instinctively reach for them.
10. **`fetch` vs `useMutation` inconsistency.** Product uses raw `fetch`; Client and Job use `useMutation` with proper loading/error states. Product imports can appear to hang because the network state is not surfaced identically.

---

## 6. Data integrity risks

| # | Risk | Likelihood | Impact |
|---|---|---|---|
| D1 | Rerunning a product CSV creates duplicate items where name-normalize is ambiguous (e.g., `"Filter 16x20"` vs `"Filter 16 x 20"`). No SKU, no tenant-level uniqueness beyond the DB's own constraints. | Medium | Medium |
| D2 | Timezone-naive date parsing creates archived jobs with off-by-one `createdAt` / `closedAt` for non-UTC tenants → reporting drift. | High for non-UTC tenants | Medium |
| D3 | Silent billing-address fill-only merge — incoming CSV addresses quietly ignored when an existing company has anything on file. | Medium | Medium |
| D4 | Raw `tx.insert(jobNotes)` can fail without aborting the surrounding job creation if error handling around it is imperfect — would leave a "bare" job without the intended historical note. | Low | Medium |
| D5 | Preview → execute re-parse: a row valid in preview can fail in execute because another user created a collision in between. | Low | Low |
| D6 | Imports bypass feature-capacity checks for jobs/products → a starter-tier tenant can import 100 000 jobs and dashboards/queries degrade. | Medium | High |
| D7 | No `import_run_id` on created rows → you cannot answer "which of these 12 000 jobs came from Monday's import?" and cannot undo an import in bulk. | Certain | High |
| D8 | Default-true taxability on product import can silently mis-tax invoices built from those items. | Medium | High |
| D9 | Job import accepts a CSV that shifts columns due to an unquoted comma — no column-count check exists in jobImport (Client and Product do check). | Low | High |
| D10 | `classifyWithinCsvEntities` mutates the `ValidatedRow`; any re-preview or retry changes behavior vs the first preview. | Low | Low |

Not a risk (confirmed clean): tenant isolation. Every write checks `eq(tbl.companyId, companyId)` or passes `companyId` to a repository. Client import validates subscription capacity. No cross-tenant leakage was found.

---

## 7. Recommended target architecture

A single entity-neutral import pipeline, backend-owned, thin frontend. Name it the **Import Pipeline** — singular.

### Backend: one pipeline, pluggable per entity

```
server/services/importPipeline/
  ├─ ImportPipeline.ts               ← the orchestrator (entity-neutral)
  ├─ types.ts                        ← PreviewResult, ExecuteResult, RowOutcome, ImportRun
  ├─ parse.ts                        ← wraps @shared/csvParser, header normalization (one impl)
  ├─ normalizers/                    ← shared field normalizers, one per primitive
  │   ├─ text.ts       (trimOrNull, collapseWhitespace)
  │   ├─ email.ts      (extractFirstEmail)
  │   ├─ phone.ts      (single canonical phone normalizer — currently missing)
  │   ├─ date.ts       (timezone-aware — accepts tenant timezone)
  │   ├─ money.ts      (strip symbols, to numeric string)
  │   ├─ bool.ts       (single canonical truthy set; deprecates coerceBoolean/coerceBool)
  │   └─ postal.ts     (already canonical)
  ├─ adapters/                       ← one adapter per entity — the *only* per-entity code
  │   ├─ ClientImportAdapter.ts      (schema, mapping suggestions, validateRow, applyRow)
  │   ├─ JobImportAdapter.ts         (historical-job policy lives here)
  │   └─ ProductImportAdapter.ts
  └─ persistence/
      ├─ importRunRepository.ts      ← new storage module
      └─ auditBridge.ts              ← writes one audit_logs row per run
```

- **One `ImportRun` record** per preview/execute pair — keyed by `(companyId, userId, id, idempotencyKey)`, carrying `entityType`, `csvChecksum`, `rowCount`, `createdAt`, `committedAt`, `status` (`previewed|committed|failed|partial`), `counts` (`succeeded`, `failed`, `skipped`).
- **One `ImportRunRow` record** per CSV row with `{ runId, rowIndex, disposition (created|matched|skipped|failed), entityId, errors[] }`. This gives the per-row audit trail the system lacks today and enables "undo import run X" semantics.
- **All new entity rows carry `importRunId`** — a nullable FK on `customer_companies`, `client_locations`, `client_contacts`, `jobs`, `items`. Makes undo and "where did this row come from?" answerable.
- **`ImportAdapter` is the only pluggable interface.** It exposes `{ suggestMapping, validateRow(normalized, ctx), applyRow(tx, validated, ctx), requiredColumns, entityLabel }`. Everything else (transactional envelope, preview caching, audit writes, response shape) is generic.
- **Preview state is cached on the server**, not re-parsed. `POST /api/imports/:runId/execute` refers to the preview's stored `runId` — eliminates preview-vs-execute drift.
- **Feature-capacity gates are enforced in the orchestrator** for every entity, not per-adapter. `assertFeatureCapacity(companyId, "items.max", currentCount, rowsToCreate)` before commit.
- **QBO adapters eventually plug into the same pipeline** — they would become `QboCustomerImportAdapter` / `QboCatalogImportAdapter`, reading from QBO API pages instead of CSV, but going through the same normalize → validate → apply → audit flow.

### Shared contracts

```
shared/importPipeline/
  ├─ contracts.ts           ← PreviewResponse, ExecuteResponse, RowDisposition (new|matched|skipped|failed)
  ├─ zod/
  │   ├─ client.ts
  │   ├─ job.ts
  │   └─ product.ts         ← Zod schemas per entity, co-located with types
  └─ terminology.ts         ← one canonical vocabulary; "new / matched / skipped / failed"
```

### Frontend: one wizard, three configurations

```
client/src/components/imports/
  ├─ ImportWizard.tsx            ← state machine: upload → map → preview → commit → results
  ├─ UploadStep.tsx              ← drag-drop + size/row hint
  ├─ ColumnMapper.tsx            ← schema-driven from adapter metadata
  ├─ PreviewTable.tsx            ← one table, disposition badges from canonical vocabulary
  ├─ SummaryCards.tsx            ← one grid, driven by counts from ExecuteResponse
  ├─ TemplateDownloadLink.tsx    ← one link, downloads the entity's template.csv
  └─ configs/
      ├─ clientImportConfig.ts   ← labels, required columns, help copy
      ├─ jobImportConfig.ts
      └─ productImportConfig.ts
```

- Three pages become thin: `return <ImportWizard config={clientImportConfig} />;` — ~30 LOC each.
- Badge vocabulary is single-source — no more "matched" meaning three things.
- Irreversibility confirmation modal is built into the wizard; adapter's `commitWarning` field customizes the copy.
- Row-level "download errors as CSV" is universal.

---

## 8. Proposed implementation plan

Phased. Every phase is shippable and reversible on its own.

### Phase 0 — Guardrails (no functional change)
1. Add `tests/csv-import-tenant-isolation.test.ts` that drives a preview → execute cycle through all three imports with two tenants. **Required before any refactor** so the refactor can't silently break isolation.
2. Add a smoke test equivalent of `scripts/verify-job-import.ts` for clients and products. Wire all three into CI.
3. Pin existing preview/execute response shapes with snapshot tests.

### Phase 1 — Observability (high-value, low-risk, independent)
1. New migration: create `import_runs` and `import_run_rows` tables.
2. Add nullable `import_run_id UUID` column to `customer_companies`, `client_locations`, `client_contacts`, `jobs`, `items`. Index `(company_id, import_run_id)`.
3. Wrap the existing three services with a minimal `ImportRunRecorder` that writes `import_runs` + row dispositions. Do not refactor the services yet.
4. Add a single `audit_logs` row per commit (`action: "import.executed"`, `metadata: { runId, entity, counts }`).
5. Expose `GET /api/imports/runs` with tenant-scoped pagination; add an Admin read-only page "Import History" using existing list primitives.

After Phase 1 the system is **fully observable and reversible** even though the three pipelines still exist.

### Phase 2 — Normalizer consolidation (backend only, no UI change)
1. Extract `server/services/importPipeline/normalizers/` from the three services. Deduplicate `coerceBoolean`/`coerceBool` into one `bool.ts` with an explicit truthy-set constant. Add `phone.ts` and a **timezone-aware** `date.ts` that takes the tenant timezone (fixes H1).
2. Extract `header.ts` normalizer; apply the existing client/job rule (strip `-_`, collapse whitespace, lowercase) to product. Small behavior change — call it out in CHANGELOG.
3. Replace the three services' inline helpers with imports from `normalizers/`. Tests from Phase 0 must stay green.
4. Fix the two drift-level defects: (a) raw `tx.insert(jobNotes)` → `jobNotesRepository.createInTx` (H2); (b) product's per-row catalog load → tenant-scoped prefetch with a `Map` (M4).

### Phase 3 — Contract unification (shared types)
1. Introduce `shared/importPipeline/contracts.ts` with the canonical `PreviewResponse<T>` / `ExecuteResponse<T>` and `RowDisposition` enum. Disposition vocabulary is fixed at `created | matched | skipped | failed`.
2. Adapter to existing services: on the server, after computing the existing response shape, map to the new contract and serve *both* shapes behind a `?schema=v2` query flag. Zero frontend change yet.
3. Add Zod schemas per entity under `shared/importPipeline/zod/`. Route handlers start validating request bodies with Zod.

### Phase 4 — Frontend wizard extraction (largest UX lift)
1. Build `client/src/components/imports/ImportWizard.tsx` + children as described, driven by entity configs. Target: one template download link, one badge vocabulary, one confirmation modal, one row-error-export.
2. Cut **one** page over — `ProductImportPage` first, because it's the smallest and most inconsistent. Ship.
3. Cut `JobImportPage`. Tighten historical-job copy ("This creates archived records. These records count toward reporting but not dispatch.").
4. Cut `ClientImportPage`.
5. Delete the three old page-specific step components (~1 500 LOC removed).

### Phase 5 — Backend orchestration (the real refactor)
1. Build `ImportPipeline.ts` with the adapter interface. One adapter at a time:
2. Port product import first (simplest domain). Preview state becomes server-cached, keyed by `runId`. Execute references the cached preview and the stored CSV checksum; re-parsing is eliminated.
3. Port job import. The historical-job policy (`status="archived"`, node creation, counter-reset) moves into the adapter as explicit, documented steps.
4. Port client import. Three-entity transaction (company + location + contact) is the exemplar for the adapter pattern.
5. Add feature-capacity gates at the orchestrator level for all three (fixes C4).
6. Remove the now-unused `server/services/{client,job,product}Import.ts`.

### Phase 6 — QBO consolidation (optional, high-value)
Once the pipeline is proven, the QBO services become two more adapters. Source changes from "CSV bytes" to "QBO API pages", but the rest of the pipeline (preview caching, audit, dispositions, run history) becomes shared. Expected net reduction: ~1 500 LOC.

### Phase 7 — Undo & dry-run
With `importRunId` on every row, add `POST /api/imports/runs/:id/revert` — a tenant-scoped soft-delete of rows created by that run. "Dry-run" becomes trivial (a preview that writes to `import_run_rows` but never calls `adapter.applyRow`).

---

## 9. Blunt summary

### What is architecturally wrong today

- **Three import pipelines where one belongs.** 5 800 LOC of CSV import + 2 100 LOC of QBO import with **no shared orchestrator, no shared wizard, no shared row vocabulary, no shared audit surface**. The QBO and CSV halves don't know each other exists.
- **No import provenance.** No `import_runs` table, no `import_run_id` on created rows, no audit-log entries. You cannot answer "who imported what, when, and how do I undo it?" with the data that's recorded today.
- **Three drifting implementations of the same primitives** — boolean coercion, header normalization, row-disposition vocabulary, row-error envelope, step machines, summary cards. Fixes made in one service silently fail to propagate.
- **Feature-gate asymmetry.** Client import respects subscription limits; jobs and products don't. A starter-tier tenant can import unlimited jobs.
- **Two silent correctness bugs.** (1) Job-import date parsing is timezone-naive — off-by-one `createdAt`/`closedAt` for non-UTC tenants. (2) Product-import taxability silently defaults to `true` when unmapped.
- **UX feels like three tools.** Badge semantics aren't translatable ("matched" means three different things), there are no template downloads, no irreversibility warnings, and no row-level error recovery.

### What is salvageable

- **Tenant isolation is solid.** Every write scopes to `companyId`. No cross-tenant leakage was found.
- **Storage-layer discipline is already in place on the CSV side.** `customerCompanyRepository`, `clientRepository`, `jobRepository`, `itemRepository` are the canonical writers. The one raw exception (`tx.insert(jobNotes)`) is a one-line fix.
- **`parseCSV`, `normalizeForMatch`, `buildAddressCompositeKey`, `normalizePostalCode`** are already genuinely shared — they become the seed of the new pipeline's shared normalizer module.
- **Dedup *policies* are well thought out per entity** (name+type for products; address composite key for locations; email/name+phone/name-only for contacts; job number with multi-strategy location match). Those policies port directly into adapters.
- **Client import's per-row transactional pattern** (`customerCompanyRepository.createOrGetCustomerCompanyTx` et al. under a single `db.transaction(tx)`) is the template to standardize on.
- **Existing CSV-hardening tests** (`csv-import-column-safety`, `csv-import-hardening`, `csv-import-preview-ux`) stay useful — they test the normalizers, which become shared.

### What should become the canonical import system

- **One `ImportPipeline` orchestrator** in `server/services/importPipeline/`, entity-neutral, with pluggable `ImportAdapter`s.
- **Client import's architecture** (per-row `db.transaction(tx)` + repository-only writes + feature gates) is the existing template closest to the target.
- **`import_runs` + `import_run_rows` + `import_run_id` FK on every importable entity** — the backbone for observability, audit, and revert.
- **One frontend `ImportWizard` component** driven by per-entity config — deletes ~1 500 LOC of duplicated React and makes the three imports feel like one surface.
- **Canonical disposition vocabulary** `created | matched | skipped | failed` — enforced in `shared/importPipeline/contracts.ts`.

### What should be removed or consolidated

- **Delete** the three step-machine React components once the wizard exists (~1 500 LOC).
- **Collapse** `coerceBoolean` and `coerceBool` into one `bool.ts` with an explicit documented truthy set.
- **Collapse** the three header normalizers into one; align Product with Client/Job.
- **Delete** the three preview/execute response interfaces once the canonical contract is live; map to `PreviewResponse<T>` / `ExecuteResponse<T>`.
- **Consolidate** the two QBO imports into the same pipeline as a later phase — they're the next 2 000 LOC of dedupable code waiting to be recognized.
- **Replace** the ad-hoc `new Date()` in job-import with the timezone-aware normalizer; accept the tenant IANA zone as an explicit context argument.
- **Do not remove** `scripts/verify-job-import.ts`, but promote it: port its assertions into a real `vitest` suite and add parallel scripts for clients and products.
