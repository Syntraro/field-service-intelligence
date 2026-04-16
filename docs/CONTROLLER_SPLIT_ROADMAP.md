# Controller Split Roadmap

**Status:** plan only — no implementation yet (2026-04-14 Phase 3 clean-surfaces).

The four oversized route files below each mix multiple concerns in a single
controller module. Each split should happen opportunistically when a feature
touches that concern, not as a standalone refactor sweep. This file documents
the intended module boundaries so any developer picking up a related task can
split cleanly.

Split rules for every file:

- Route path, auth guards, and HTTP surface **unchanged**.
- Controllers remain thin — split by HTTP concern, not by service rewrite.
- Each new router mounts under the same parent path via `app.use(..., router)`
  in `server/routes/index.ts`.
- No schema change, no service rewrite, no storage rewrite.
- Every split ships with typecheck + smoke test of the affected endpoints.

---

## 1. `server/routes/qbo.ts` (~2787 lines)

### Concern map

| Concern | Routes (representative) | Target module |
|---|---|---|
| OAuth / connection lifecycle | `/api/qbo/connect`, `/callback`, `/disconnect`, `/status` | `server/routes/qbo/connection.ts` |
| Customer sync | `/api/qbo/customers/*`, `/sync-customers` | `server/routes/qbo/customerSync.ts` |
| Invoice sync | `/api/qbo/invoices/*`, `/sync-invoice/:id` | `server/routes/qbo/invoiceSync.ts` |
| Payment sync | `/api/qbo/payments/*` | `server/routes/qbo/paymentSync.ts` |
| Item / product sync | `/api/qbo/items/*` | `server/routes/qbo/itemSync.ts` |
| Webhook receiver | `/api/qbo/webhook` | `server/routes/qbo/webhook.ts` |
| Admin / replay endpoints | `/api/qbo/admin/replay/*`, `/queue-status` | `server/routes/qbo/admin.ts` |

### Migration order
1. Webhook receiver (isolated, independent auth surface).
2. Admin / replay endpoints (already import `platformAuditService`; smallest blast radius).
3. Payment sync (already behind `paymentRepository`).
4. Invoice sync.
5. Customer sync.
6. Item sync.
7. OAuth connection lifecycle (last — touched by everything else).

### Risk notes
- Existing qbo services in `server/services/qbo/*` already split by concern. The route file is the only monolith.
- Order matters: webhook must keep the same mount path so Intuit doesn't re-verify.

---

## 2. `server/routes/jobs.ts` (~1740 lines)

### Concern map

| Concern | Routes | Target module |
|---|---|---|
| CRUD (create / update / delete / list / detail) | `POST /`, `PATCH /:id`, `DELETE /:id`, `GET /`, `GET /:id` | `server/routes/jobs/crud.ts` |
| Lifecycle transitions (hold, resume, complete, reopen, close) | `POST /:id/hold`, `/resume`, `/complete`, `/reopen`, `/close`, `/cancel` | `server/routes/jobs/lifecycle.ts` |
| Assignment / crew | `POST /:id/assign`, `/unassign`, `/crew` | `server/routes/jobs/assignment.ts` |
| Notes | `/:id/notes/*` | `server/routes/jobs/notes.ts` |
| Time tracking sub-resources | `/:id/time-summary`, `/:id/time-entries` | `server/routes/jobs/time.ts` |
| Parts / expenses sub-routers | already separate via mounts | — |
| Search / filters | `GET /search`, `GET /?status=...` | `server/routes/jobs/search.ts` |

### Migration order
1. Notes (isolated sub-resource).
2. Time tracking sub-resources.
3. Search / filter endpoint.
4. Assignment.
5. Lifecycle.
6. CRUD (last — widest surface).

### Risk notes
- Lifecycle endpoints must route through `jobLifecycleOrchestrator` — do not inline logic during split.
- All emit `dispatchBus.emitDispatch` — preserve every emit site exactly.

---

## 3. `server/routes/techField.ts` (~1568 lines)

### Concern map

| Concern | Routes | Target module |
|---|---|---|
| Visit lifecycle (start, en-route, pause, resume, complete, cancel) | `POST /visits/:id/*` | `server/routes/tech/visits.ts` |
| Clock in / out | `POST /clock-in`, `/clock-out` | `server/routes/tech/timeClock.ts` |
| Task state transitions | `POST /tasks/:id/*` | `server/routes/tech/tasks.ts` |
| Today summary / shift state | `GET /time/summary`, `/visits/today` | `server/routes/tech/today.ts` |
| Location / notes / parts | `POST /visits/:id/notes`, `/parts` | `server/routes/tech/visitExtras.ts` |

### Migration order
1. Today summary (read-only, no mutations).
2. Visit extras (notes / parts).
3. Task state.
4. Clock in / out.
5. Visit lifecycle (last — widest dispatchBus emitter).

### Risk notes
- Every mutation emits `dispatchBus.emitDispatch` — 20+ emit sites (per the prior realtime audit). Preserve every one.
- Tech-app hooks depend on exact URL paths — no path changes during split.

---

## 4. `server/routes/invoices.ts` (~1558 lines)

### Concern map

| Concern | Routes | Target module |
|---|---|---|
| CRUD (create, patch, delete, list, detail) | `POST /`, `PATCH /:id`, `DELETE /:id`, `GET /`, `GET /:id` | `server/routes/invoices/crud.ts` |
| Line management | `POST /:id/lines`, `PATCH /:id/lines/:lineId`, `DELETE /:id/lines/:lineId`, reorder, apply-tax | `server/routes/invoices/lines.ts` |
| Lifecycle (send, void, mark-sent) | `POST /:id/send`, `/void`, `PATCH /:id/sent` | `server/routes/invoices/lifecycle.ts` |
| From-job / refresh-from-job | `POST /from-job/:jobId`, `/:id/refresh-from-job` | `server/routes/invoices/fromJob.ts` |
| PDF | `GET /:id/pdf` | `server/routes/invoices/pdf.ts` |
| QBO lock / override | intertwined with CRUD + lifecycle | leave intertwined initially; extract only if it grows |

### Migration order
1. PDF (read-only, isolated).
2. Lines (sub-resource).
3. From-job (single concern).
4. Lifecycle (already calls `emailDispatchService` via `afterMarkSent` callback — behavior-preserved by the Phase D atomicity fix).
5. CRUD (last — widest surface, touches QBO lock).

### Risk notes
- `POST /:id/send` was hardened by Phase D (atomic dispatch + updateInvoice). Preserve the `afterMarkSent` callback pattern exactly.
- QBO lock checks (`checkQboBillingLock`, `isQboSynced`) appear in multiple concerns — extract to a shared helper in `server/lib/invoiceQboLock.ts` when the first split touches it; do not duplicate.

---

## Global invariants preserved by every split

- Route → service → storage layering.
- All `requireRole(RESTRICTED_MANAGER_ROLES)` / `requireRole(MANAGER_ROLES)` guards remain on the same endpoints with the same role sets.
- All `dispatchBus.emitDispatch` call sites remain in the same handlers.
- All `logEventAsync` call sites remain in the same handlers.
- No schema change.
- No migration.
- No behavior change.

When picking up a split, start with the module at the top of the migration order
for that file and ship it as a standalone PR before moving to the next.
