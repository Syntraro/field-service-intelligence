# Cache Invalidation Map

> Canonical reference for every client-side mutation and the TanStack Query keys
> it invalidates on success. Created as part of Phase 3 (Canonical Visit Feed Migration).
>
> **Last audited:** 2026-02-13 (Phase 5 — Final Cleanup, Parts A-E)

---

## Query Families

| Family | Key Prefix | Description |
|---|---|---|
| **Calendar** | `/api/calendar`, `/api/calendar/range`, `/api/calendar/unscheduled` | Scheduled events, date-range view, backlog sidebar |
| **Jobs** | `["jobs"]` (family prefix) | Canonical feed `["jobs","feed",…]`, detail `["jobs","detail",jobId]`. Sub-resources still use `/api/jobs/:id/*` keys. |
| **Dashboard** | `["dashboard"]` (family prefix) | Canonical keys `["dashboard","workflow"]`, `["dashboard","needs-attention",{date}]`. Dashboard-specific computed views only; invoice/job data use their own families. |
| **Invoices** | `["invoices"]` (family prefix) | Canonical feed `["invoices","feed",…]`, stats `["invoices","stats"]`, dashboard `["invoices","dashboard"]`, by-job `["invoices","by-job",jobId]`. |
| **Visits** | `["visits"]` (family prefix) | Canonical visit keys `["visits", jobId, "all"]`. Tech feed: `/api/tech/visits/today`, `/api/tech/visits/:id` |
| **Clients** | `/api/clients`, `/api/clients/:id` | Client locations and detail |
| **Customer Companies** | `/api/customer-companies/:id` | Parent company overview, locations |
| **Maintenance/PM** | `/api/maintenance`, `/api/recurring-templates` | PM statuses, recently completed, templates |
| **Equipment** | `/api/clients/:id/equipment` | Location equipment |
| **Notes** | Varies by entity (`/api/jobs/:id/notes`, etc.) | Job/client/invoice notes |
| **Timesheets** | `/api/admin/timesheets/day`, `/api/admin/timesheets/week` | Admin timesheet views |
| **Products** | `/api/items` | Parts & services catalog |

---

## Centralized Invalidation Helpers

### `useCalendarApi.ts` — Exported Helpers

| Helper | Keys Invalidated |
|---|---|
| `invalidateCalendarQueries(qc, op)` | `/api/calendar`, `/api/calendar/range` |
| `invalidateCalendarAndUnscheduledQueries(qc, op)` | `/api/calendar`, `/api/calendar/range`, `/api/calendar/unscheduled` |
| `invalidateJobQueries(qc, op, jobId?)` | `["jobs"]` — family-wide, matches feed + detail + any sub-keys (Phase 4) |
| `invalidateVisitQueries(qc, op, jobId)` | `["visits"]` — family-wide (Phase 4) |

### `useCalendarDnD.ts` — Internal Helpers

| Helper | Keys Invalidated |
|---|---|
| `invalidateCalendarOnly()` | All keys matching `/api/calendar*` EXCEPT `/api/calendar/unscheduled` |
| `invalidateCalendarAndUnscheduled()` | All keys matching `/api/calendar*`, `/api/calendar/unscheduled`, `/api/clients` |
| `invalidateNarrow(includeUnscheduled)` | `/api/calendar/unscheduled` (only if flag set) |

### `lib/jobScheduling.ts` — `invalidateScheduleQueries(jobId?)`

| Keys Invalidated |
|---|
| `/api/calendar`, `/api/calendar/range`, `/api/calendar/unscheduled`, `["jobs"]` family-wide (Phase 4) |

### `useMutationWithToast.ts` — `QUERY_GROUPS`

| Group | Keys |
|---|---|
| `calendar` | `/api/calendar`, `/api/calendar/all`, `/api/calendar/overdue`, `/api/calendar/unscheduled` |
| `jobs` | `["jobs"]` (Phase 4 canonical family key) |
| `clients` | `/api/clients` |
| `maintenance` | `/api/maintenance/statuses`, `/api/maintenance/recently-completed` |
| `invoices` | `["invoices"]` (Phase 5 canonical family key) |
| `equipment` | `/api/equipment` |
| `parts` | `/api/items`, `/api/client-parts/bulk` |
| `dashboard` | `["dashboard"]` (Phase 5 canonical family key) |

