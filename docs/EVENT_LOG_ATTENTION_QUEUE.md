# Phase 1 Architecture: Event Log + Attention Queue

## What Existed Before

The codebase already had extensive logging and status systems:

| System | Table | Purpose |
|--------|-------|---------|
| Security audit | `audit_events` | Team member management (create, email change, role change) |
| Platform admin audit | `audit_logs` | Cross-tenant admin actions, impersonation |
| Company audit | `company_audit_logs` | Tenant-scoped operational audit |
| Job status events | `job_status_events` | Job status transition trail |
| Job schedule audit | `job_schedule_audit` | Scheduling change history |
| QBO sync events | `qbo_sync_events` | QuickBooks sync operations |
| QBO sync queue | `qbo_sync_queue` | Admin-triggered sync jobs |
| Notifications | `notifications` | User-targeted in-app notifications |
| Notification snoozes | `notification_snoozes` | Temporary muting |

**No unified event log** existed for general business activity (job/invoice/client/quote CRUD).
**No attention queue** existed — "needs attention" was computed on-demand via SQL (dashboard.ts).

## What Was Added

### 1. Events Table (`events`)

Canonical tenant-scoped append-only event log.

**Schema:** `shared/schema.ts`
**Writer:** `server/lib/events.ts` → `logEvent(ctx, params)` / `logEventAsync(ctx, params)`
**Read layer:** `server/storage/events.ts`
**Routes:** `server/routes/activity.ts`

#### Fields
- `id` (UUID, auto)
- `tenantId` → `companies.id`
- `actorUserId` → `users.id` (nullable for system events)
- `actorType`: `user` | `system`
- `entityType`: `job` | `invoice` | `quote` | `client` | `location` | `payment` | `item` | `other`
- `entityId`: UUID
- `eventType`: dot-notation string (e.g., `job.created`, `invoice.sent`)
- `severity`: `info` | `warning` | `important`
- `summary`: short human string
- `meta`: JSONB (jobNumber, clientName, etc.)
- `createdAt`

#### Indexes
- `(tenantId, createdAt DESC)` — activity feed
- `(tenantId, entityType, entityId, createdAt DESC)` — entity timeline
- `(tenantId, eventType, createdAt DESC)` — event type filtering

#### API Endpoints
- `GET /api/activity?limit=50&cursor=<ISO>` — tenant activity feed
- `GET /api/activity/:entityType/:entityId?limit=50` — entity timeline

#### Instrumented Write Paths
| Event Type | Route File | Trigger |
|-----------|-----------|---------|
| `job.created` | `jobs.ts` | `POST /api/jobs` |
| `job.completed` / `job.status_changed` / `job.reopened` | `jobs.ts` | `POST /api/jobs/:id/status` |
| `job.archived` / `job.completed` | `jobs.ts` | `POST /api/jobs/:id/close` |
| `job.reopened` | `jobs.ts` | `POST /api/jobs/:id/reopen` |
| `job.scheduled` | `calendar.ts` | `POST /api/calendar/schedule` |
| `job.rescheduled` / `job.assigned` / `job.unassigned` | `calendar.ts` | `PATCH /api/calendar/schedule/:jobId` |
| `job.unscheduled` | `calendar.ts` | `POST /api/calendar/unschedule/:jobId` |
| `invoice.created` | `invoices.ts` | `POST /api/invoices/from-job/:jobId` |
| `invoice.sent` | `invoices.ts` | `POST /api/invoices/:id/send` |
| `client.created` | `clients.ts`, `customer-companies.ts`, `techField.ts` | `POST /api/clients`, `POST /api/clients/full-create`, `POST /api/customer-companies/:id/locations`, `POST /api/tech/clients` (all dedupe-gated; emit only when a new client_locations row was actually inserted) |
| `quote.created` | `quotes.ts` | `POST /api/quotes` |

### 2. Attention Items Table (`attention_items`)

Materialized "needs attention" queue with rule-based detection.

**Schema:** `shared/schema.ts`
**Rules engine:** `server/lib/attentionRules.ts`
**Read layer:** `server/storage/attention.ts`
**Routes:** `server/routes/attention.ts`

#### Fields
- `id` (UUID, auto)
- `tenantId` → `companies.id`
- `entityType`, `entityId`
- `ruleType`: `job.requires_invoicing` | `job.overdue` | `job.unassigned` | `job.unscheduled` | `invoice.past_due`
- `severity`: `high` | `medium` | `low`
- `status`: `open` | `resolved`
- `firstDetectedAt`, `lastDetectedAt`, `resolvedAt`
- `meta`: JSONB
- `dedupeKey`: `"${entityType}:${entityId}:${ruleType}"` — unique per tenant

#### Constraints/Indexes
- `UNIQUE (tenantId, dedupeKey)` — prevents duplicates
- `(tenantId, status, severity, lastDetectedAt DESC)` — filtered queries
- `(tenantId, entityType, entityId)` — entity lookups

#### Rules (Phase 1)
| Rule Type | Severity | Condition |
|-----------|----------|-----------|
| `job.requires_invoicing` | high | `status = 'completed'` and no invoice |
| `job.overdue` | high | `status = 'open'`, scheduled, `effectiveEnd < NOW()` |
| `job.unassigned` | medium | `status = 'open'`, scheduled, no `primaryTechnicianId` |
| `job.unscheduled` | medium | `status = 'open'`, no `scheduledStart` |

#### Evaluation Triggers
- **Incremental (on-write):** `recomputeAttentionForEntity(tenantId, entityType, entityId)` — called after every job mutation (create, status change, close, reopen, schedule, reschedule, unschedule)
- **Admin full recompute:** `POST /api/attention/recompute` (owner/admin only)

#### API Endpoints
- `GET /api/attention?entityType=job&status=open&limit=50&offset=0` — filtered items
- `GET /api/attention/summary` — counts by ruleType (for dashboard strip)
- `GET /api/attention/:entityType/:entityId` — items for one entity
- `POST /api/attention/recompute` — admin-only full recompute

### 3. Client Integration

- **Dashboard WorkflowStrip:** "Requires Invoicing", "Unassigned", "Unscheduled" counts now come from `/api/attention/summary` with fallback to existing workflow counts
- **Dashboard Recent Activity:** Reads from `/api/activity?limit=20` instead of in-memory `ActivityStore`
- **ActivityStore preserved:** Client-side `logActivity()` calls remain for immediate UI feedback; server events are the canonical source

## How to Extend

### Adding a New Event Type
1. Add `logEventAsync()` call in the relevant route after the successful write
2. No schema changes needed — `eventType` is a free string

### Adding a New Attention Rule
1. Add the rule type to `attentionRuleTypeEnum` in `shared/schema.ts`
2. Add a rule object to the `RULES` array in `server/lib/attentionRules.ts` with:
   - `ruleType`, `severity`
   - `detect(tenantId)` — full scan
   - `detectForEntity(tenantId, entityId)` — single entity check
3. Add `recomputeAttentionForEntity()` calls to relevant write paths
4. Run `npm run db:push` to update enum (or it's just a text field, no migration needed)

### Multi-Tenant Safety
- Both tables have `tenantId` as first column in all indexes
- All queries filter by `tenantId` from `req.companyId` (set by `ensureTenantContext` middleware)
- `logEvent()` uses `ctx.tenantId` from `QueryCtx`
- `recomputeAttentionForEntity()` is always called with explicit `tenantId`