---

## Mutations by Source File

### Calendar Hooks — `hooks/useCalendarApi.ts`

| Mutation | API | Invalidates |
|---|---|---|
| `useScheduleJob` | `POST /api/calendar/schedule` | calendar, calendar/range, calendar/unscheduled, jobs, jobs/:jobId |
| `useRescheduleJob` | `PATCH /api/calendar/schedule/:jobId` | calendar, calendar/range, calendar/unscheduled, jobs, jobs/:jobId |
| `useUnscheduleJob` | `POST /api/calendar/unschedule/:jobId` | calendar, calendar/range, calendar/unscheduled, jobs, jobs/:jobId, jobs/:jobId/visits, jobs/:jobId/visits/all |
| `useCompleteJob` | `POST /api/jobs/:jobId/complete` | calendar, calendar/range, jobs, jobs/:jobId, `["dashboard"]` (family) |

### Calendar DnD — `hooks/useCalendarDnD.ts`

| Mutation | API | Invalidates |
|---|---|---|
| `createAssignment` | `POST /api/calendar/schedule` | Optimistic cache merge + `invalidateNarrow(true)` → calendar/unscheduled |
| `updateAssignment` | `PATCH /api/calendar/schedule/:id` | Optimistic cache merge only (no invalidation on success) |
| `updateDuration` | `PATCH /api/calendar/schedule/:id` | `invalidateCalendarOnly()` (calendar\* except unscheduled) |
| `deleteAssignment` | `POST /api/calendar/unschedule/:id` | Optimistic cache merge + `invalidateNarrow(true)` → calendar/unscheduled |
| `assignTechnicians` | `PATCH /api/calendar/schedule/:id` | `invalidateCalendarOnly()` (calendar\* except unscheduled) |
| `clearSchedule` | `POST /api/calendar/unschedule/:id` (batch) | `invalidateCalendarAndUnscheduled()` → calendar\*, calendar/unscheduled, clients |
| `clearDay` | `POST /api/calendar/unschedule/:id` (batch) | `invalidateCalendarAndUnscheduled()` → calendar\*, calendar/unscheduled, clients |
| `toggleComplete` | `PATCH /api/calendar/schedule/:id` | `invalidateCalendarOnly()`, maintenance/recently-completed, maintenance/statuses |

### Calendar Page — `pages/Calendar.tsx`

| Mutation / Callback | API | Invalidates |
|---|---|---|
| `deleteOldAssignment` | `DELETE /api/jobs/:id` | calendar/old-unscheduled, calendar/unscheduled, jobs, `["dashboard"]` (family), **maintenance**, **clients** |
| `archiveOldAssignment` | `POST /api/jobs/:id/complete` | calendar/old-unscheduled, calendar/unscheduled, jobs |
| `requireJobVersion` (stale guard) | — | calendar/unscheduled, `invalidateCalendarQueries()` |
| `requireAssignmentVersion` (stale guard) | — | `invalidateCalendarQueries()` |
| `onSaved` (NewAddClientDialog) | — | clients, calendar, calendar/unscheduled |
| `onSuccess` (ScheduleJobModal) | — | refetchCalendar(), jobs |

### Schedule Job Modal — `components/calendar/ScheduleJobModal.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `scheduleMutation` | via `applyJobSchedule` → `lib/jobScheduling.ts` | calendar, calendar/range, calendar/unscheduled, jobs, jobs/:jobId (via `invalidateScheduleQueries`) |

### Job Detail Page — `pages/JobDetailPage.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `updateStatusMutation` (visit) | `POST /api/jobs/:jobId/visits/:visitId/status` | jobs/:jobId/visits, jobs/:jobId |
| `deleteMutation` (visit) | `DELETE /api/jobs/:jobId/visits/:visitId` | jobs/:jobId/visits, jobs/:jobId, calendar |
| `updateStatusMutation` (job) | `POST /api/jobs/:jobId/status` | jobs/:jobId, jobs, jobs/:jobId/time-summary, **calendar**, **calendar/range**, **calendar/unscheduled**, `["dashboard"]` (family) |
| `clearHoldMutation` | `POST /api/jobs/:jobId/status` | jobs/:jobId, jobs |
| `deleteJobMutation` | `DELETE /api/jobs/:jobId` | jobs, calendar, maintenance, `["dashboard"]` (family), recurring-templates, clients |
| `createInvoiceMutation` | `POST /api/invoices/from-job/:jobId` | `["invoices"]` (family), jobs/:jobId |

> **TODO:** `clearHoldMutation` is missing dashboard invalidation. Clearing a hold changes on_hold count.

### Job Header Card — `components/JobHeaderCard.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `createInvoiceMutation` | `POST /api/invoices/from-job/:jobId` | `["invoices"]` (family), jobs/:jobId |
| `undoCloseMutation` | `POST /api/jobs/:jobId/undo-close` | jobs/:jobId, jobs |
| `closeJobMutation` | `POST /api/jobs/:jobId/close` | jobs/:jobId, jobs, jobs/:jobId/visits, (if invoice created: `["invoices"]` family) |
| `reopenJobMutation` | `POST /api/jobs/:jobId/reopen` | jobs/:jobId, jobs, **calendar**, **calendar/range**, **calendar/unscheduled**, `["dashboard"]` (family) |

> **TODO:** `undoCloseMutation` is missing dashboard invalidation. Undoing a close moves job back to a different status bucket.
> **TODO:** `closeJobMutation` is missing dashboard invalidation. Closing a job removes it from active/on-hold counts.

### Jobs List Page — `pages/Jobs.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `escalateMutation` | `POST /api/jobs/:jobId/escalate` | jobs, jobs/:jobId |
| `updateActionRequiredMutation` | `PATCH /api/jobs/:jobId` | jobs, jobs/:jobId |

### Quick Add Job Dialog — `components/QuickAddJobDialog.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `createJobMutation` | `POST /api/jobs` | jobs, calendar (exact: false) |
| `updateJobMutation` | `PATCH /api/jobs/:id` | jobs, jobs/:id, calendar (exact: false) |
| `quickCreateClientMutation` | `POST /api/clients` | clients |

### Action Required Modal — `components/ActionRequiredModal.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `updateStatusMutation` | `POST /api/jobs/:jobId/status` | jobs/:jobId, jobs |

> **TODO:** Missing dashboard invalidation. Action-required changes affect dashboard on_hold and needs-attention counts.

### Add Visit Dialog — `components/AddVisitDialog.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `createMutation` | `POST /api/calendar/schedule` | Uses `onSuccess` callback from parent (varies) |

### Invoice Detail Page — `pages/InvoiceDetailPage.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `sendMutation` | `POST /api/invoices/:id/send` | invoice/:id, `["invoices"]` (family) |
| `voidMutation` | `POST /api/invoices/:id/void` | invoice/:id, `["invoices"]` (family) |
| `refreshFromJobMutation` | `POST /api/invoices/:id/refresh-from-job` | invoice/:id |
| `createPaymentMutation` | `POST /api/invoices/:id/payments` | invoice/:id, `["invoices"]` (family) |
| `reorderLinesMutation` | `PATCH /api/invoices/:id/lines/reorder` | invoice/:id |
| `updateDiscountMutation` | `PATCH /api/invoices/:id/discount` | invoice/:id, `["invoices"]` (family) |
| `updatePaymentTermsMutation` | `PATCH /api/invoices/:id/payment-terms` | invoice/:id |

### Tech Visit Detail Page — `pages/TechVisitDetailPage.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `enRouteMutation` | `POST /api/tech/visits/:id/en-route` | (all via shared `invalidate()` helper) |
| `startMutation` | `POST /api/tech/visits/:id/start` | (all via shared `invalidate()` helper) |
| `completeMutation` | `POST /api/tech/visits/:id/complete` | (all via shared `invalidate()` helper) |
| `addNoteMutation` | `POST /api/tech/visits/:id/notes` | (all via shared `invalidate()` helper) |

**Shared `invalidate()` helper invalidates:**
`/api/tech/visits/:visitId`, `["visits"]` (family), `/api/calendar`, `/api/calendar/range`, `["jobs"]` (family), `["dashboard"]` (family)

### Location Detail Page — `pages/LocationDetailPage.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `setPrimaryMutation` | `PATCH /api/clients/:id` | clients/:locationId, clients/:id/overview, customer-companies/:id/overview, customer-companies/:id/locations |
| `deleteLocationMutation` | `DELETE /api/clients/:id` | clients |
| `createEquipmentMutation` | `POST /api/clients/:id/equipment` | clients/:locationId/equipment |
| `deleteEquipmentMutation` | `DELETE /api/clients/:id/equipment/:eqId` | clients/:locationId/equipment |

### Client Detail Page — `pages/ClientDetailPage.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `createLocationMutation` | `POST /api/clients` | clients/:clientId/overview, customer-companies/:id/locations, customer-companies/:id/overview, clients |
| `linkLocationMutation` | `POST /api/customer-companies/:id/link-location` | clients/:clientId/overview, customer-companies/:id/locations, customer-companies/:id/overview, customer-companies/:id/unlinked-suggestions, clients, admin/orphan-locations |
| `createContactMutation` | `POST /api/contacts` | contacts query key, clients/:locId/contacts (for each location) |
| `updateContactMutation` | `PATCH /api/contacts/:id` | contacts query key |
| `deleteContactMutation` | `DELETE /api/contacts/:id` | contacts query key |

### PM Schedule Card — `components/PMScheduleCard.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `toggleActiveMutation` | `PATCH /api/recurring-templates/:id` | recurring-templates |
| `archiveMutation` | `DELETE /api/recurring-templates/:id` | recurring-templates, recurring-templates/:id/instances/current-month |
| `hardDeleteMutation` | `DELETE /api/recurring-templates/:id?hard=true` | recurring-templates, recurring-templates/:id/instances/current-month |
| `generateMutation` | `POST /api/recurring-templates/:id/generate` | recurring-templates, jobs, recurring-templates/:id/instances/current-month |

### PM Setup Modal — `components/PMSetupModal.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `saveMutation` | `POST /api/recurring-templates` or `PATCH /api/recurring-templates/:id` | recurring-templates, (on create: jobs, recurring-templates/:id/instances/current-month) |

### Location PM Section — `components/LocationPMSection.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `savePlanMutation` | `POST /api/locations/:id/pm-plan` | locations/:id/pm-plan |
| `addPartMutation` | `POST /api/locations/:id/pm-parts` | locations/:id/pm-parts |
| `updatePartMutation` | `PATCH /api/locations/:id/pm-parts/:partId` | locations/:id/pm-parts |
| `deletePartMutation` | `DELETE /api/locations/:id/pm-parts/:partId` | locations/:id/pm-parts |
| `generateJobMutation` | `POST /api/locations/:id/generate-pm-job` | jobs |

### Admin Timesheets — `pages/AdminTimesheetsPage.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `editMutation` | `PATCH /api/admin/timesheets/:id` | (all via shared invalidation) |
| `deleteMutation` | `DELETE /api/admin/timesheets/:id` | (all via shared invalidation) |
| `addMutation` | `POST /api/admin/timesheets` | (all via shared invalidation) |

**Shared invalidation:** `/api/admin/timesheets/day`, `/api/admin/timesheets/week`

### Job Detail Dialog — `components/JobDetailDialog.tsx`

Uses `useMutationWithToast` (group-based invalidation):

| Mutation | API | Invalidation Groups |
|---|---|---|
| `deleteJobMutation` | `DELETE /api/jobs/:id` | `calendar`, `jobs`, `dashboard` |
| `createNoteMutation` | `POST /api/jobs/:id/notes` | keys: `["/api/jobs", jobId, "notes"]` |
| `updateNoteMutation` | `PATCH /api/jobs/:id/notes/:noteId` | keys: `["/api/jobs", jobId, "notes"]` |
| `deleteNoteMutation` | `DELETE /api/jobs/:id/notes/:noteId` | keys: `["/api/jobs", jobId, "notes"]` |
| `assignTechnicianMutation` | `PATCH /api/calendar/schedule/:jobId` | `calendar`, `jobs` |

### Notes Panel — `components/NotesPanel.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `createMutation` | `POST /api/jobs/:id/notes` | Dynamic query key (passed as prop) |
| `updateMutation` | `PATCH /api/jobs/:id/notes/:noteId` | Dynamic query key (passed as prop) |
| `deleteMutation` | `DELETE /api/jobs/:id/notes/:noteId` | Dynamic query key (passed as prop) |
| `deleteAttachmentMutation` | `DELETE /api/...` | Dynamic query key (passed as prop) |

### Equipment Components

**`components/EquipmentList.tsx`:**

| Mutation | API | Invalidates |
|---|---|---|
| `createMutation` | `POST /api/equipment` | Via dynamic queryKey prop |
| `updateMutation` | `PATCH /api/equipment/:id` | Via dynamic queryKey prop |
| `deleteMutation` | `DELETE /api/equipment/:id` | Via `useMutationWithToast` groups |

**`components/LocationEquipmentSection.tsx`:**

| Mutation | API | Invalidates |
|---|---|---|
| `createMutation` | `POST /api/clients/:id/equipment` | clients/:id/equipment |
| `updateMutation` | `PATCH /api/clients/:id/equipment/:eqId` | clients/:id/equipment |
| `deleteMutation` | `DELETE /api/clients/:id/equipment/:eqId` | clients/:id/equipment |

**`components/JobEquipmentSection.tsx`:**

| Mutation | API | Invalidates |
|---|---|---|
| `addMutation` | `POST /api/jobs/:id/equipment` | jobs/:jobId/equipment, jobs/:jobId |
| `removeMutation` | `DELETE /api/jobs/:id/equipment/:eqId` | jobs/:jobId/equipment, jobs/:jobId |

### Auth — `lib/auth.tsx`

| Mutation | API | Invalidates |
|---|---|---|
| `loginMutation` | `POST /api/auth/login` | Refetches `/api/auth/me` |
| `signupMutation` | `POST /api/auth/signup` | Refetches `/api/auth/me` |
| `logoutMutation` | `POST /api/auth/logout` | Clears all queries |

---

## Known Gaps (TODO)

These are invalidation gaps discovered during audit that were NOT fixed in Phase 2.
They should be addressed in a future patch.

| Location | Mutation | Missing Invalidation | Impact |
|---|---|---|---|
| `JobDetailPage.tsx` | `clearHoldMutation` | `["dashboard"]` | Dashboard on_hold count stale after clearing hold |
| `JobHeaderCard.tsx` | `undoCloseMutation` | `["dashboard"]` | Dashboard counts stale after undo-close |
| `JobHeaderCard.tsx` | `closeJobMutation` | `["dashboard"]` | Dashboard counts stale after closing job |
| `ActionRequiredModal.tsx` | `updateStatusMutation` | `["dashboard"]` | Dashboard needs-attention stale after action-required update |
| `Calendar.tsx` | `archiveOldAssignment` | `["dashboard"]` | Dashboard counts stale after archiving old job |
| `useCalendarDnD.ts` | `createAssignment` | `["jobs"]` (via narrow invalidation only) | Job list may show stale schedule data after DnD schedule |
| `useCalendarDnD.ts` | `deleteAssignment` | `["jobs"]`, `["dashboard"]` | Job list and dashboard stale after DnD unschedule |

---

## Cross-Reference: Entity → Affected Families

When a mutation modifies an entity, which query families should be invalidated?

| Entity Modified | Minimum Invalidation | Extended (recommended) |
|---|---|---|
| **Job status** | `["jobs"]`, jobs/:id | + calendar, `["dashboard"]` |
| **Job schedule** | `["jobs"]`, calendar, calendar/range | + calendar/unscheduled (if toggling scheduled↔backlog) |
| **Job delete** | `["jobs"]`, calendar, `["dashboard"]` | + maintenance, clients, recurring-templates |
| **Visit status** | `["visits"]`, jobs/:id | + tech/visits, calendar, `["dashboard"]` |
| **Invoice create** | `["invoices"]` (family), jobs/:id | — (family covers all sub-keys) |
| **Invoice status change** | invoice/:id, `["invoices"]` (family) | — (family covers all sub-keys) |
| **Payment recorded** | invoice/:id, `["invoices"]` (family) | — (family covers all sub-keys) |
| **Client/Location update** | clients/:id | + customer-companies/:id/overview |
| **PM template change** | recurring-templates | + recurring-templates/:id/instances/current-month |
| **Equipment change** | clients/:id/equipment | — |
| **Time entry change** | admin/timesheets/day, admin/timesheets/week | + jobs/:id/time-summary |
