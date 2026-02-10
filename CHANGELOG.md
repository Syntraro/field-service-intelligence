# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

#### PM Schedule UI on Location Detail Page (2026-02-10)

- **PMScheduleCard** (`client/src/components/PMScheduleCard.tsx`): New collapsible card component for the Location Detail right column. Fetches recurring templates via `GET /api/recurring-templates` and identifies the PM template for the current location (jobType=maintenance with monthsOfYear configured, fallback to title prefix "PM"). Displays summary (months, generation timing, scheduling mode, parts) with Edit, Pause/Resume, Preview, Generate, and Delete actions.
- **PMSetupModal** (`client/src/components/PMSetupModal.tsx`): 2-step modal for creating/editing PM schedules. Step 1: month picker with presets (Quarterly, Bi-Annual, Annual, Monthly), generation mode (start of month / day of month), auto-schedule toggle with time/duration, and PM parts inclusion. Step 2: review summary before save. Validates required fields (>=1 month, valid day 1-31, valid HH:MM).
- **LocationDetailPage integration**: Replaced placeholder PM card with `PMScheduleCard` wired to existing recurring template API. Removed unused Select component imports.
- **Current-month-only generation**: "Generate This Month" button computes `windowDays` from today to end of current month (+2 buffer, max 35) so only the current month's PM job is created. Button only shown when schedule is active and current month is in `monthsOfYear`. After create/save in PMSetupModal, auto-generates current month if applicable. Idempotent — duplicate clicks are safe (no-op from backend).
- **No backend changes.** Uses existing `POST/PATCH/DELETE /api/recurring-templates`, `POST /api/recurring-templates/:id/generate`, and `GET /api/recurring-templates/:id/instances` endpoints.
- **Files added**: `client/src/components/PMScheduleCard.tsx`, `client/src/components/PMSetupModal.tsx`
- **Files changed**: `client/src/pages/LocationDetailPage.tsx`

### Fixed

#### Test: Fix stale "assigned" status assertion in recurring-jobs test (2026-02-10)

- **Stale assertion**: Test 4 in `tests/recurring-jobs.test.ts` expected `status === "assigned"` for jobs generated from a template with `preferredTechnicianId`. Per Phase 2 Step 6, the generator always sets `status: "open"` — "assigned" is a derived state, not persisted. Changed assertion to `"open"`.
- **Audit**: Confirmed no code path in `server/domain/recurrence.ts` or `server/storage/jobs.ts` ever sets `status: "assigned"` during generation.
- **Files changed**: `tests/recurring-jobs.test.ts`

#### Backend: PM "Generate This Month" returns 0 after 1st of month (2026-02-10)

- **Root cause**: `generateForSingleTemplate` and `generateInstances` set `windowStart = today` (local midnight). For PM templates with `generationMode="period_start"`, the occurrence date is the 1st of the month. After the 1st, `occDate < windowStart` caused the occurrence to be silently filtered out by `computePmOccurrences`, resulting in 0 instances and 0 jobs. Same issue for `day_of_month` mode when `generationDayOfMonth < today`.
- **Fix**: Added `isPmTemplate()` helper and `pmWindowStart()` in `server/domain/recurrence.ts`. For PM templates (jobType=maintenance + monthsOfYear configured + locationId set, or legacy title prefix "PM"), `windowStart` is overridden to the 1st of the current month. Non-PM templates are unaffected. Applied in `generateForSingleTemplate`, `generateInstances`, and `previewGeneration`.
- **Timezone hardening**: Replaced raw `new Date(); setHours(0,0,0,0)` (server time) with `getCompanyToday(companyId)` — uses `Intl.DateTimeFormat` with the company's configured IANA timezone to determine the current calendar date, returned as a local-time `Date` (same basis as `parseLocalDate`). Prevents month-boundary bugs when UTC server clock is ahead of the company timezone (e.g., UTC 03:30 Feb 1 = Toronto 22:30 Jan 31). Applied consistently in `generateForSingleTemplate`, `generateInstances`, and `previewGeneration`.
- **Tests**: `tests/pm-window-start.test.ts` — 12 unit tests: period_start bug repro/fix, day_of_month bug repro/fix, non-PM unaffected, idempotency, no future-month flooding, plus 5 timezone boundary tests (Toronto Jan 31 vs UTC Feb 1, Toronto Feb 1, LA Feb 28 vs UTC Mar 1, pmWindowStart month-start at boundary).
- **Files changed**: `server/domain/recurrence.ts`
- **Files added**: `tests/pm-window-start.test.ts`

#### PM Card: PM-only filtering, improved 0-jobs diagnostics, UX tweaks (2026-02-10)

- **`isPmTemplate` helper**: Extracted shared predicate for PM template identification — `jobType=maintenance` + locationId match + monthsOfYear configured, with legacy fallback (title prefix "PM" + months). Used by `findPMTemplate` and cross-template discovery to prevent non-PM templates from leaking into search results.
- **Cross-template search restricted to PM templates**: The 0-jobs-created discovery loop now only iterates templates where `isPmTemplate(t, locationId)` is true AND `monthsOfYear` includes the current month. Prevents false matches against repair/install templates for the same location.
- **Improved "nothing generated" diagnostics**: When generate returns 0 jobs and no existing PM job is found via cross-template search, shows descriptive toast ("Nothing generated for Feb. No existing PM job found. Verify generation mode and day-of-month settings.") instead of misleading "already exists." DEV-only `console.warn` logs templateId, locationId, date range, windowDays, raw generate response, and list of PM templates searched — aids debugging whether the issue is out-of-window, idempotency, or misconfigured day-of-month.
- **Remove confirmation copy updated**: Archive dialog now explicitly states "Any PM jobs already generated will remain and must be removed manually if you don't want them." Toast updated to match.
- **Contacts card collapsed by default**: On LocationDetailPage, `contactsOpen` initial state changed from `true` to `false` — all right-column cards now start collapsed.
- **Files changed**: `client/src/components/PMScheduleCard.tsx`, `client/src/pages/LocationDetailPage.tsx`

#### PM Card: Tiered delete UX, Generate surfaces existing job (2026-02-10)

- **Tiered delete UX**: Default "Remove" button uses soft delete (`DELETE /api/recurring-templates/:id`, sets `isActive=false`). Schedule disappears from PM card (via `isActive` filter in `findPMTemplate`) but remains restorable from recurring templates admin. "Delete permanently..." link shown only for owner/admin roles — requires typing "DELETE" to confirm, calls `?hard=true`. Cascade verified safe: hard delete removes template + instances only; `jobs.recurrenceTemplateId` is a plain varchar (no FK), so jobs/job_parts/invoices are untouched.
- **Generate shows existing job (cross-template discovery)**: When "Generate This Month" returns 0 jobs created, searches PM templates for this location (including archived/soft-deleted) to find the existing PM job. Fixes bug where archive→recreate flow showed "No PM job needed" because the new template had no instances — the job was linked to the old archived template. Discovered job is stored in state so the "This month" row displays it as a fallback.
- **"This month" row always refreshed**: Instances cache invalidation moved to top of generate `onSuccess` so the row refreshes regardless of whether jobs were created or found cross-template.
- **"This month" row**: New inline row in the PM card showing current month's generated job status with a clickable link navigating to the job detail page. Shows "Not generated" if no job exists yet.
- **Preview job links**: Preview dialog now shows clickable job number links for instances that have generated jobs.
- **Instance type fix**: Fixed client-side instance type to match backend `InstanceWithJob` shape (`instanceDate`, nested `job` object) instead of incorrect flat fields.
- **Files changed**: `client/src/components/PMScheduleCard.tsx`, `CHANGELOG.md`

#### TeamMember type cascade — id: number → string (2026-02-10)

- **Root cause**: `TeamMember` interface in `useTechnicians.ts` declared `id: number`, but the API (`GET /api/team/technicians`) returns string UUIDs. This caused 17 TS errors across 10 files wherever `TeamMember.id` was used as a `SelectItem` value, Map key, or mutation argument.
- **Fix**: Changed `id: number` to `id: string`; made `firstName`, `lastName`, `status` optional (not guaranteed by API); added optional `roleId`, `isSchedulable`, `createdAt` fields used by consuming pages.
- **AddTimeEntryModal**: Changed `getTechName` param from `UserType` (full User schema) to `TeamMember` — the modal only needs the narrow hook type, not the full DB row.
- **TechnicianManagementPage**: Guarded `tech.createdAt` with optional fallback (API may not return it); removed unused local `Technician` interface that shadowed the hook type.
- **Files changed**: `client/src/hooks/useTechnicians.ts`, `client/src/components/time/AddTimeEntryModal.tsx`, `client/src/pages/TechnicianManagementPage.tsx`
- **No backend changes.** No runtime behavior changes — only TypeScript type corrections.

### Added

#### PM Scheduling Extension for Recurring Job Templates (2026-02-10)

- **Schema**: 6 new columns on `recurring_job_templates`: `months_of_year` (INT[]), `generation_mode` (TEXT, default 'phase'), `generation_day_of_month` (INT), `auto_schedule` (BOOL, default false), `scheduled_time_local` (TEXT), `include_location_pm_parts` (BOOL, default false). All backward-compatible with defaults.
- **Migration**: `migrations/2026_02_10_pm_scheduling_columns.sql` — additive ALTER TABLE with IF NOT EXISTS.
- **Zod schemas**: Both `insertRecurringJobTemplateSchema` and `updateRecurringJobTemplateSchema` accept new PM fields with validation (month 1-12, HH:MM format, cross-field rules).
- **Generation mode enum**: `generationModeEnum = ["phase", "period_start", "day_of_month"]` exported from `shared/schema.ts`.
- **PM occurrence computation**: New `computePmOccurrences()` in `server/domain/recurrence.ts` — month-by-month iteration with month-of-year filtering and day clamping.
- **Month filter for phase mode**: `filterByMonthsOfYear()` applies month restriction even to existing weekly/monthly phase patterns.
- **Auto-scheduling**: When `autoSchedule=true`, generated jobs get `scheduledStart`/`scheduledEnd` computed from `scheduledTimeLocal` + `defaultDurationMinutes` (fallback 60 min).
- **PM parts copy service**: New `server/services/pmJobParts.ts` — `copyLocationPMPartsToJob(companyId, locationId, jobId, tx?)` snapshots location PM part templates into `job_parts` with idempotency guard (skips if job already has parts). Accepts optional Drizzle transaction; wraps in its own transaction when called standalone. Uses efficient bulk INSERT (not N × createJobPart) since the target job is freshly generated and cannot be invoiced.
- **pmParts join extended**: `getLocationPMParts()` now includes `itemUnitPrice` from the `items` table JOIN.
- **Route validation**: POST/PATCH `/api/recurring-templates` validate cross-field constraints (generationDayOfMonth required for day_of_month mode, scheduledTimeLocal required when autoSchedule=true, monthsOfYear deduped).
- **Storage layer**: `createTemplate()` passes through all 6 new fields.
- **Day-of-month clamping**: `generationDayOfMonth=31` in February deterministically clamps to last day (28 or 29), no rollover.
- **Month restriction in phase mode**: Weekly/monthly templates with `monthsOfYear` set will only generate occurrences in those months.
- **Files changed**: `shared/schema.ts`, `server/domain/recurrence.ts`, `server/storage/recurringJobs.ts`, `server/storage/pmParts.ts`, `server/routes/recurringJobs.ts`, `server/services/pmJobParts.ts` (new), `migrations/2026_02_10_pm_scheduling_columns.sql` (new)

### Fixed

#### Tag delete error toast and stale UI (2026-02-10)

- **Root cause**: `apiRequest` in `client/src/lib/queryClient.ts` unconditionally called `response.json()` on success — 204 No Content responses (from DELETE endpoints) have no body, causing "Unexpected end of JSON input" error.
- **Fix (global)**: `apiRequest` now returns `undefined` for 204 / empty-body responses instead of attempting JSON parse. Prevents the same bug on any future DELETE endpoint.
- **Fix (optimistic UI)**: Tag delete mutation now uses `queryClient.setQueryData` to immediately remove the deleted tag from cache — item disappears instantly without waiting for refetch. Also clears inline-edit state if the deleted tag was being edited.
- **Files changed**: `client/src/lib/queryClient.ts`, `client/src/pages/TagsSettingsPage.tsx`

### Added

#### Manage Tags Settings Page (2026-02-10)

- **New page**: `client/src/pages/TagsSettingsPage.tsx` — admin page at `/settings/tags` for full tag CRUD (create, inline edit, delete with confirmation).
- **Features**: Tag name + 9-color picker for create/edit, live preview pill, inline editing with save/cancel, delete confirmation dialog with cascade warning, duplicate name validation, sorted alphabetically.
- **Settings card**: Added "Tags" card to `SettingsPage.tsx` (first position in grid) with Tag icon and description.
- **Route**: `/settings/tags` registered in App.tsx with `requireAdmin` protection.
- **Files changed**: `client/src/pages/TagsSettingsPage.tsx` (new), `client/src/pages/SettingsPage.tsx`, `client/src/App.tsx`, `CHANGELOG.md`

#### Tag Filtering for All Locations Page (2026-02-10)

- **Tag filter chips**: Added to `client/src/pages/Locations.tsx` — same UX pattern as Clients page. Clickable colored chips toggle tag filter on/off. Active chips show with full color + ring, inactive at 33% opacity.
- **AND logic**: Location must have ALL selected tags to be visible. Uses client-side filtering against the already-loaded `GET /api/tags/location-assignments` data — no new backend calls.
- **Performance**: `locationTagMap` (locationId → Set\<tagId\>) and `filteredLocations` computed via `useMemo`. Filtering, sorting, and selection all derive from the same memo chain.
- **Bulk edit compatibility**: "Select all" operates on filtered results. Bulk tag editing works correctly on the filtered subset.
- **Clear button**: Resets tag filter and shows all locations.
- **Files changed**: `client/src/pages/Locations.tsx`

#### Phase 2B: Bulk Tag Edit for Locations (2026-02-10)

- **Backend**: New `bulkUpdateLocationTags` method in `server/storage/clientTags.ts` — transactional, set-based inserts/deletes across multiple locations. Validates all location IDs and tag IDs belong to tenant.
- **API endpoint**: `POST /api/locations/bulk-tags` — accepts `{ locationIds, addTagIds, removeTagIds }`. Validates no overlap between add/remove lists. Registered before `/:id` param routes to avoid capture. Returns `{ updatedCount }`.
- **API endpoint**: `GET /api/tags/location-assignments` — returns all location tag assignments for the tenant (for list view tag pills).
- **BulkEditTagsModal generalized**: Added `entityType` prop (`"customerCompany"` | `"location"`) with config-driven endpoint, request body ID field, cache invalidation key, and display labels. Default `"customerCompany"` preserves backwards compatibility with Clients.tsx.
- **Locations.tsx page**: New `client/src/pages/Locations.tsx` — flat list of all service locations with location-level tag pills, checkbox selection, bulk action bar, and BulkEditTagsModal in location mode.
- **Route**: `/all-locations` registered in App.tsx before `/locations/:locationId`. "All Locations" button added to Clients page header for navigation.
- **Files changed**: `server/storage/clientTags.ts`, `server/routes/tags.ts`, `client/src/components/BulkEditTagsModal.tsx`, `client/src/pages/Locations.tsx` (new), `client/src/pages/Clients.tsx`, `client/src/App.tsx`, `CHANGELOG.md`

#### Phase 2A: Bulk Tag Edit for Clients (2026-02-10)

- **Backend**: New `bulkUpdateCustomerCompanyTags` method in `server/storage/clientTags.ts` — transactional, set-based inserts/deletes across multiple customer companies. Validates all IDs belong to tenant before proceeding.
- **API endpoint**: `POST /api/customer-companies/bulk-tags` — accepts `{ customerCompanyIds, addTagIds, removeTagIds }`. Validates no overlap between add/remove lists. Returns `{ updatedCount }`.
- **Clients.tsx row selection**: Checkbox column with header "select all visible" toggle. Selection count badge. Bulk action bar with "Bulk Edit Tags" and "Clear selection" buttons.
- **BulkEditTagsModal**: New `client/src/components/BulkEditTagsModal.tsx` — two-step modal:
  - Step 1 (Edit): Add/Remove tag pickers with search, inline tag creation (with color picker), overlap prevention between add/remove lists.
  - Step 2 (Review): Summary of changes (N clients, +X tags, -Y tags), preview of first 10 client names, Confirm & Apply / Back buttons.
- **Apply behavior**: On confirm, calls bulk endpoint, invalidates tag assignments cache, shows success toast, clears selection.
- **Files changed**: `server/storage/clientTags.ts`, `server/routes/tags.ts`, `client/src/pages/Clients.tsx`, `client/src/components/BulkEditTagsModal.tsx`, `CHANGELOG.md`

#### Phase 1B: Location Tags (2026-02-09)

- **Database schema**: New `location_tag_assignments` junction table (id, companyId, tagId, locationId, createdAt) with unique index on (companyId, locationId, tagId). Reuses existing `client_tags` table for tag definitions.
- **Migration**: `migrations/2026_02_09_location_tag_assignments.sql` — creates table with indexes for fast lookup by tenant+location and tenant+tag.
- **Storage layer**: Extended `ClientTagRepository` in `server/storage/clientTags.ts` with 3 new methods: `getTagsForLocation`, `updateLocationTags` (transactional bulk add/remove with tenant + location ownership validation), `getLocationTagAssignmentsByCompany` (for future list views).
- **API routes**: New `locationTagRouter` in `server/routes/tags.ts` — `GET /api/locations/:locationId/tags` (list tags for a location), `POST /api/locations/:locationId/tags` (add/remove tags with `{ addTagIds, removeTagIds }` payload).
- **EditTagsModal generalized**: Changed props from `customerCompanyId` to `entityType` + `entityId` to support both customer companies and locations. API URL and cache keys derived from entity type.
- **LocationDetailPage tag pills**: Colored tag pills in the header below status badges. Dashed "+ Add Tag" / "Edit" button opens EditTagsModal with `entityType="location"`.
- **No inheritance**: Location tags are fully independent from client tags — assigning a tag to a location does NOT affect client/company tag assignments.
- **Files changed**: `shared/schema.ts`, `server/storage/clientTags.ts`, `server/routes/tags.ts`, `server/routes/index.ts`, `client/src/components/EditTagsModal.tsx`, `client/src/pages/ClientDetailPage.tsx`, `client/src/pages/LocationDetailPage.tsx`, `CHANGELOG.md`
- **Migration file**: `migrations/2026_02_09_location_tag_assignments.sql`

#### Phase 1: Client Tags System (2026-02-09)

- **Database schema**: New `client_tags` table (id, companyId, name, color) with unique index on (companyId, name). New `client_tag_assignments` junction table (id, companyId, tagId, customerCompanyId) with unique index on (tagId, customerCompanyId).
- **Migration**: `migrations/2026_02_09_client_tags.sql` — creates both tables with indexes for fast lookup by tenant, customer company, and tag.
- **Storage layer**: New `server/storage/clientTags.ts` — `ClientTagRepository` with methods: `getTagsByCompany`, `createTag`, `updateTag`, `deleteTag`, `getTagsForCustomerCompany`, `updateCustomerCompanyTags` (transactional bulk add/remove with tenant validation), `getTagAssignmentsByCompany` (for list views).
- **API routes**: New `server/routes/tags.ts` — Tag CRUD (`GET/POST/PATCH/DELETE /api/tags`), bulk assignments endpoint (`GET /api/tags/assignments`), customer-company tag management (`GET/POST /api/customer-companies/:id/tags` with `{ addTagIds, removeTagIds }` payload). Duplicate name returns 409.
- **ClientDetailPage tag pills**: Colored tag pills in the header below the company subtitle. Dashed "+ Add Tag" / "Edit" button opens the EditTagsModal.
- **EditTagsModal**: New `client/src/components/EditTagsModal.tsx` — modal for managing tags on a customer company. Shows current tags as removable pills, search/filter existing tags, inline "Create" button with 9-color picker, keyboard Enter to create.
- **Clients list tag filter**: Tag filter chips above the client table in `Clients.tsx`. Click to toggle (AND filter — company must have ALL selected tags). "Clear" button resets. Tags column in the table shows assigned tag pills per company row. Uses `GET /api/tags/assignments` for efficient bulk loading.
- **Files changed**: `shared/schema.ts`, `server/storage/clientTags.ts` (new), `server/storage/index.ts`, `server/routes/tags.ts` (new), `server/routes/index.ts`, `client/src/components/EditTagsModal.tsx` (new), `client/src/pages/ClientDetailPage.tsx`, `client/src/pages/Clients.tsx`, `CHANGELOG.md`
- **Migration file**: `migrations/2026_02_09_client_tags.sql`

#### Location PM Parts: Row-Based Multi-Add Modal + Backend (2026-02-09)

- **Backend storage**: New `server/storage/pmParts.ts` — `PMPartRepository` with `getLocationPMParts` (LEFT JOIN to items for name/sku/category/cost) and `bulkUpsertPMParts` (transactional replace: soft-delete removed, upsert existing, insert new).
- **Backend routes**: New `server/routes/pm-parts.ts` — `GET /api/locations/:locationId/pm-parts` (list with item details) and `PUT /api/locations/:locationId/pm-parts` (bulk upsert with `{ parts: [{ productId, quantity }] }` payload). Registered at `/api/locations` in `routes/index.ts`.
- **Frontend modal rewrite**: `PartsSelectorModal.tsx` rewritten from two-panel picker to row-based multi-add UX. Each row has server-side search input (debounced 300ms, min 2 chars, calls `GET /api/items?q=TERM`), dropdown results, quantity input. "Add another part" button appends rows. Single "Save" submits all rows via bulk PUT. Duplicate detection with inline warning. Prefills existing parts on open.
- **Search fix**: Previous modal loaded full `/api/items` catalog and expected `{ items: Item[] }` but API returns raw array — search showed nothing. New modal uses per-row server-side search, correctly handling the API response shape.
- **LocationDetailPage**: Re-enabled PM parts query (`GET /api/locations/:id/pm-parts`, was `enabled: false`). Parts list now uses joined `itemName`/`itemSku` from the API response instead of a separate items query.
- **Files changed**: `server/storage/pmParts.ts` (new), `server/storage/index.ts`, `server/routes/pm-parts.ts` (new), `server/routes/index.ts`, `client/src/components/PartsSelectorModal.tsx`, `client/src/pages/LocationDetailPage.tsx`, `CHANGELOG.md`

#### ClientDetailPage: Notes Header "+ Add" Button (2026-02-09)

- **Notes header button**: Moved "+ Add Note" from NotesPanel body into the Notes card header on the Company/Client Detail page. Uses same `forwardRef`/`useImperativeHandle` pattern as LocationDetailPage — `notesPanelRef.current?.startAdding()` with `e.stopPropagation()` to avoid toggling the collapsible. Passes `hideAddButton` to suppress the internal button.
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`, `CHANGELOG.md`

#### LocationDetailPage: Parts Card Styling + Notes Header Button (2026-02-09)

- **Parts card no scrollbar**: Removed `max-h-48 overflow-y-auto` from Location Parts card content — card now expands vertically to fit all parts, page scrolls instead.
- **Parts list dividers**: Replaced boxed rows (`rounded-lg border p-2`) with `divide-y` separator pattern for tighter, cleaner layout.
- **Notes "+ Add" in header**: Moved "+ Add Note" button from NotesPanel body into Notes card header (same pattern as Parts card). Uses `forwardRef` + `useImperativeHandle` on NotesPanel to expose `startAdding()`. Header button uses `e.stopPropagation()` to avoid toggling the collapsible.
- **NotesPanel ref API**: Added `NotesPanelRef` type export with `startAdding()` method; added `hideAddButton` prop to suppress internal button when parent provides its own.
- **Files changed**: `client/src/pages/LocationDetailPage.tsx`, `client/src/components/NotesPanel.tsx`, `CHANGELOG.md`

#### PM Parts Fixes: Query, Search, Dropdown Clipping (2026-02-09)

- **Parts not showing after save (root cause)**: `LocationDetailPage.tsx` pm-parts `useQuery` had no `queryFn`. The default `getQueryFn` uses `queryKey[0]` as the URL, which was just `"/api/locations"` — never reached the actual endpoint. Added explicit `queryFn: () => apiRequest(\`/api/locations/${locationId}/pm-parts\`)`.
- **Case-insensitive search**: `server/storage/items.ts` — changed `like` to `ilike` (Postgres ILIKE) so `?q=Ther` and `?q=ther` return the same results.
- **Dropdown clipping fix**: `PartsSelectorModal.tsx` — replaced absolute-positioned dropdown (clipped by parent `overflow-y-auto`) with inline results panel that participates in the scroll flow. Results render inside each row card with `max-h-52 overflow-y-auto`.
- **Modal sizing**: Dialog `max-w-4xl w-[95vw] max-h-[85vh]`; scroll area has `min-h-0` for proper flex containment.
- **Files changed**: `client/src/pages/LocationDetailPage.tsx`, `server/storage/items.ts`, `client/src/components/PartsSelectorModal.tsx`, `CHANGELOG.md`

#### Note Attachments + Visibility Flags + Scoped Notes Routes (2026-02-08)

- **Schema**: `client_notes.locationId` now nullable (NULL = company-wide note). Added `showOnJobs`, `showOnInvoices`, `showOnQuotes` boolean visibility flags.
- **New tables**: `files` (tenant-scoped file metadata) and `note_attachments` (join table linking notes to files, cascade delete).
- **File upload route**: `POST /api/uploads` — multipart/form-data, multer disk storage to `uploads/<companyId>/<fileId>`, 10 MB / 10 files max. CSRF-protected.
- **Secure file streaming**: `GET /api/files/:fileId` — tenant-scoped, streams from disk with correct Content-Type/Content-Disposition. No public static serving.
- **Location notes routes**: `GET/POST/PATCH/DELETE /api/locations/:locationId/notes` — strict locationId scoping, enriched with attachments, visibility flags support.
- **Company notes routes**: `GET/POST/PATCH/DELETE /api/companies/:companyId/notes` — WHERE locationId IS NULL, tenant guard.
- **Note attachments routes**: `POST/DELETE /api/notes/:noteId/attachments` — attach/detach files by fileId.
- **Back-compat**: Legacy `/api/clients/:clientId/notes` routes preserved (TODO: remove after migration).
- **Frontend NotesPanel component**: Reusable `<NotesPanel scope="location"|"company" />` with multi-file picker, visibility checkboxes (Jobs/Invoices/Quotes), image thumbnails, file download links, inline edit with flag toggles.
- **LocationDetailPage**: Notes card now uses `<NotesPanel>`, removed inline note state/mutations.
- **apiRequest FormData fix**: Skip auto-setting `Content-Type: application/json` when body is `FormData` (for multipart uploads).
- **Storage repos**: `FilesRepository`, `NoteAttachmentRepository` extending BaseRepository; `ClientNotesRepository` expanded with `listLocationNotes`, `listCompanyNotes`, `createCompanyNote`, `updateCompanyNote`, `deleteCompanyNote`.
- **Migration**: `migrations/2026_02_08_note_attachments.sql`
- **Files changed**: `shared/schema.ts`, `server/storage/clientNotes.ts`, `server/storage/files.ts` (new), `server/storage/noteAttachments.ts` (new), `server/storage/index.ts`, `server/routes/uploads.ts` (new), `server/routes/files.ts` (new), `server/routes/location-notes.ts` (new), `server/routes/company-notes.ts` (new), `server/routes/note-attachments.ts` (new), `server/routes/client-notes.ts`, `server/routes/index.ts`, `client/src/components/NotesPanel.tsx` (new), `client/src/pages/LocationDetailPage.tsx`, `client/src/lib/queryClient.ts`, `.gitignore`, `CHANGELOG.md`

#### ClientDetailPage: Replace bespoke notes with reusable NotesPanel (2026-02-09)

- **Schema**: Added `customerCompanyId` column to `client_notes` (nullable FK to `customer_companies`, cascade delete) for customer-company-level notes.
- **Migration**: `migrations/2026_02_09_customer_company_notes.sql` — adds column + partial index.
- **Storage**: Added `listCustomerCompanyNotes`, `createCustomerCompanyNote`, `updateCustomerCompanyNote`, `deleteCustomerCompanyNote`, `findRecentDuplicateForCustomerCompany`, and `assertCustomerCompanyOwned` to `ClientNotesRepository`. All join `users` for `createdByName` and enforce tenant isolation.
- **New route**: `server/routes/customer-company-notes.ts` — `GET/POST/PATCH/DELETE /api/customer-companies/:customerCompanyId/notes`. Tenant guard via `assertCustomerCompanyOwned`, enriched with attachments + createdByName, dedupe on POST, cascade-delete attachments on DELETE.
- **Route registration**: Mounted on `/api/customer-companies` in `server/routes/index.ts`.
- **NotesPanel**: Company scope now hits `/api/customer-companies/:id/notes` (was `/api/companies/:id/notes`). Query key updated to match.
- **ClientDetailPage**: Removed bespoke notes UI (state, query, 3 mutations, AlertDialog, Textarea). Replaced with `<NotesPanel scope="company" companyId={companyId} />` inside collapsible card matching LocationDetailPage style. Notes now support multi-file attachments, visibility flags (Jobs/Invoices/Quotes), and "Added by {name} · {timestamp}" footer.
- **Files changed**: `shared/schema.ts`, `server/storage/clientNotes.ts`, `server/routes/customer-company-notes.ts` (new), `server/routes/index.ts`, `client/src/components/NotesPanel.tsx`, `client/src/pages/ClientDetailPage.tsx`, `CHANGELOG.md`

#### Notes: Show author name, remove duplicate heading (2026-02-09)

- **API**: `listLocationNotes` and `listCompanyNotes` now join `users` table to return `createdByName` on each note.
- **NotesPanel**: Removed duplicate inner "Notes" heading (card header already provides it). Note footer now reads "Added by {name} · {date/time}" instead of just the timestamp.
- **Files changed**: `server/storage/clientNotes.ts`, `client/src/components/NotesPanel.tsx`, `CHANGELOG.md`

### Changed

#### Location Detail Page — Contacts view-only, remove Billing Settings, reorder right column (2026-02-08)

- **Contacts card moved to top** of right column and expanded by default; shows only location-scoped contacts (no inherited company contacts).
- **View-only contacts** — removed all "Add Contact" actions from this page; empty state links to the client page for contact management.
- **Billing Settings card removed** — handled via Edit Location modal instead. Removed `billingOpen` state, `toggleBillWithParentMutation`, and `Switch` import.
- **Right column reordered**: Contacts → PM Schedule → Location Parts → Notes → Equipment.
- **Default collapse states**: `contactsOpen=true`, all others `false` (notes was previously `true`).
- **Dead code cleanup**: removed unused `Pencil` import.
- **Files changed**: `client/src/pages/LocationDetailPage.tsx`, `CHANGELOG.md`

### Fixed

#### Contact Edit — Transactional Association Replace (2026-02-08)

- **Root cause** — PATCH endpoint only updated a single `client_contacts` row. When a person had multiple location associations, the frontend sent parallel PATCHes but could not add new locations, remove unchecked locations, or switch between company-wide and location-specific modes.
- **Storage layer** — Added `replacePersonContacts()` to `ClientContactRepository` using `db.transaction()`. Atomically deletes all existing rows (by ID list, tenant-scoped) then inserts new rows for the desired association state.
- **PATCH route upgraded** — `PATCH /api/customer-companies/:companyId/contacts/:contactId` now accepts optional `association` + `existingContactIds` fields. When present, uses transactional replace instead of single-row update. Returns split `{ companyContacts, locationContacts }` matching GET format.
- **Frontend mutation rewritten** — `updateContactMutation` now sends a single PATCH with full association payload and all existing row IDs, instead of parallel per-row PATCHes. Awaits `refetchQueries` after success for immediate UI consistency.
- **Backward compat** — Simple single-row PATCH (without association field) still works for legacy callers.
- **Files changed**: `server/storage/clientContacts.ts`, `server/routes/customer-companies.ts`, `client/src/pages/ClientDetailPage.tsx`

### Changed

#### Phase 5: Per-Location Roles in Contact Modal (2026-02-07)

- **Per-association role toggles** — Replaced global `isBilling`/`isScheduling` checkboxes with per-association `RoleFlags` (`{ billing, scheduling }`). New `AssociationState` discriminated union: `{ type: "company"; companyRoles }` or `{ type: "locations"; locationRolesById }`. Each location in the modal now has its own Billing/Scheduling checkboxes.
- **Edit prefill from PersonGroup** — `openEditContact` now accepts a `PersonGroup` instead of a raw `ClientContact`, reconstructing `companyRoles` or `locationRolesById` from all existing associations.
- **Create payload: per-location roles** — `createContactMutation` sends `association.locations[]` with per-location `roles` arrays (e.g., one location gets `["billing"]`, another `["scheduling"]`).
- **Edit payload: parallel PATCH** — `updateContactMutation` in locations mode PATCHes each association row with its own roles via parallel API calls.
- **Backend: new Zod schema field** — `contactFieldsSchema.association.locations[]` accepts `{ locationId, roles }` entries. POST handler prefers `locations[]` (per-location roles) over `locationIds[]` (legacy uniform roles).
- **Backward compat** — Legacy `locationIds[]` + global `roles` still works for older clients.
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`, `server/routes/customer-companies.ts`

#### Contacts Card — Full Person-Level Dedup + Accordion Associations (2026-02-07)

- **Rewrote contact grouping** — New `peopleGroups` useMemo with `Assoc`/`PersonGroup` types. Grouping key uses prefixed namespace: `e:email` > `p:phone-digits` > `n:first|last` > `id:id`. `upsert` pattern merges base fields (phone/email/isPrimary) and accumulates per-association roles.
- **One row per person** — List maps exclusively over `peopleGroups`. All raw `companyContacts.map` / `locationContacts.reduce` patterns removed. Nadeem appears once, Jad appears once.
- **Collapsed row** — Name, Primary badge, Company badge (if company-wide), location summary badge ("Home" if 1 location, "Home +1" if 2+), phone/email inline. Clickable `<button>` toggles accordion.
- **Expanded associations** — Shows ALL associations: Company first, then locations alphabetically. Each row: fixed-width label + role badges (Billing, Scheduling). "No roles" fallback.
- **Sorted output** — Primary contacts first, then alphabetical by name. Associations sorted company-first then alpha.
- **Kebab menu (⋯)** — Edit/Delete using `primaryAssociationId` (prefers company-wide record). Menu is outside the `<button>`, no stopPropagation needed. Edit calls `openEditContact`, Delete triggers existing AlertDialog.
- **Dead code cleanup** — Removed unused `User` icon import.
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`

#### Contact Save — Route Verification, CSRF Validation, Query Invalidation (2026-02-07)

- **Verified POST route mounting** — `POST /api/customer-companies/:companyId/contacts` confirmed reachable (403 without CSRF token, 401 with token but no auth). Route was already registered in `server/routes/index.ts` at `/api/customer-companies`.
- **Verified CSRF flow** — `csurf` middleware applied globally to `/api` before route registration. Frontend `apiRequest` lazily fetches CSRF token via `getCSRFToken()`, sends `x-csrf-token` header, and auto-retries on CSRF errors (403 EBADCSRFTOKEN).
- **Fixed TS errors** — `association` and `locationIds` were possibly undefined after Zod `.default()`. Added explicit runtime fallbacks in POST handler.
- **Improved query invalidation** — After contact create/update/delete, now invalidates both company-level (`/api/customer-companies/:id/contacts`) AND all location-level (`/api/clients/:locId/contacts`) queries so LocationDetailPage reflects changes immediately.
- **Files changed**: `server/routes/customer-companies.ts`, `client/src/pages/ClientDetailPage.tsx`

#### Contact Management — Association Selector, Location Contacts, Unified Modal (2026-02-07)

- **Association selector on Add Contact modal** — Contacts can now be assigned to "Company (all locations)" or "Specific location(s)" with a multi-select checkbox list. POST endpoint creates one row per selected location when `association.type === "locations"`.
- **Unified Add/Edit Contact modal** — Replaced three separate dialogs (add, edit, delete) with a single configurable modal (`contactModalMode: "add" | "edit"`) plus a delete AlertDialog. Edit pre-fills all fields including association type.
- **Location Contacts section on ClientDetailPage** — Contacts linked to specific locations now appear grouped by location below Company Contacts, with edit/delete actions per contact.
- **LocationDetailPage contacts** — Added a "Contacts" collapsible card in the right column showing location-specific contacts and inherited company-level contacts (with "Inherited" label). Links to company page for adding new contacts.
- **Backend: association-aware POST** (server/routes/customer-companies.ts) — `POST /api/customer-companies/:id/contacts` now accepts `association: { type: "company" | "locations", locationIds: string[] }`. Creates multiple rows for multi-location assignment. PATCH supports `locationId` changes.
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`, `client/src/pages/LocationDetailPage.tsx`, `server/routes/customer-companies.ts`, `server/storage/clientContacts.ts`

#### ClientDetailPage — Fix Name Bug & Full Contact Management (2026-02-07)

- **Bug fix: Client name disappears after navigation** — `companyName` went blank when navigating to a location and returning because the overview query re-fetched and `parentCompany?.name` was temporarily `undefined` while `client.companyName` was empty (client fetched as CustomerCompany which uses `.name`). Fixed with a robust fallback chain: `parentCompany?.name || client.companyName || client.name || client.displayName || "Unnamed Client"`. Added `placeholderData: keepPreviousData` to the overview query to prevent flicker during navigation.
- **Company Contacts section with full CRUD** — Replaced the read-only contacts card with an interactive "Company Contacts" section directly on the detail page (not inside Edit Company modal). Shows each contact with name, role badges (billing/scheduling), phone, email. Hover reveals Edit/Delete actions. "Add Contact" button opens a dialog with first/last name, phone, email, billing/scheduling checkboxes. Validation: requires (first or last name) AND (phone or email).
- **New API endpoints** (server/routes/customer-companies.ts):
  - `POST /api/customer-companies/:id/contacts` — create a single contact with Zod validation
  - `PATCH /api/customer-companies/:id/contacts/:contactId` — update contact fields, validates merged state
  - `DELETE /api/customer-companies/:id/contacts/:contactId` — delete single contact
- **New storage methods** (server/storage/clientContacts.ts): `getContactById`, `createContact`, `updateContact`, `deleteContact` — all tenant-scoped
- **Cleanup**: Removed unused imports (Tabs, Building2, MapPin, Settings, useSearch, useEffect)
- **Files changed**: `client/src/pages/ClientDetailPage.tsx`, `server/routes/customer-companies.ts`, `server/storage/clientContacts.ts`

#### NewClientPage Jobber-Style Rewrite (2026-02-07)

- **Complete UI rewrite** to Jobber-like density with placeholder-based inputs (no stacked labels)
- **Layout**: 2-pane `grid-cols-[480px_1fr]`, max-w-[1600px], Cancel/Save in top-right header
- **Left card ("Client")**: First/Last name always visible, Company Name with dynamic placeholder (`*` when checkbox on, `optional` when off), "Saved as" preview in person mode, billing address, company contacts
- **Right card ("Locations")**: Segmented tab strip, "Location details" editor with 2-column grid, "Copy billing address" button replaces same-as-billing toggle, location contacts with Billing/Scheduling role toggles
- **Simplified data model**: `AddressForm` extracted as nested type, `LocationForm` flattened (phone/email at top level), roles reduced to `billing | scheduling` (primary contact handled separately via dedicated first/last fields)
- **Contact draft pattern**: `ContactEditor` component with Save/Cancel, save disabled until any field filled, no editing existing contacts (add-only + delete), separate `companyDraft`/`locDraft` state
- **Removed**: Maintenance schedule, same-as-billing Switch, Label components for most fields, DropdownMenu on locations (replaced with Remove button), inline contact editing
- **API shape preserved**: Payload still matches `/api/clients/full-create` with company, primaryLocation, additionalLocations, contacts arrays
- **Files changed**: `client/src/pages/NewClientPage.tsx`

#### NewClientPage UX Fixes — Contacts Draft, Segmented Tabs, Spacing (2026-02-07)

- **Contacts draft pattern**: "Add contact" now opens a draft editor that does NOT create an entry until Save. Save disabled until first/last name provided. Esc key or clicking away discards the draft. Applies to both company and location contacts. No more "Unnamed" contacts.
- **ContactInlineEditor**: Added `canSave`/`isDraft` props; shows "New contact" header + X (cancel) for drafts, "Edit contact" + Trash (delete) for existing. Save button disabled when `!canSave`.
- **ContactsSection**: Changed from `onAdd: () => void` to `onCommit: (contact) => void`. Draft state managed internally with blur/Esc discard. `useEffect` clears draft when `editingId` changes cross-section.
- **Location tabs**: Replaced pill-style selector with segmented tab strip (`rounded-lg border bg-muted/30 p-1`). Selected tab: `bg-background shadow-sm border`. Never shows "Unnamed" — falls back to "Location 1", "Location 2", etc.
- **Add location UX**: Auto-selects new tab, scrolls tab strip into view, focuses Location Name input via `requestAnimationFrame` + ref.
- **Spacing**: Grid `440px_1fr gap-8`, card content `space-y-6`, sections `space-y-3`, City/Province/Postal `grid-cols-[2fr_1fr_1fr] gap-4`
- **Company card person mode**: Checkbox correctly toggles Company Name vs First/Last fields; "Saved as" preview appears under name fields in both modes
- **Files changed**: `client/src/pages/NewClientPage.tsx`

#### NewClientPage Layout & Spacing Polish (2026-02-07)

- **Page width**: Increased max-width from 1200px to 1320px
- **Grid**: Changed to `lg:grid-cols-[420px_1fr]` (fixed left, fluid right)
- **Locations card**: Replaced vertical location list with horizontal scrollable "location pills" selector row (pill per location, primary dot indicator, selected pill highlighted)
- **Location editor**: Added "Location details" header with overflow menu (Set as primary / Delete); editor now uses 2-column grid — left: name, same-as-billing, address fields; right: phone/email, maintenance schedule, contacts
- **Removed** internal "Primary Location" heading from locations card
- **Company card**: Improved empty contacts state with bordered dashed placeholder box
- **Footer**: Full-width anchored bar with top border (`-mx-6 px-6 py-4 border-t`)
- **Files changed**: `client/src/pages/NewClientPage.tsx`

#### New Client Flow — Contacts, Name Source, Card-Based UI (2026-02-07)

**Data Model & API:**
- **Removed** "Legal Name" field from New Client form (UI + payload)
- **Added** `nameSource` column to `customer_companies` table (`'company'` or `'person'`) to preserve naming intent
- **Added** `client_contacts` table for multiple contacts per customer company or per location
  - `location_id` nullable: NULL = company-level contact, set = location-specific contact
  - Role flags stored as text array: `billing`, `scheduling`, `general`, `primary`
  - `is_primary` boolean flag
- **Added** `GET /api/clients/:clientId/contacts` endpoint
- **Added** `POST /api/clients/full-create` now accepts `contacts` array and persists via `clientContactRepository`
- **Added** `server/storage/clientContacts.ts` — new repository with `createContacts`, `getCompanyContacts`, `getLocationContacts`, `getAllContactsForCustomerCompany`, `deleteContactsByCustomerCompany`

**UI Redesign (NewClientPage.tsx):**
- **Redesigned** as two-column card layout: `grid gap-6 lg:grid-cols-[1fr_1.2fr]`
- **LEFT CARD ("Company")**: "Use company name as client name" checkbox (default on), conditional Company Name / First+Last fields, "Saved as" preview pill, phone/email, billing address, company-level contacts with compact display rows + inline editor
- **RIGHT CARD ("Locations")**: Clickable location list with Primary/Billing badges, contact counts, overflow menu (Set as primary / Delete) + location editor panel with name, same-as-billing address switch, phone/email, location contacts, PM schedule
- **Contact display**: `ContactDisplayRow` (compact read-only: name, muted email/phone, role Badge pills, edit/delete icons) ↔ `ContactInlineEditor` (edit mode with first/last, email/phone, role checkboxes, done/delete buttons)
- **Contacts reusable**: `ContactsSection` component manages display/edit toggle via single global `editingContactId`
- **Location primary swap**: `setAsPrimary(id)` demotes current primary to additional, promotes selected
- **Same-as-billing**: UI-only toggle on locations; address resolved from billing values at submit time
- **Save validation**: Save button disabled unless company/person name valid and at least one location exists
- **Form loads blank** — no placeholder/demo values
- **Files changed**: `client/src/pages/NewClientPage.tsx`, `server/routes/clients.ts`, `server/storage/clientContacts.ts` (new), `server/storage/customerCompanies.ts`, `server/storage/index.ts`, `shared/schema.ts`
- **Migration**: `migrations/2026_02_07_add_client_contacts_and_name_source.sql`

#### JobDetailPage Visit-Level Enhancements (2026-02-07)

- **Removed** `AssignTechnicianDialog` and "Assign Technician" button — technician assignment is visit-level only
- **Replaced** `<JobVisitsSection>` in middle column with compact inline visits list (single-line rows: date/time + tech + status pill)
- **Visits collapse**: Shows first 3 visits by default; "Show all visits (N)" toggle for >3; internal scroll only when expanded
- **Added** `VisitDetailDialog` — click any visit row to view full details (status, date, technician, duration, notes, check-in/out times)
- **Visit dialog actions**: Quick "Complete" button for scheduled visits, "More Actions" dropdown with Delete
- **Visit sort order**: Active visits first, then by date descending (newest first)
- **Right column**: Removed job-level "Scheduled" date with calendar popover; replaced with read-only "Created" (createdAt) and "Completed" (closedAt) dates
- **Removed**: `updateScheduleMutation`, `handleDateSelect`, `datePopoverOpen` state, `Popover`/`CalendarPicker` imports
- **Fixed** `SelectItem value=""` in `AddVisitDialog` — replaced with `"__unassigned__"` sentinel (Radix Select rejects empty string values)
- **Fixed** visit modal infinite loading — VisitDetailDialog only mounts when `selectedVisitId` is set; stable query key `["visit-detail", visitId]`
- **Added reschedule rule**: When scheduling a follow-up, checks for existing non-completed active visits. Empty drafts (no tech/notes/status changes) can be deleted; other visits can be cancelled or user can schedule anyway
- **Files changed**: `client/src/pages/JobDetailPage.tsx`, `client/src/components/AddVisitDialog.tsx`

#### JobDetailPage 2-Tier Layout Redesign (2026-02-07)

- **Goal**: Consolidate JobDetailPage top section into unified meta card, tighten layout
- **Top section** — replaced 3-card row (JobHeaderCard, JobAssignmentsCard, JobMetaCard) + standalone JobDescriptionCard with a single unified container using `grid-cols-[2fr_1.5fr_1fr]`:
  - **Left column**: JobHeaderCard (border-stripped via `[&_.shadcn-card]` selector), inline description, "Assign Technician" button
  - **Middle column**: JobVisitsSection (scrollable, `calc(100vh - 16rem)` max height, defaultOpen=true)
  - **Right column**: Inline status stack — Job#, Invoice link, Status dropdown, scheduled date with calendar popover, on-hold info
- **Scheduled date popover**: Click date → CalendarPicker opens → pick new date (preserves existing time, respects ALL DAY convention) → saves immediately. "Clear date" button to unset scheduledStart.
- **Status dropdown**: Replicates JobMetaCard logic — compound values (`open:in_progress`, `open:on_hold`), intercepts on_hold to open ActionRequiredModal
- **Main grid**: Changed from `grid-cols-[7fr,3fr]` to `grid-cols-[3fr_1fr]`
  - Left: Parts & Billing, Expenses, Recurring (unchanged)
  - Right sidebar reordered: Labour, Notes, Equipment, StatusTimeline, SchedulingHistory, Activity
  - Visits removed from sidebar (moved to top middle column)
- **Removed components**: JobDescriptionCard function (~118 lines deleted), JobAssignmentsCard import, JobMetaCard import
- **Fixed**: AssignTechnicianDialog tech.id number→string type mismatch (pre-existing from useTechniciansDirectory hook)
- **Fixed**: handleMetaStatusChange double-mutation for sub-status changes (removed redundant updateStatusMutation.mutate call)
- **File changed**: `client/src/pages/JobDetailPage.tsx`

#### Supplier Detail Page Tightening (2026-02-07)

- **Goal**: Make the Supplier Details page more compact and visually cleaner
- **Left column (Supplier Information)**:
  - Removed duplicate Phone input field (was rendered twice)
  - Removed "Primary Address" box entirely — address lives in the Locations table
  - Removed Website field from form state and UI
  - Email/Phone now fall back to primary location values when supplier record is blank
  - Final field order: Name, Email, Phone, Active toggle, QBO status
- **Right column (Locations table)**:
  - Replaced "Primary" text column header with blank icon-only column (w-70px)
  - Replaced "Active" text column header with blank icon-only column (w-60px)
  - Primary indicator is now a clickable star icon (filled when primary, outline otherwise)
  - Primary star uses optimistic cache update for instant visual feedback + rollback on error
  - Active indicator is now a small dot (green=active, gray=inactive)
  - Removed "Set Primary" button and "Primary" badge — star icon replaces both
- **Notes support for Supplier Locations**:
  - Added `notes` text column to `supplier_locations` table (`shared/schema.ts`)
  - Added `notes` to `updateSupplierLocationSchema` validation
  - Added Notes textarea to AddLocationDialog and EditLocationDialog
  - Migration: `migrations/2026_02_07_add_notes_to_supplier_locations.sql`
- **Files changed**:
  - `client/src/pages/SupplierDetailPage.tsx`
  - `client/src/components/suppliers/AddLocationDialog.tsx`
  - `client/src/components/suppliers/EditLocationDialog.tsx`
  - `shared/schema.ts`

#### Standalone Clients Page (2026-02-07)

- **Goal**: Remove legacy `?tab=` navigation, create dedicated route for Clients
- **New pages**:
  - `pages/Clients.tsx`: Standalone clients list page using TablePageShell
- **Routing changes**:
  - Added `/clients` route pointing to Clients page
- **Sidebar updates** (`AppSidebar.tsx`):
  - Changed Clients from onClick (`/?tab=clients`) to href (`/clients`)
- **Removed legacy tab navigation**:
  - Dashboard.tsx: Removed `?tab=clients` handling and ClientListTable tab
  - Updated ClientDetailPage.tsx: Back links now use `/clients`
  - Updated Header.tsx, AppHeader.tsx: Clients navigation uses `/clients`
- **Note**: ClientListTable.tsx kept for backwards compatibility with examples

#### Settings Products Page Standardization (2026-02-07)

- **Goal**: Apply standardized color + surface system to existing Settings Products page (Jobs reference)
- **Consolidated duplicate headers**:
  - `pages/PartsManagementPage.tsx`: Simplified to thin wrapper with workspace background only
  - `components/ProductsServicesManager.tsx`: Added seed parts mutation (moved from page)
  - `components/products-services/ProductsServicesToolbar.tsx`: Now the single source for header/title
    - Updated typography: `text-xl` → `text-lg font-semibold text-foreground` (matches Jobs)
    - Added Seed Parts button with Sprout icon
- **Standardized table surface**:
  - `components/products-services/ProductsServicesTable.tsx`:
    - Changed wrapper from `div` with border to `<ListSurface>`
    - Updated thead to use `bg-white dark:bg-gray-900` with explicit border colors
    - Updated row styling: `hover:bg-gray-100/60 dark:hover:bg-gray-800/60 transition-colors border-b border-gray-200 dark:border-gray-800`
- **3-layer surface model applied**:
  - Workspace: `bg-gray-200 dark:bg-gray-900`
  - Content surface: `<ListSurface>` (white/gray-900 with shadow-sm)
  - Row hover: standardized gray-100/60 / gray-800/60
- **Removed mistakenly created pages**:
  - Deleted `pages/Products.tsx` and `pages/Services.tsx` (top-level pages created in error)
  - Removed Products and Services from sidebar navigation
  - Removed `/products` and `/services` routes from App.tsx
  - Settings Products page (`/settings/products`) remains the canonical products management UI

#### TablePageShell Component - Consistent Page Width/Spacing (2026-02-07)

- **Goal**: Standardize page width, padding, and spacing across Jobs, Invoices, Quotes, Clients
- **Reference**: Jobs.tsx wrapper (`p-6 space-y-6`) used as source of truth
- **New file: `components/ui/table-page-shell.tsx`**:
  - `TablePageShell` - Reusable page wrapper component
  - Props: `title` (string), `actions` (ReactNode), `children`
  - Applies consistent `p-6 space-y-6` wrapper classes
  - Renders standardized page header row: title + actions
- **Refactored pages to use TablePageShell**:
  - `Jobs.tsx`: Uses shell (ensures shell matches Jobs exactly)
  - `InvoicesListPage.tsx`: Removed `max-w-[1400px] mx-auto` to match Jobs width
  - `Quotes.tsx`: Removed `max-w-[1400px] mx-auto` to match Jobs width
  - `ClientListTable.tsx`: Changed from `p-4 pt-3 space-y-3` to `p-6 space-y-6`
  - `SuppliersListPage.tsx`: Removed `max-w-[1400px] mx-auto` to match Jobs width

#### Reusable List Surface Primitives (2026-02-07)

- **Goal**: Create reusable primitives for list/table surfaces, reduce repeated class strings
- **New file: `components/ui/list-surface.tsx`**:
  - `ListSurface` - Container component: `rounded-lg bg-white dark:bg-gray-900 overflow-hidden shadow-sm`
  - `ListRow` - Row component for non-table lists with hover, borders, padding
  - `listSurfaceClass` - Raw class string for container styling
  - `tableRowClass` - Raw class string for table rows: `cursor-pointer hover:bg-gray-100/60 dark:hover:bg-gray-800/60 transition-colors border-b border-gray-200 dark:border-gray-800 last:border-b-0`
  - `listRowClass` - Raw class string for list rows (same as tableRowClass minus cursor)
- **Refactored pages to use primitives**:
  - `Jobs.tsx`: Uses `ListSurface` + `tableRowClass`
  - `InvoicesListPage.tsx`: Uses `ListSurface` + `tableRowClass` with cn() for compact mode
  - `Quotes.tsx`: Uses `ListSurface` + `tableRowClass`
  - `ClientListTable.tsx`: Uses `ListSurface` + `tableRowClass`

#### Typography and Header Standardization (2026-02-07)

- **Goal**: Consistent typography and table headers across all list pages
- **components/ui/table.tsx**:
  - `TableHeader`: Added explicit border color `border-gray-200 dark:border-gray-800`
  - `TableHead`: Updated to `text-xs font-medium uppercase tracking-wide text-muted-foreground` (Option A - clean + modern)
  - Reduced header height from `h-12` to `h-10` for tighter look
- **Page Titles** (all now use `text-lg font-semibold text-foreground`):
  - `Jobs.tsx`: Added page header with title + New Job button
  - `InvoicesListPage.tsx`: Changed from `text-2xl` to `text-lg`
  - `Quotes.tsx`: Changed from `text-2xl` to `text-lg`
  - `ClientListTable.tsx`: Changed from `text-2xl font-bold` to `text-lg font-semibold`

#### Global List Surface Standardization (2026-02-07)

- **Goal**: Apply Dashboard flat-row design to all table/list views
- **Jobs.tsx**:
  - Replaced Card wrapper with `rounded-lg bg-white dark:bg-gray-900 overflow-hidden shadow-sm`
  - Updated TableRow hover from `hover-elevate` to `hover:bg-gray-100/60 dark:hover:bg-gray-800/60`
  - Added `border-b border-gray-200 dark:border-gray-800 last:border-b-0` to rows
- **InvoicesListPage.tsx**:
  - Same container and hover updates as Jobs
  - Kept stats cards unchanged (they're not list rows)
- **Quotes.tsx**:
  - Same container and hover updates as Jobs
- **ClientListTable.tsx**:
  - Replaced `rounded-md border` with `rounded-lg bg-white dark:bg-gray-900 overflow-hidden shadow-sm`
  - Updated hover from `hover:bg-muted/50` to `hover:bg-gray-100/60 dark:hover:bg-gray-800/60`
  - Added consistent border-b dividers

#### Dashboard Visual Polish & Promotion (2026-02-06)

- **Goal**: Promote polished dashboard, unified frame color, company branding
- **App.tsx**:
  - Header and wrapper now use `bg-gray-200 dark:bg-gray-900` to match workspace
  - Added company name display in header (`text-base font-semibold text-foreground`), hidden on technician pages
  - Removed `/dashboard-preview-2` route (preview promoted to production)
  - Removed `DashboardPreview2` import
- **AppSidebar.tsx**:
  - Removed "Preview 2" menu item
- **Dashboard.tsx** (formerly DashboardPreview2.tsx):
  - Renamed from `DashboardPreview2.tsx` → `Dashboard.tsx`
  - Renamed export from `DashboardPreview2` → `Dashboard`
  - **TasksPanel**: Active/Completed tabs, Technician filter, Type filter
  - **NeedsAttentionWidget**: Flat rows, "Overdue" badge right-aligned with `mt-0.5`, no counter in header
  - **InvoicesWidget**: Flat rows, "Past due" badge right-aligned above amount, no counter in header
  - All rows use `hover:bg-gray-100/60 dark:hover:bg-gray-800/50` for visible hover
- **Deleted**: `client/src/pages/Dashboard.tsx` (old version)

#### 6-Digit Job Numbers and Search Improvements (2026-02-06)

- **Goal**: Better numeric search ordering (invoices first) + 6-digit job numbers for scalability
- **Search Ordering (`server/storage/search.ts`)**:
  - Invoice search now runs BEFORE job search for numeric queries
  - Invoice exact matches ranked above prefix matches via `ORDER BY CASE`
  - `interleaveResults()` now accepts optional `typeOrder` param for numeric queries
  - For numeric searches: `["invoice", "job", "customerCompany", "location", "supplier"]`
- **Frontend Group Ordering (`client/src/components/UniversalSearch.tsx`)**:
  - Added `TYPE_ORDER` constant for stable group display: invoice > job > customerCompany > location > supplier
  - `orderedTypes` filters TYPE_ORDER to only types with results
  - `flatResults` now uses `orderedTypes.flatMap()` so keyboard navigation matches visual order
  - Searching "1001" now shows INVOICES section first, with Invoice #1001 at top
- **6-Digit Job Numbers**:
  - Schema default changed from `10000` to `100000` (`shared/schema.ts`)
  - Hardcoded init values updated in `server/storage/jobs.ts` and `server/storage/invoices.ts`
  - Job number search logic updated for 6-digit range:
    - Exact match threshold: `>=6` digits (was `>=5`)
    - Prefix multiplier: `10^(6-digits.length)` (was `10^(5-digits.length)`)
    - Examples: `100` → 100000-100999, `1001` → 100100-100199, `100123` → exact
- **Migration (`migrations/2026_02_06_bump_job_numbers_to_6_digits.sql`)**:
  - Bumps existing companies with `next_job_number < 100000` to `100000`
  - Safe/idempotent: companies already at 6-digits are unaffected

#### Universal Header Rollout (2026-02-06)

- **Goal**: Single global header with UniversalSearch on all pages except auth pages
- **App.tsx Changes**:
  - Replaced old client-only search (Command dropdown) with `UniversalSearch` component
  - Removed old search state (`searchOpen`, `searchQuery`) and `/api/clients` query
  - UniversalSearch now visible on technician pages (`/technician`, `/daily-parts`)
  - "New" dropdown and Settings button remain hidden on technician pages
  - Overdue jobs alert behavior unchanged (still hidden on technician pages)
  - Removed unused imports: `Search`, `Command*`, `Popover*`
- **Page Cleanup**:
  - `ManageTeam.tsx`: Removed duplicate `<AppHeader />` - now uses global header
  - `TechnicianDashboard.tsx`: Removed duplicate `<AppHeader />` and `FeedbackDialog`
- **Dead Code**: `Header.tsx` and `AppHeader.tsx` components are now unused (previously used by removed page headers)
- **Note**: Page-level `<header>` tags in `ClientDetailPage.tsx` and `LocationDetailPage.tsx` are page title sections (breadcrumbs + actions), not navigation headers - intentionally kept

### Fixed

- **Search auth guard** (`server/routes/search.ts`): Added explicit auth guard to fail fast with 401 for unauthenticated requests instead of hanging on missing `companyId`

### Added

#### Dashboard Preview 2 - Frame Contrast + Flat Lists (2026-02-06)

- **Feature**: Design polish of cloned Dashboard.tsx (not a redesign)
- **File**: `client/src/pages/DashboardPreview2.tsx`
- **Route**: `/dashboard-preview-2`
- **Styling changes applied**:
  - **Frame contrast (TailPanel)**: `bg-gray-200` main content, sidebar/header stay unified white
  - **Flat list items**: Removed card-in-card pattern
    - `border-b border-gray-100` dividers between rows (not on last)
    - No individual row backgrounds or shadows
    - `hover:bg-gray-50` light hover
    - Preserved `border-l-4` colored status strips (red/amber/green)
  - **Card headers**: Separated header from list with `border-b`, footer with `border-t`
  - **Tasks panel**: Matches Needs Attention / Invoices with same flat row + divider behavior
- **Preserved exactly**: Layout, density, sections, all data hooks, no new sections
- **Note**: Original Dashboard.tsx completely unchanged

#### Universal Header Search (2026-02-04)

- **Feature**: Global search across jobs, invoices, customer companies, locations, and suppliers
- **Backend (`server/routes/search.ts`, `server/storage/search.ts`)**:
  - `GET /api/search?q=<query>&limit=<n>` endpoint
  - Returns typed results: `job | invoice | customerCompany | location | supplier`
  - Each result includes: `type`, `id`, `title`, `subtitle`, `match` (match type indicator)
  - Matching priority: job/invoice numbers (exact/prefix) → names/addresses → email → phone
  - Phone normalization: strips non-digits for flexible matching
  - Invoice number handling: supports `INV-22019`, `22019`, `220` prefix
  - Tenant isolation: all queries scoped by `companyId`
- **Indexes (`migrations/2026_02_04_add_search_trgm_indexes.sql`)**:
  - `pg_trgm` extension for fuzzy text search
  - GIN trigram indexes on: `customer_companies.name`, `client_locations.company_name`, `client_locations.address`, `jobs.summary`, `suppliers.name`
  - B-tree indexes on: `jobs(company_id, job_number)`, `invoices(company_id, invoice_number)`
- **Frontend (`client/src/components/UniversalSearch.tsx`)**:
  - Replaces old client-only search in Header
  - 200ms debounce, grouped dropdown by type
  - Keyboard navigation: `↑↓` navigate, `Enter` select, `Esc` close
  - Routes on selection: jobs, invoices, customers, clients, suppliers
- **Tests (`tests/search.test.ts`)**:
  - 19 tests covering: job/invoice number search, name/address/email/phone matching, tenant isolation

### Changed

#### Centralized calendar invalidation helpers to reduce unnecessary refetches (2026-02-03)

- **Goal**: Reduce duplicate React Query invalidations after calendar/visit mutations
- **Centralized Helpers Added** (`useCalendarApi.ts`):
  | Helper | Invalidates | Use Case |
  |--------|-------------|----------|
  | `invalidateCalendarQueries` | `/api/calendar`, `/api/calendar/range` | reschedule, complete (job stays on calendar) |
  | `invalidateCalendarAndUnscheduledQueries` | Above + `/api/calendar/unscheduled` | schedule, unschedule (job moves between calendar/backlog) |
  | `invalidateJobQueries` | `/api/jobs`, `/api/jobs/{jobId}` | All mutations that change job data |
  | `invalidateVisitQueries` | `/api/jobs/{jobId}/visits/*` | Mutations that affect job visits |
- **DEV-only Logging**:
  - Logs which query keys are invalidated per operation with timestamps
  - Warns if same key is invalidated twice within a single operation (duplicate detection)
  - Gated by `process.env.NODE_ENV === "development"`
- **Hooks Updated to Use Centralized Helpers**:
  - `useScheduleJob()` - calendar + unscheduled + jobs
  - `useRescheduleJob()` - calendar only + jobs (NOT unscheduled - job stays on calendar)
  - `useUnscheduleJob()` - calendar + unscheduled + jobs + visits
  - `useCompleteJob()` - calendar only + jobs (NOT unscheduled)
- **Components Migrated to Centralized Hooks/Helpers**:
  - `JobVisitsSection.tsx` - Now uses `useUnscheduleJob` hook instead of custom mutation
  - `AddVisitDialog.tsx` - Now uses centralized invalidation helpers
- **Invalidation Rules Enforced**:
  - schedule: calendar + unscheduled (job moves FROM backlog TO calendar)
  - reschedule: calendar only (job stays on calendar, just different slot)
  - unschedule: calendar + unscheduled (job moves FROM calendar TO backlog)
  - complete: calendar only (job stays on calendar, status changes)
- **Hard Stop Verified**:
  - No duplicate invalidation of same key within single operation
  - No regression in UI freshness (all necessary queries still invalidated)
- **Modified Files**:
  - `client/src/hooks/useCalendarApi.ts` - Added centralized helpers and DEV logging
  - `client/src/components/JobVisitsSection.tsx` - Switched to centralized hook
  - `client/src/components/AddVisitDialog.tsx` - Switched to centralized helpers

### Added

#### Calendar event cards: Visit #N display with deep link to job visits (2026-02-03)

- **Goal**: Display visit number on calendar cards with deep link to job detail visits section
- **Calendar Card Changes** (`DraggableClient.tsx`):
  - Shows "Visit #N" text when `visitNumber` is available in calendar event data
  - Added history icon button that navigates to Job Detail visits section
  - Deep link uses `?section=visits` query param to auto-expand visits collapsible
- **Server Changes** (ADDITIVE - no breaking changes):
  - `CalendarEventDto` now includes `visitId?: string` and `visitNumber?: number | null`
  - `server/storage/calendar.ts` - SQL query fetches `visit_number` from eligible job_visit
  - `server/routes/calendar.ts` - Transform includes visitId and visitNumber in response
- **JobDetailPage Deep Link Support**:
  - Parses `?section=visits` query parameter using `useSearch` from wouter
  - Passes `forceOpen` prop to JobVisitsSection to auto-expand when deep linked
- **JobVisitsSection Props Extended**:
  - Added `forceOpen?: boolean` prop for external control (deep link support)
  - useEffect syncs open state when forceOpen changes
- **Invariants Preserved**:
  - Existing calendar functionality unchanged - all fields are additive
  - Visit selection logic same as server: earliest future eligible, else most recent past
  - No changes to calendar write/schedule operations
- **Modified Files**:
  - `shared/types/calendar.ts` - Added visitId, visitNumber to CalendarEventDto
  - `server/storage/calendar.ts` - SQL fetches visit_number, interface updated
  - `server/routes/calendar.ts` - Transform includes visit info
  - `client/src/components/calendar/DraggableClient.tsx` - Visit #N display, history icon
  - `client/src/pages/JobDetailPage.tsx` - Deep link query param handling
  - `client/src/components/JobVisitsSection.tsx` - forceOpen prop for deep link support

#### "Schedule follow-up visit" button in JobVisitsSection (2026-02-03)

- **Goal**: Allow office users to schedule follow-up visits directly from the timeline
- **Button Location**: Top right of JobVisitsSection header (replaced "Add Visit")
- **Behavior**:
  - Always creates NEW visit via `POST /api/calendar/schedule` (preserves old visits)
  - Defaults technician from current eligible visit (same pattern as OfficeActionsStrip)
  - After scheduling, auto-scrolls to and highlights the new visit (green ring, 3s pulse)
- **AddVisitDialog Props Extended**:
  - `defaultTechnicianId?: string | null` - Pre-fills technician dropdown
  - `onVisitCreated?: (visitId: string) => void` - Callback for highlight/scroll
- **Server Response Enhanced**:
  - `POST /api/calendar/schedule` now returns `visit.id` in response for client highlighting
- **Hard Stop**: Follow-up always creates new `job_visits` row - never modifies existing visits
- **No New Endpoints**: Only existing endpoint response was enriched
- **Modified Files**:
  - `client/src/components/JobVisitsSection.tsx` - Added highlight state, scroll logic, renamed button
  - `client/src/components/AddVisitDialog.tsx` - Added defaultTechnicianId and onVisitCreated props
  - `server/routes/calendar.ts` - Added visit info to schedule response
  - `server/storage/calendar.ts` - Return visit info from scheduleJob

#### JobVisitsSection timeline tags for unambiguous visit eligibility (2026-02-03)

- **Goal**: Make it clear to office users which visit drives the job's calendar position
- **Timeline Tags Added**:
  | Tag | Meaning | Badge Style |
  |-----|---------|-------------|
  | CURRENT (mirrored) | Visit that syncJobScheduleFromVisits() picks | Primary (blue) |
  | UPCOMING | Future eligible visits after current | Light blue |
  | HISTORY | Not eligible for sync | Gray |
- **Eligibility Explanation**: Shows why history visits are not eligible:
  - `is_active=false` - Unscheduled via calendar
  - `status=completed` - Work finished
  - `status=cancelled` - Visit was cancelled
- **Eligibility Rules Match Server**: Uses same logic as `syncJobScheduleFromVisits`:
  - Eligible: `is_active=true AND status NOT IN ('completed','cancelled')`
  - Selection: earliest future visit, else most recent past visit
- **Section Headers Updated**: Explicit descriptions explaining what each section means
- **Tooltips Added**: Hover on tags to see detailed explanation
- **UI-only change**: No sync or calendar write logic modified
- **Modified Files**:
  - `client/src/components/JobVisitsSection.tsx` - Added timeline tags, tooltips, and section descriptions
  - `client/src/hooks/useJobVisits.ts` - Imported `isVisitIneligible` helper (already existed)

### Fixed

#### Safety: JobVisitsSection unschedule confirmation dialog (2026-02-03)

- **Goal**: Make unschedule from JobVisitsSection safe with explicit confirmation
- **Safety Rules Enforced**:
  1. Unschedule button only renders for CURRENT visit (`isCurrent && !inactive`)
  2. Uses canonical endpoint: `POST /api/calendar/unschedule/:jobId`
  3. Confirmation dialog required before execution
- **Confirmation Dialog Message**:
  > "This will remove the job from the calendar by setting is_active=false on the current visit. History is preserved."
- **Invalidations Verified** (all 4 required):
  - `["/api/jobs", jobId]` ✅
  - `["/api/jobs", jobId, "visits", "all"]` ✅
  - `["/api/calendar"]` ✅
  - `["/api/calendar/unscheduled"]` ✅
- **Hard Stop**: Unschedule never targets a non-current visit (enforced by `isCurrent` render condition)
- **Modified Files**:
  - `client/src/components/JobVisitsSection.tsx` - Added AlertDialog import, confirmation state, and dialog

#### Refactor: OfficeActionsStrip unschedule uses canonical useUnscheduleJob hook (2026-02-03)

- **Goal**: Ensure invalidations use centralized helpers, avoid drift between views
- **Before**: JobDetailPage defined inline `unscheduleMutation` with manual invalidations
- **After**: Uses `useUnscheduleJob()` from `client/src/hooks/useCalendarApi.ts`
- **Canonical Hook Invalidations**:
  - `/api/calendar` ✅
  - `/api/calendar/range` ✅ (was missing in inline version)
  - `/api/calendar/unscheduled` ✅
  - `/api/jobs` ✅ (prefix matches job-specific queries like `/api/jobs/${id}`)
- **Custom Callbacks Preserved**: Toast notifications for success/error passed via `mutate()` options
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Replaced inline mutation with hook import and usage

#### DEV: AddVisitDialog assertion guarantees POST /api/calendar/schedule (2026-02-03)

- **Goal**: Guarantee OfficeActionsStrip "Schedule another visit" always creates NEW visits
- **Call Chain Verified**:
  1. `OfficeActionsStrip.onScheduleVisit` → `setShowScheduleVisitDialog(true)`
  2. Opens `AddVisitDialog` component
  3. `AddVisitDialog` uses `POST /api/calendar/schedule` (line 66)
- **DEV-only Assertions Added** (guarded by `process.env.NODE_ENV === "development"`):
  - Logs: `[AddVisitDialog] Creating new visit via POST /api/calendar/schedule (jobId=...)`
  - Assert: Endpoint must NOT contain `:jobId` path param (that would be reschedule)
  - Assert: Method must be POST, not PATCH
- **Production Behavior**: Unchanged (logs only in development)
- **Modified Files**:
  - `client/src/components/AddVisitDialog.tsx` - Added DEV assertions in mutationFn

#### Fix: Overdue calculation now matches server/storage/dashboard.ts (2026-02-03)

- **Bug**: Frontend `getAttentionReason()` used different overdue logic than server
- **Server Logic** (`server/storage/dashboard.ts:222-226`):
  ```sql
  CASE
    WHEN scheduled_end IS NOT NULL THEN scheduled_end
    WHEN duration_minutes IS NOT NULL THEN scheduled_start + duration_minutes
    ELSE scheduled_start
  END < todayStart  -- midnight UTC of today
  ```
- **Previous Frontend Logic** (incorrect):
  - Compared against `new Date()` (current moment)
  - Used `durationMinutes && durationMinutes > 0` (excluded 0)
- **Fixed Frontend Logic** (now matches server):
  - Compares against midnight UTC of today: `todayStart.setUTCHours(0,0,0,0)`
  - Uses `durationMinutes != null` (includes 0, matches SQL `IS NOT NULL`)
- **Impact**: Jobs now correctly show as overdue only when effectiveEnd < midnight of today
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Updated `getAttentionReason()` and detail text computation

#### Fix: Status mutations missing required version field (2026-02-03)

- **Bug**: `updateStatusMutation` and `clearHoldMutation` in JobDetailPage were missing the required `version` field
- **Impact**: All status updates from JobDetailPage (including "Mark Invoiced" from OfficeActionsStrip) were failing with 400 validation errors
- **Root Cause**: Server schema at `server/routes/jobs.ts:303` requires `version: z.number().int().nonnegative()`
- **Fix**: Updated mutations to accept and pass `job.version` to the server
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Updated `updateStatusMutation` and `clearHoldMutation` signatures and all call sites
- **Verified Transitions**:
  - `completed → invoiced` ✅ (OfficeActionsStrip "Mark Invoiced")
  - `open → open` with `openSubStatus: null` ✅ (OfficeActionsStrip "Clear Hold")

#### Polish: OfficeActionsStrip Jobber-grade UX (2026-02-03)

- **Goal**: Make OfficeActionsStrip feel "Jobber-grade" with proper permissions and UX
- **Button Labels Match Reason**:
  | Reason | Primary | Secondary |
  |--------|---------|-----------|
  | requires_invoicing | "Schedule another visit" | "Mark Invoiced" (with confirm) |
  | on_hold | "Schedule another visit" | "Resume" |
  | overdue | "Reschedule" | "Unschedule" (hidden if not scheduled) |
- **Permission Checks Added**:
  - Uses `useAuth()` to get current user role
  - `MANAGER_ROLES` (owner, admin, manager, dispatcher) can perform all actions
  - Technicians see disabled buttons with tooltip: "You don't have permission..."
- **Invalid Actions Hidden**:
  - "Unschedule" button hidden for overdue jobs that aren't currently scheduled
- **Tooltips on Disabled Buttons**:
  - Permission denied: "You don't have permission to perform this action"
  - Action in progress: "Action in progress..."
- **Confirmation Dialogs**:
  - "Mark Invoiced" requires confirmation (lifecycle change: completed → invoiced)
  - Other actions don't require confirmation (reversible/no lifecycle change)
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Added permission helpers, useAuth, tooltips

### Changed

#### OfficeActionsStrip: Jobber-style workflow actions (2026-02-03)

- **Change**: Actions now depend on attention reason and follow Jobber workflow patterns
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Updated ATTENTION_CONFIG and OfficeActionsStrip component
- **Action Mapping by Reason**:
  - **requires_invoicing** (status=completed):
    - Primary: "Schedule another visit" (opens visit dialog)
    - Secondary: "Mark Invoiced" (with confirmation dialog - lifecycle change)
  - **on_hold** (status=open, openSubStatus=on_hold):
    - Primary: "Schedule another visit" (Jobber-like follow-up)
    - Secondary: "Resume" (clears openSubStatus via existing endpoint)
  - **overdue** (status=open, past scheduledEnd):
    - Primary: "Reschedule" (opens schedule dialog)
    - Secondary: "Unschedule" (uses POST /api/calendar/unschedule/:jobId)
- **Confirmation Dialog**: Added for "Mark Invoiced" action (lifecycle status change)
- **Safety Verified**:
  - ✅ No path archives jobs from on_hold or overdue states
  - ✅ requires_invoicing only transitions to "invoiced" (not "archived")
  - ✅ All actions use existing server endpoints (no new endpoints invented)
- **New Props**: `isMarkingInvoiced`, `isClearingHold` for loading states
- **UI Improvements**:
  - Primary button icon now varies by reason (CalendarPlus vs Calendar)
  - Secondary button shows spinner when action is pending

#### Phase 4: Compact Reason Details in Office Actions Strip (2026-02-03)

- **Change**: OfficeActionsStrip now shows context-specific details for each attention reason
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Updated OfficeActionsStripProps and rendering
- **Detail Text by Reason**:
  - **on_hold**: Shows hold reason + "Follow-up: <date>" if nextActionDate is set
  - **overdue**: Shows "Overdue since <date>" computed from effectiveEnd
  - **requires_invoicing**: Shows "Completed <date>" if closedAt is available
- **Props Added** to OfficeActionsStripProps:
  - `nextActionDate?: string | null` - For on_hold follow-up dates
  - `closedAt?: Date | string | null` - For requires_invoicing completion date
- **Hard Stop Verified**: No layout shifting on load
  - Detail text computed synchronously from existing job data
  - Uses stable `min-content` layout - text appears inline with badge
  - No async data fetching, no conditional loading states
- **Date Formatting**: Uses date-fns `format(date, 'MMM d')` for compact display (e.g., "Feb 3")

#### Phase 4: Completed Jobs Reopen on Follow-up Visit (2026-02-03)

- **Change**: Scheduling a follow-up visit on a completed job now reopens it to 'open' status
- **Modified Files**:
  - `server/storage/calendar.ts` - `scheduleJob()` now reopens completed jobs
- **Behavior** (Jobber-like):
  - When scheduling a visit on a completed job:
    1. New visit is created (as before)
    2. Job status is set to 'open' (new behavior)
    3. Job's `openSubStatus` is cleared
  - This is a valid status transition per `JOB_STATUS_FLOW: completed → open`
- **Rationale**:
  - A completed job means "the work is done"
  - Scheduling another visit means "more work is needed"
  - The job should return to 'open' status for correct calendar/backlog behavior
  - Without this, jobs would stay in "Requires Invoicing" state even with future visits
- **Audit**: New context label `storage:scheduleJob:PHASE4:reopen` captures the status change
- **Office Actions Strip Updates**:
  - Primary action "Schedule another visit" now properly reopens completed jobs
  - Secondary action "Mark Invoiced" transitions `completed → invoiced` (unchanged)

#### Phase 4: Office Actions Strip in Job Detail (2026-02-03)

- **Change**: Added Jobber-style "Office Action Required" banner in Job Detail when job needs attention
- **Modified Files**:
  - `client/src/pages/JobDetailPage.tsx` - Added OfficeActionsStrip component and integration
- **Attention Conditions** (matches server dashboard logic):
  - `requires_invoicing`: `status='completed'` → shows "Requires Invoicing" badge
  - `on_hold`: `status='open' AND openSubStatus='on_hold'` → shows "On Hold" badge with holdReason
  - `overdue`: `status='open' AND effectiveEnd < now` → shows "Overdue" badge
- **Overdue Calculation** (client-side, matches server semantics):
  - `effectiveEnd = scheduledEnd ?? (scheduledStart + durationMinutes) ?? scheduledStart`
  - Job is overdue when `effectiveEnd < now`
- **Actions per Attention Reason** (safe, Jobber-like):
  - **requires_invoicing**: Primary "Schedule another visit", Secondary "Mark Invoiced" (`completed → invoiced`)
  - **on_hold**: Primary "Schedule another visit", Secondary "Clear Hold" (sets `openSubStatus=null`)
  - **overdue**: Primary "Schedule another visit", Secondary "Unschedule" (`POST /api/calendar/unschedule/:jobId`)
- **Mutations Added**:
  - `clearHoldMutation`: Sets `openSubStatus=null` to resume normal workflow
  - `unscheduleMutation`: Uses canonical calendar endpoint to return job to backlog
- **Safety Constraints**:
  - No accidental archiving from on_hold or overdue states
  - All transitions use valid lifecycle rules per `server/statusRules.ts`
  - Unschedule uses canonical calendar endpoint (preserves job_visits history)
- **UI**:
  - Amber-themed banner at top of Job Detail (before header cards)
  - Only appears when conditions match
  - Responsive layout (stacks on mobile)

#### Phase 4: Spawn-on-Action Reschedule Behavior (2026-02-03)

- **Change**: Reschedule now creates a new visit when the current visit has been actioned
- **Modified Files**:
  - `server/storage/calendar.ts` - `rescheduleJob()` rewritten with spawn-on-action logic
  - `server/storage/jobVisits.ts` - Added `isVisitActioned()` helper function
- **Behavior**:
  - If visit has NO activity: updates that same visit (no extra visits created)
  - If visit IS actioned: soft-deletes old visit (`is_active=false`), creates new visit
- **Actioned Detection** (deterministic, uses existing schema fields):
  - `checkedInAt` is set (technician checked in)
  - `checkedOutAt` is set (technician checked out)
  - `actualDurationMinutes > 0` (time was tracked)
  - `status` progressed beyond 'scheduled' (dispatched, en_route, on_site, in_progress, on_hold, completed)
- **Invariants Preserved**:
  - Dragging an untouched visit back and forth does NOT create extra visits
  - History preserved: old actioned visits become inactive and appear in History section
  - No direct writes to jobs scheduling fields (uses `syncJobScheduleFromVisits()`)
  - Version handling unchanged (uses job.version for API compat)
- **Audit**: New context label `storage:rescheduleJob:spawn-on-action` for spawn events

#### Phase 4: AddVisitDialog Uses Canonical Calendar Endpoint (2026-02-03)

- **Change**: AddVisitDialog now uses `POST /api/calendar/schedule` instead of `POST /api/jobs/:jobId/visits`
- **Modified Files**:
  - `client/src/components/AddVisitDialog.tsx` - Changed endpoint and payload to match scheduleJobSchema
  - `client/src/components/JobVisitsSection.tsx` - Passes jobVersion to AddVisitDialog
- **Payload Changes** (old → new field names):
  - `scheduledDate` → `startAt` (ISO datetime string)
  - `estimatedDurationMinutes` → `durationMinutes`
  - `assignedTechnicianId` → `technicianUserId` (null for unassigned)
  - `visitNotes` → `notes`
  - Added: `jobId`, `version` (required by schema)
- **Cache Invalidation**: Now invalidates job detail, calendar, and unscheduled backlog queries
  - AddVisitDialog: `["/api/calendar/unscheduled"]` added (job moves from backlog to calendar)
  - JobVisitsSection: `["/api/calendar/unscheduled"]` added (job moves from calendar to backlog)
- **Rationale**: Single source of truth for scheduling - all schedule operations go through calendar endpoint

#### Phase 4: Job Detail Visits Panel with Timeline UI (2026-02-03)

- **Change**: Enhanced JobVisitsSection component with Current/Upcoming/History grouping
- **New Files**:
  - `client/src/hooks/useJobVisits.ts` - Hook with derived selectors for visit categorization
- **Modified Files**:
  - `client/src/components/JobVisitsSection.tsx` - Rewrote to show grouped visits with timeline UI
  - `client/src/components/AddVisitDialog.tsx` - Added calendar query invalidation
  - `server/storage/jobVisits.ts` - Added `listAllJobVisitsForJob()` for history display
  - `server/services/jobVisits.service.ts` - Added service wrapper
  - `server/routes/jobVisits.routes.ts` - Added `?all=true` query param for full history
- **Display Logic** (client-side only, matches server eligibility):
  - Eligible: `isActive=true` AND `status NOT IN ('completed', 'cancelled')`
  - Current: Earliest future eligible visit, else most recent past eligible
  - Upcoming: Future eligible visits after current
  - History: All other visits (completed, cancelled, inactive)
- **UI Features**:
  - Current Visit section with highlight ring
  - Upcoming Visits section (if any)
  - History section with inactive badge showing "Unscheduled"
  - Per-visit: DateTime range, duration, status chip, technician, notes
  - Unschedule action via calendar endpoint `POST /api/calendar/unschedule/:jobId`
- **Invariants Preserved**: No changes to `syncJobScheduleFromVisits`, eligibility rules, or calendar write logic

#### Phase 4: Calendar WRITE Path Migrated to job_visits (2026-02-02)

- **Change**: Calendar write endpoints now write to `job_visits` instead of directly updating `jobs` table
- **Endpoints Migrated**:
  - `POST /api/calendar/schedule` → Creates new job_visit row
  - `PATCH /api/calendar/schedule/:jobId` → Updates current eligible visit
  - `POST /api/calendar/unschedule/:jobId` → Sets visit status='cancelled'
  - `POST /api/calendar/resize` → Updates visit's scheduled_end
- **Current Visit Selection**: Same logic as calendar read - earliest future visit if any exist, else most recent past
  - Eligibility: `is_active=true`, `scheduled_start IS NOT NULL`, `status NOT IN ('cancelled', 'completed')`
- **jobs Table Sync**: After each write, `syncJobScheduleFromVisits()` mirrors data to jobs table for backwards compat
- **Optimistic Locking**: Still uses `jobs.version` for API compatibility; visit.version used internally
- **Unschedule Behavior**: Sets `is_active=false` (soft-delete, consistent with repository pattern)
- **Files Modified**:
  - `server/storage/calendar.ts` - `scheduleJob`, `rescheduleJob`, `unscheduleJob` rewritten
  - `server/routes/calendar.ts` - `/resize` endpoint rewritten
  - `server/storage/jobVisits.ts` - Added `getCurrentEligibleVisit()` and `syncJobToVisits()` helpers
- **Unchanged**: Calendar READ path (Phase 3), bypass functions (`scheduleJobBypassWorkingHours`, etc.)

#### Phase 3: Calendar API Reads from job_visits (2026-02-02)

- **Change**: Calendar API now reads scheduled events from `job_visits` table instead of `jobs.scheduledStart` (Model B migration)
- **Selection Rules**: Same as `syncJobScheduleFromVisits()` - uses earliest future visit, else most recent past visit
  - Excluded: `is_active=false`, `scheduled_start IS NULL`, `status IN ('cancelled', 'completed')`
- **Implementation**: Uses raw SQL CTE with window function `ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY ...)` to rank visits per job
- **Technician Data**: Now sourced from visit fields (`assigned_technician_id`, `assigned_technician_ids`) instead of job fields
- **Files Modified**: `server/storage/calendar.ts`
- **Functions Updated**: `getScheduledJobsInRange()` - replaced Drizzle ORM query with CTE-based raw SQL
- **Backwards Compatibility**: `syncJobScheduleFromVisits()` still mirrors visit data to job fields for other consumers
- **Query Structure**:
  ```sql
  WITH eligible_visits AS (
    SELECT jv.* FROM job_visits jv
    WHERE jv.company_id = ? AND jv.is_active = true
      AND jv.scheduled_start IS NOT NULL
      AND jv.status NOT IN ('cancelled', 'completed')
  ),
  ranked_visits AS (
    SELECT ev.*, ROW_NUMBER() OVER (
      PARTITION BY ev.job_id
      ORDER BY
        CASE WHEN ev.scheduled_start >= NOW() THEN 0 ELSE 1 END,
        CASE WHEN ev.scheduled_start >= NOW() THEN ev.scheduled_start END ASC,
        CASE WHEN ev.scheduled_start < NOW() THEN ev.scheduled_start END DESC
    ) as rn FROM eligible_visits ev
  )
  SELECT rv.*, j.*, cl.company_name as location_name
  FROM ranked_visits rv
  JOIN jobs j ON rv.job_id = j.id
  WHERE rv.rn = 1 AND rv.scheduled_start >= ? AND rv.scheduled_start < ?
  ```

#### Step 2.4: syncJobScheduleFromVisits Helper (2026-02-02)

- **Change**: Added compatibility mirror that syncs the "next scheduled visit" onto `jobs.scheduled_*` fields
- **Purpose**: Maintains backwards compatibility while calendar transitions from Model A (job-based) to Model B (visit-based)
- **Selection Rules**:
  - Eligible visits: `is_active=true`, `scheduled_start IS NOT NULL`, `status NOT IN ('cancelled', 'completed')`
  - Prefer earliest future visit if any exist
  - Otherwise use most recent past visit (latest `scheduled_start`)
- **Mirrored Fields**: `scheduledStart`, `scheduledEnd`, `isAllDay`, `durationMinutes`, `primaryTechnicianId`, `assignedTechnicianIds`
- **Unschedule Branch**: If no eligible visits exist, all mirrored fields are cleared (including technician assignments)
- **Optimistic Locking**: Bumps `jobs.version` on every sync
- **Call Sites**: All 6 write methods - `createJobVisit`, `updateJobVisit`, `deleteJobVisit`, `updateJobVisitStatus`, `checkInJobVisit`, `checkOutJobVisit`
- **Files Modified**: `server/storage/jobVisits.ts`

#### Task Status Filter Simplified to Active/Completed (2026-02-01)

- **Change**: Simplified status filter from 4 options (Active, Pending, In Progress, Completed) to 2 options (Active, Completed)
- **Active**: Shows all non-completed tasks (pending, in_progress) - filters out completed and cancelled
- **Completed**: Shows only completed tasks
- **Files Modified**: `client/src/components/TasksSidebar.tsx`
- **Functions Updated**: `buildTasksUrl()`, `normalizeTasks()`, status state type

#### Task Panel Filter Buttons Replaced with Dropdowns (2026-02-01)

- **Change**: Replaced My/All toggle buttons and type buttons with two dropdown filters
- **Assignee Dropdown**: "All Technicians" (default) + list of technicians from `useTechniciansDirectory()`
- **Type Dropdown**: "All Types" (default), "General", "Supplier Visit"
- **Both filters work together**: e.g., selecting "John" + "General" shows only John's general tasks
- **Files Modified**: `client/src/components/TasksSidebar.tsx`
- **State Changes**: `scope` renamed to `assigneeFilter`, `type` renamed to `typeFilter`
- **Added Imports**: `Select` components, `useTechniciansDirectory` hook

#### Task Dialog Delete Button Moved to Footer (2026-02-01)

- **Change**: Moved the delete button from the header (icon next to title) to the dialog footer (left side)
- **Layout**: Footer now shows `[Delete]` on left, `[Cancel] [Update]` on right for edit mode
- **Files Modified**: `client/src/components/TaskDialog.tsx`
- **Removed Import**: `Trash2` icon from lucide-react (no longer used)

### Fixed

#### Edit Task Dialog Not Populating Existing Task Data (2026-02-01)

- **Problem**: When opening an existing task to edit, all form fields were blank - task data wasn't being loaded
- **Root Cause**: The `useQuery` calls used query keys like `["/api/tasks", taskId]`, but the default query function (`getQueryFn`) only uses `queryKey[0]` as the URL. This meant the fetch URL was `/api/tasks` instead of `/api/tasks/${taskId}`
- **Solution**: Changed query keys to include the full URL as the first element:
  - Task data: `["/api/tasks", taskId]` → `[\`/api/tasks/${taskId}\`]`
  - Supplier visit: `["/api/tasks", taskId, "supplier-visit"]` → `[\`/api/tasks/${taskId}/supplier-visit\`]`
- **Files Modified**: `client/src/components/TaskDialog.tsx` (lines 104-108, 113-117)

#### Task Creation "toISOString is not a function" Error (2026-02-01)

- **Problem**: Creating all-day tasks failed with "value.toISOString is not a function" error
- **Root Cause**: The task storage layer passed ISO date strings directly to Drizzle ORM, but Drizzle's `timestamp` column type uses `mode: 'date'` by default, which expects JavaScript Date objects. Drizzle internally calls `.toISOString()` on the value, which fails on strings.
- **Solution**: Convert ISO strings to Date objects before passing to Drizzle in both `createTask` and `updateTask` functions
- **Files Modified**: `server/storage/tasks.ts`
- **Code Change**:
  ```ts
  // Before: Passed string directly (caused error)
  values.scheduledStartAt = input.scheduledStartAt;

  // After: Convert string to Date for Drizzle
  const parsed = new Date(input.scheduledStartAt);
  if (!isNaN(parsed.getTime())) {
    values.scheduledStartAt = parsed;
  }
  ```

#### React Hooks Rule Violation in Calendar Component (2026-01-30)

- **Problem**: "Rendered more hooks than during the previous render" error in Calendar component
- **Root Cause**: The `renderUnscheduledItem` useCallback (line 1888) was defined AFTER conditional early returns (error state at line 1728, loading state at line 1749). This violated React's Rules of Hooks - hooks must be called unconditionally at the top level, in the same order every render.
- **Solution**: Moved `renderUnscheduledItem` useCallback to line 1729, before any early returns but after all its dependencies are available
- **Files Modified**: `client/src/pages/Calendar.tsx`

#### Server Route Optimization - Removed All Pre-Validation Queries (2026-01-30)

- **Problem**: Calendar schedule/reschedule/unschedule endpoints performed redundant validation queries (5-6 per operation)
- **Solution**: Removed ALL pre-validation queries, relying on DB constraints and WHERE clauses:
  - **POST /schedule**: Removed `validateTechnicianBelongsToTenant()` (FK handles), `validateSchedule()` (overbooking allowed)
  - **PATCH /schedule/:jobId**: Removed `getJobById()` pre-check - job ownership verified by UPDATE WHERE clause
  - **POST /unschedule/:jobId**: Removed `getJobById()` pre-check - job ownership verified by UPDATE WHERE clause
- **Trade-off**: Conflict checking removed - dispatchers can see overbooking visually on calendar
- **Error Handling**: FK violations (invalid technician) now caught via PostgreSQL error code `23503`
- **Files Modified**: `server/routes/calendar.ts`
- **Imports Removed**: `validateSchedule`, `ScheduleValidationError` from calendarValidation service
- **Expected Performance**:
  - POST /schedule: 1 query (was 3-4) → ~300-400ms (was ~1070ms)
  - PATCH /schedule: 1 query (was 2-3) → ~200-300ms (was ~856ms)
  - POST /unschedule: 1 query (was 2-3) → ~150-250ms (was ~777ms)
- **Note**: For additional ~200ms improvement per query, enable Neon connection pooler by updating DATABASE_URL to use `-pooler` hostname suffix

#### Unscheduled Panel Loading Spinner During Reschedule (2026-01-30)

- **Problem**: The unscheduled sidebar showed a loading spinner during reschedule operations that don't affect it, because `isSavingDrag` included `updateAssignment.isPending`
- **Solution**: Split saving state into two:
  - `isSavingUnscheduled` - Only `createAssignment.isPending || deleteAssignment.isPending` (for sidebar)
  - `isSavingDrag` (renamed internally to `isSavingAnyDrag`) - All drag operations (for calendar feedback)
- **Files Modified**:
  - `client/src/hooks/useCalendarDnD.ts` - Added `isSavingUnscheduled` export
  - `client/src/pages/Calendar.tsx` - Use `isSavingUnscheduled` for UnscheduledJobsSidebar

#### All-Day to Timed Event Duration Bug (2026-01-30)

- **Problem**: Dragging an all-day job to a timed slot used the all-day duration (1440 minutes) instead of a sensible default, creating events that span the entire day
- **Solution**: In `updateAssignment` mutation (both `mutationFn` and `onMutate`):
  - Check if duration is 1440 (all-day) or > 480 (8 hours)
  - If so, clamp to `DEFAULT_DURATION_MINUTES` (60 min)
  - Also detect all-day to timed conversion via `a.isAllDay && !isAllDay` and force default
- **Files Modified**: `client/src/hooks/useCalendarDnD.ts`

#### Unnecessary Unscheduled Query Invalidation on Reschedule (2026-01-30)

- **Problem**: Moving jobs around on the calendar (reschedule) caused unnecessary loading spinners because `invalidateCalendarQueries()` invalidated the unscheduled query on ALL operations
- **Solution**: Split invalidation into two functions:
  - `invalidateCalendarOnly()` - Only invalidates calendar queries, NOT unscheduled. Used for:
    - Reschedule operations (updateAssignment)
    - Duration changes (updateDuration)
    - Technician assignments (assignTechnicians)
    - Completion status changes (toggleComplete)
  - `invalidateCalendarAndUnscheduled()` - Invalidates calendar + unscheduled + clients. Used for:
    - Schedule operations (createAssignment) - job moves from unscheduled to calendar
    - Unschedule operations (deleteAssignment) - job moves from calendar to unscheduled
    - Clear schedule/day operations - jobs move to unscheduled
    - Error recovery paths - need full refresh
- **Files Modified**: `client/src/hooks/useCalendarDnD.ts`

### Changed

#### Server-Side Calendar API Performance Optimization (2026-01-30)

- **Problem**: Calendar schedule/unschedule API endpoints took 800-950ms due to excessive sequential DB queries
- **Root Cause**: Each scheduling operation performed 6-8 sequential database round-trips:
  - `validateJobBelongsToTenant()` - 1 query
  - `validateTechnicianBelongsToTenant()` - 1 query
  - `validateSchedule()` - 2 queries (tech exists + conflict check)
  - `getJobById()` - 1 query (for version check)
  - Transaction (UPDATE + INSERT audit) - 1-2 queries
  - `getJob()` for notification - 1 query
- **Solution**: Multi-pronged optimization:
  1. **Repository Layer** (`server/storage/calendar.ts`):
     - Removed separate `getJobById()` call before UPDATE
     - Moved version check + terminal status check into UPDATE WHERE clause
     - Only fetch job details on error path (to determine error type)
     - Reduced from 2 DB calls to 1 in happy path per operation
  2. **Route Layer** (`server/routes/calendar.ts`):
     - Parallelized `validateTechnicianBelongsToTenant()` and `validateSchedule()` using `Promise.all()`
     - Removed redundant `validateJobBelongsToTenant()` (now checked in UPDATE WHERE)
  3. **Connection Pool** (`server/db.ts`):
     - Changed `min: 0` to `min: 2` (prod) / `min: 1` (dev) to keep connections warm
     - Changed `idleTimeoutMillis` to 60s (prod) to reduce cold starts
     - Changed `allowExitOnIdle: false` to keep pool warm
  4. **Database Indexes** (`migrations/2026_01_30_calendar_performance_indexes.sql`):
     - Added `jobs_conflict_check_idx` for conflict detection queries
     - Added `jobs_company_id_lookup_idx` for tenant-isolated lookups
- **Expected Performance**:
  - Before: 800-950ms per schedule/reschedule/unschedule operation
  - After: 200-400ms per operation (2-4x faster)
- **Files Modified**:
  - `server/storage/calendar.ts` - Optimized `scheduleJob()`, `rescheduleJob()`, `unscheduleJob()`
  - `server/routes/calendar.ts` - Parallelized validations
  - `server/db.ts` - Warmed connection pool
- **Migration**: `migrations/2026_01_30_calendar_performance_indexes.sql` (run with `psql` without transaction flag)
- **Trade-off**: Audit log `oldFields` is now null (we don't pre-fetch existing job to capture old values)

#### Client-Side Drag Performance Optimization (2026-01-30)

- **Problem**: Sidebar cards re-rendered 50+ times during drag, causing janky experience
- **Root Cause**:
  - `DraggableClient` component not memoized, re-rendered on every state change
  - `renderItem` callback recreated on every Calendar.tsx render
  - Verbose DEV logging (`[UNSCHED-DRAG]`) fired on every render
  - Query refetch triggered by window focus during drag
- **Solution**:
  1. **DraggableClient.tsx**: Wrapped with `React.memo` + custom comparison function
  2. **Calendar.tsx**: Extracted `renderItem` to `renderUnscheduledItem` with `useCallback`
  3. **DraggableClient.tsx**: Throttled DEV logging (only once per card mount)
  4. **useCalendarApi.ts**: Added `refetchOnWindowFocus: false`, `refetchOnMount: false`
- **Expected Results**:
  - Rerenders during drag: 50+ → 0-2
  - `[UNSCHED-DRAG]` logs: 50+ per drag → 0
  - Smooth drag experience
- **Files Modified**:
  - `client/src/components/calendar/DraggableClient.tsx`
  - `client/src/pages/Calendar.tsx`
  - `client/src/hooks/useCalendarApi.ts`

#### DnD Performance Fix - Eliminate Refetch Thrash (2026-01-30)

- **Problem**: DnD operations took ~1800ms total due to invalidating 15+ queries on each operation
- **Root Cause**: `onSuccess` handlers called `refetchCalendar()` + `invalidateCalendarQueries()` which invalidated ALL `/api/calendar*` queries plus `/api/clients`
- **Solution**: Replace full refetch with targeted cache merge + narrow invalidation
- **New Helpers** in `useCalendarDnD.ts`:
  - `mergeServerResponseIntoCache(result, jobId, operation)` - Directly merges server response into React Query cache
  - `invalidateNarrow(includeUnscheduled)` - Only invalidates `/api/calendar/unscheduled` when needed
- **Changes to Mutation Handlers**:
  - `createAssignment.onSuccess`: Uses `mergeServerResponseIntoCache` + `invalidateNarrow(true)`
  - `updateAssignment.onSuccess`: Uses `mergeServerResponseIntoCache` only (no invalidation needed)
  - `deleteAssignment.onSuccess`: Uses `mergeServerResponseIntoCache` + `invalidateNarrow(true)`
- **Expected Performance**:
  - Before: ~1800ms total (1000ms+ in refetch/invalidation phase)
  - After: ~150-200ms total (cache merge is <5ms, narrow invalidation is <5ms)
  - UI updates at `optimistic-update-complete` (~3ms) - instant feel preserved
- **Files Modified**: `client/src/hooks/useCalendarDnD.ts`
- **Verification**:
  - `npm run check` passes
  - `npm run build` passes
  - Optimistic updates still work (UI updates before server response)
  - Error rollback still works (cache restored from snapshot)

#### DnD Performance Instrumentation (2026-01-30)

- **Improvement**: Added comprehensive performance instrumentation for calendar drag-and-drop operations
- **Purpose**: Identify bottlenecks in DnD operations (optimistic updates already work, but refetch/invalidation may cause perceived lag)
- **New File**: `client/src/lib/dndPerformance.ts`
  - `startPerfSession(operation, jobId)` - Start timing a DnD operation
  - `mark(name, data)` - Add timing checkpoint
  - `endPerfSession(success)` - End session and log summary with bottleneck detection
  - `trackInvalidation(queryKey)` - Track which queries are invalidated
  - `isDndPerfEnabled()` - Returns true in development or with `?dnd-perf=1` query param
- **Instrumented Mutations** in `useCalendarDnD.ts`:
  - `createAssignment` (schedule) - marks: mutation-fn-start, on-mutate-start, queries-cancelled, optimistic-update-complete, server-response-received, on-success-start, pre-refetch, refetch-complete, invalidation-complete
  - `updateAssignment` (reschedule) - same marks
  - `deleteAssignment` (unschedule) - same marks
  - `invalidateCalendarQueries` - tracks invalidated count and query keys
- **Console Output** (DEV only):
  ```
  [DnD-Perf] ▶ Session started: schedule job=abc123
  [DnD-Perf] 📍 mutation-fn-start: +0.2ms
  [DnD-Perf] 📍 optimistic-update-complete: +3.4ms  <-- UI updates HERE
  [DnD-Perf] 📍 server-response-received: +145.2ms
  [DnD-Perf] 📍 refetch-complete: +312.5ms
  [DnD-Perf] ⏱ Session complete: schedule
  [DnD-Perf] Total: 312.5ms
  [DnD-Perf] ⚠️ Bottleneck: "pre-refetch → refetch-complete" took 166.4ms
  ```
- **Verification**:
  - `npm run check` passes
  - `npm run build` passes
  - Logs appear in browser DevTools during DnD operations

#### Unambiguous Weekly Droppable IDs (2026-01-30)

- **Improvement**: Weekly view droppable IDs now include full date (YYYY-MM-DD) instead of just dayName+dayNumber
- **Motivation**: Previous format `weekly|Mon|14|30|28` was ambiguous when week spans two months - the month/year had to be reconstructed from view state, causing Bug 16 (Sunday boundary issue)
- **New Formats**:
  - Weekly timed: `weekly|YYYY-MM-DD|{hour}|{minute}` (was: `weekly|{dayName}|{hour}|{minute}|{dayNumber}`)
  - Weekly all-day: `allday|week|YYYY-MM-DD` (was: `allday|{dayName}|{dayNumber}`)
- **Backward Compatibility**: Legacy format still supported via `getWeeklyTargetDate()` fallback
- **Files Modified**:
  - `client/src/components/calendar/CalendarGridWeek.tsx` - updated droppable ID generation
  - `client/src/pages/Calendar.tsx` - updated drop handlers with format detection
- **Benefits**:
  - Date is authoritative and unambiguous
  - No dependency on view state or weekStartsOn calculation during drop handling
  - Prevents month-boundary bugs permanently

#### Centralized Development Mode Flags (2026-01-30)

- **Improvement**: Gate ALL dev-only console logs and schema checks behind a single `IS_DEV` flag
- **Changes**:
  - Created `server/utils/devFlags.ts` - exports `IS_DEV`, `IS_PROD`, `DEV_VERBOSE`
  - Created `client/src/lib/devFlags.ts` - client-side equivalent
  - Replaced scattered `process.env.NODE_ENV === 'development'` checks with centralized `IS_DEV` import
  - Production logs are now clean - dev-only logs only run when NODE_ENV=development
- **Files Modified**:
  - `server/utils/devFlags.ts` (new)
  - `client/src/lib/devFlags.ts` (new)
  - `server/utils/validationHelpers.ts` (use IS_DEV)
  - `server/utils/allDaySanitizer.ts` (use IS_DEV)
  - `server/routes/calendar.ts` (use IS_DEV)
  - `server/services/calendarValidation.ts` (use IS_DEV)
  - `server/storage/calendar.ts` (use IS_DEV)
  - `client/src/pages/Calendar.tsx` (use IS_DEV for all dev logs)
- **Verification**:
  - `npm run check` passes
  - `npm run build` passes
  - Production bundle has no dev-only log strings (client)
  - Server bundle has IS_DEV guards (runtime check)

#### TODO.md Development Workflow Notes (2026-01-30)

- Added prominent "DEVELOPMENT WORKFLOW NOTES" section at top of TODO.md
- Documents when server restart is required (Zod schema changes, route modules)
- Added "DnD Regression Checklist" section with test cases:
  - Day View: unscheduled→unassigned, tech→unassigned, unassigned→tech
  - Week (By Technician) View: tech→unassigned
  - Drop on empty space should do nothing (verified: code returns early on !over)

#### Unscheduled Sidebar Card Styling (2026-01-29)

- **Improvement**: Unified unscheduled sidebar job card styling to match calendar cards
- **Changes**:
  - Consistent flex layout structure (`flex flex-col min-h-0 overflow-hidden`)
  - Font weight changed from `font-semibold` to `font-medium` (matches calendar cards)
  - Line height changed from `leading-[1.2]` to `leading-tight` (consistent spacing)
  - Simplified two-line layout: company name + summary/location
- **Files Modified**:
  - `client/src/components/calendar/DraggableClient.tsx` (unscheduled layout block)

### Fixed

#### Bug 16: Sunday Boundary Date Mapping Bug in Week View (2026-01-30)

- **Bug**: Dragging unscheduled job onto Sunday in week view showed success toast but job disappeared (not visible on calendar, not in unscheduled)
- **Root Cause Analysis (Type B: Wrong date)**:
  - Weekly view droppable IDs encode: `weekly|{dayName}|{hour}|{minute}|{dayNumber}`
  - Only `dayName` (Mon/Tue/...) and `dayNumber` (1-31) are encoded, NOT month/year
  - When week spans two months (e.g., Jan 27 - Feb 2), code used view's `month`/`year` as fallback
  - If current view month = January but Sunday = Feb 2, job was scheduled to Jan 2 instead of Feb 2
  - Job "disappeared" because it was scheduled to a date not in the current week's fetch range
- **Fix**:
  - Added `getWeeklyTargetDate(dayName)` helper in Calendar.tsx
  - Maps dayName to day index (0-6) based on `regional.weekStartsOn` setting
  - Computes exact target date from weekStart + day index
  - Returns correct `{ targetDay, targetMonth, targetYear }` for any day in the week
  - Updated weekly all-day handler and weekly timed handler to use the helper
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (added getWeeklyTargetDate helper, updated weekly handlers)
- **Verification Steps**:
  1. Navigate to a week that spans two months (e.g., last week of January 2026)
  2. Drag unscheduled job → Sunday timed slot: job appears on Sunday immediately
  3. Drag unscheduled job → Sunday all-day lane: job appears on Sunday immediately
  4. After refresh: job still appears on Sunday (proves DB has correct date)
  5. Same action works on other days (no regression)

#### Bug 15: Unassign Operations Validation Failure (2026-01-30)

- **Bug**: Day View Unscheduled → Unassigned threw "Expected string, received null at technicianUserId"; Tech → Unassigned snapped back
- **Root Cause Analysis**:
  - The schemas already had `.nullable().optional()` from Bug 7 and Bug 9 fixes
  - **Issue was server running OLD CODE** before the `.nullable()` was added
  - Server restart required for schema changes to take effect
- **Verification**: Added schema sanity check at module load time
  - Confirms `scheduleJobSchema` accepts null ✓
  - Confirms `rescheduleJobSchema` accepts null ✓
  - Logs `[SCHEMA-CHECK]` messages at server startup
- **Additional Fixes**:
  - Enhanced DEV logging in `validateSchema()` to capture full input data on validation failures
  - Logs Zod issue details: path, message, code, received, expected
- **Files Modified**:
  - `server/routes/calendar.ts` (schema sanity check at module load)
  - `server/utils/validationHelpers.ts` (DEV logging for validation failures)
- **Verification Steps**:
  - Server restart required after schema changes
  - Look for `[SCHEMA-CHECK] scheduleJobSchema accepts null technicianUserId ✓` in startup logs
  - Day View: Unscheduled → Unassigned should succeed
  - Day View: Tech → Unassigned should succeed
- **Automated Test Results** (2026-01-30):
  - ✓ Server startup schema checks pass
  - ✓ Schema test: POST /schedule with `technicianUserId: null` - PASS
  - ✓ Schema test: PATCH /schedule/:id with `technicianUserId: null` - PASS
  - ✓ Schema test: POST /schedule with valid UUID - PASS
  - ✓ Schema test: POST /schedule without technicianUserId - PASS

#### Weekly Technician View Drag-and-Drop (2026-01-29)

- **Bug**: Drag-and-drop on weekly technician view was broken - jobs would automatically move to 'unscheduled' regardless of drop target
- **Root Cause #1**: The `handleDragEnd` function was missing a handler for the `techweek|` drop zone ID pattern
- **Root Cause #2**: The `customCollisionDetection` function didn't include `techweek|` in the drop zone filter, so drops were never detected
- **Fixes**:
  - Added `techweek|` handler to parse target format `techweek|{techId}|{YYYY-MM-DD}`
  - Added `id.startsWith('techweek|')` to `customCollisionDetection` drop zone filter
  - Added `technicianUserId` field to `CreateAssignmentParams` type in useCalendarDnD.ts
  - Added `'techweek'` to `DragLogData.targetType` union in calendarDiagnostics.ts
  - Updated `getTargetType()` to recognize `techweek|` prefix
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (techweek handler, collision detection filter, getTargetType)
  - `client/src/hooks/useCalendarDnD.ts` (technicianUserId in CreateAssignmentParams + mutationFn)
  - `client/src/lib/calendarDiagnostics.ts` (techweek in DragLogData.targetType)

#### Calendar DnD DEV Instrumentation (2026-01-29)

- **Debug**: Added comprehensive DEV-only logging for drag-and-drop debugging
- **Instrumentation Added**:
  - `[DnD] onDragStart` - logs active.id, activeData, activeRect
  - `[DnD] onDragOver` - logs over.id when hovering valid targets
  - `[DnD] onDragEnd` - logs active.id, over.id, collisions array
  - `[DnD] Droppable containers` - logs counts by prefix (daily, allday, techweek, etc)
  - `[QuarterDropZone] isOver=true` - logs when 15-min drop zone is active
  - `[AllDayDropZone] isOver=true` - logs when all-day lane is active
  - `[TechWeekDropZone] isOver=true` - logs when tech week cell is active
  - `[UnassignedDayDropZone] isOver=true` - logs when unassigned row cell is active
- **Fixes Applied**:
  - Fixed QuarterDropZone z-index: always z-20, z-50 when hovered (was only z-5 when hovered)
  - Removed `flex flex-col` from quarter drop zone overlay (was potentially causing 0-height issues)
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (onDragStart, onDragOver, onDragEnd, customCollisionDetection logging)
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (QuarterDropZone, AllDayDropZone logging)
  - `client/src/components/calendar/CalendarGridWeekTechnicians.tsx` (TechnicianDayDropZone, UnassignedDayDropZone logging)

#### Calendar DnD Technician Assignment Bugs (2026-01-29)

- **Bug 1**: Tech Week View drops not working
  - **Symptom**: Drag from Unassigned → Technician, or Unscheduled → anywhere, did nothing
  - **Root Cause**: Early-return condition at line 592 was missing `!overId.startsWith('techweek|')` check
  - **Fix**: Added `techweek|` to the prefix whitelist in the early-return guard
- **Bug 2**: Day View drops not assigning technicians
  - **Symptom**: Drag Unscheduled → Technician column would schedule but leave job unassigned
  - **Root Cause**: `technicianUserId` was only passed in `isExistingCalendarAssignment` branch, not in unscheduled branches
  - **Fix**: Added `technicianUserId: technicianId !== 'unassigned' ? technicianId : null` to:
    - `allday|` (Day view all-day lane) - both unscheduled branches
    - `daily|` (Day view timed slots) - both unscheduled branches
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (handleDragEnd early-return condition + 4 mutation calls)

#### False Scheduling Conflict Errors (2026-01-29)

- **Bug 3**: Conflict check matching soft-deleted jobs
  - **Symptom**: "Technician is already scheduled for Job #X" error when scheduling to a valid slot
  - **Root Cause**: `validateSchedule` conflict query was not excluding soft-deleted jobs
  - **Fix**: Added `isNull(jobs.deletedAt)` to overlapConditions in calendarValidation.ts
- **Bug 4**: Self-conflict when scheduling unscheduled jobs
  - **Symptom**: Scheduling an unscheduled job could conflict with its own old schedule data
  - **Root Cause**: `excludeJobId` was not passed to validateSchedule in POST /schedule endpoint
  - **Fix**: Added `excludeJobId: data.jobId` to validateSchedule call in calendar.ts
- **Bug 5**: Missing onDragCancel handler
  - **Symptom**: If drag was cancelled (e.g., Escape key), activeId might not reset
  - **Fix**: Added onDragCancel handler to DndContext that resets activeId
- **Bug 6**: Day View cards "dead" (not clickable/draggable) in technician columns
  - **Symptom**: Cards under technicians couldn't be clicked or dragged
  - **Root Cause**: QuarterDropZone had `pointer-events-auto` which captured all pointer events
  - **Fix**: Changed to `pointer-events-none` in CalendarGridDayJobber.tsx (dnd-kit uses getBoundingClientRect for collision, not pointer events)
- **Bug 7**: Unscheduled → Unassigned threw validation error "Expected string, received null"
  - **Symptom**: Dropping to Unassigned column would error with technicianUserId null validation
  - **Root Cause**: scheduleJobSchema only had `.optional()`, not `.nullable()`
  - **Fix**: Added `.nullable()` to scheduleJobSchema and converted null → undefined for repository
- **Bug 8**: Week Tech View "flash to Unassigned" before settling on technician
  - **Symptom**: When dropping Unscheduled → Technician, job would briefly appear under Unassigned
  - **Root Cause**: Optimistic update for createAssignment was missing technician fields
  - **Fix**: Added optimisticTechFields to createAssignment onMutate in useCalendarDnD.ts
- **Bug 9**: Zod schema chain order causing validation errors
  - **Symptom**: "Expected string, received null" even with `.nullable()` in schema
  - **Root Cause**: `.optional().nullable()` order differs from `.nullable().optional()` in Zod type narrowing
  - **Fix**: Changed to `.nullable().optional()` consistently across all schemas (server + shared)
- **Bug 10**: False conflict always referencing same Job #10017
  - **Symptom**: Any timed drop would error with conflict against Job #10017 regardless of slot
  - **Root Cause**: All-day jobs (scheduledStart=midnight, scheduledEnd=23:59:59) overlap any timed event on same day
  - **Initial Fix**: Added `eq(jobs.isAllDay, false)` filter to conflict query in calendarValidation.ts
  - All-day and timed jobs use separate "lanes" and should not conflict with each other
  - Added DEV logging to validateSchedule for debugging conflict issues
- **Bug 11**: Formalized all-day ("Anytime") conflict semantics (2026-01-29)
  - **Symptom**: Initial Bug 10 fix globally filtered all-day jobs, missing all-day vs all-day conflicts
  - **Root Cause**: `eq(jobs.isAllDay, false)` filtered ALL all-day jobs from conflict check
  - **Expected Conflict Behavior**:
    - Timed vs Timed: CONFLICT (standard double-booking prevention)
    - Timed vs All-day: NO CONFLICT (Anytime jobs are non-blocking)
    - All-day vs Timed: NO CONFLICT (Anytime doesn't block timed)
    - All-day vs All-day: CONFLICT (one Anytime job per tech per day)
  - **Fixes**:
    - Added `isAllDay?: boolean` parameter to `ValidateScheduleOptions` interface
    - Conditional conflict query: timed input checks against timed jobs only; all-day input checks against all-day jobs only
    - Added `ANYTIME_JOB_EXISTS` error code for all-day vs all-day conflicts
    - Updated error message: "Technician already has an Anytime job scheduled for this day"
    - Updated POST /schedule route to pass `isAllDay` to `validateSchedule`
    - Added DEV-only `verifyConflictSemantics()` function documenting expected behavior matrix
- **Bug 12**: Day View using wrong date for unscheduled drops (2026-01-30)
  - **Symptom**: Unscheduled → Technician timed slot always errored with constant Job #10015 conflict
  - **Root Cause**: Day View `daily|` handler used `unscheduledItem.month ?? month` instead of `targetMo` from drop zone ID
  - **Fix**: Changed to use `targetMo` and `targetYr` extracted from droppable ID
  - **File**: `client/src/pages/Calendar.tsx` lines 1033-1034
- **Bug 13**: Technician → Unassigned snapback in Day View (2026-01-30)
  - **Symptom**: Dragging a job from a technician to Unassigned would snap back instead of unassigning
  - **Root Cause**: PATCH /schedule/:jobId converted `null` (explicit unassign) to `undefined` (no change) via `data.technicianUserId ?? undefined`
  - **Fix**: Changed to preserve null: `data.technicianUserId === undefined ? undefined : (data.technicianUserId ?? null)`
  - **Also**: Updated repository type signature to accept `string | null | undefined` for technicianUserId
  - **Files**: `server/routes/calendar.ts`, `server/storage/calendar.ts`
- **Bug 14**: POST /schedule also converting null to undefined (2026-01-30)
  - **Symptom**: Unscheduled → Unassigned would fail to schedule without technician
  - **Root Cause**: POST /schedule had same `data.technicianUserId ?? undefined` conversion as Bug 13
  - **Fix**: Changed to pass `data.technicianUserId` directly (repository handles both null and undefined correctly)
  - **Also**: Updated `scheduleJob` and `scheduleJobBypassWorkingHours` type signatures to accept `string | null`
  - **Files**: `server/routes/calendar.ts`, `server/storage/calendar.ts`
- **Files Modified**:
  - `server/services/calendarValidation.ts` (conditional conflict logic, ANYTIME_JOB_EXISTS code, verifyConflictSemantics)
  - `server/routes/calendar.ts` (pass isAllDay to validateSchedule, fix null handling in PATCH)
  - `server/storage/calendar.ts` (accept null in rescheduleJob type signature)
  - `shared/schema.ts` (added .nullable() to scheduleJobSchema)
  - `client/src/pages/Calendar.tsx` (added onDragCancel handler, fix Day View date bug)
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (pointer-events-none for QuarterDropZone)
  - `client/src/hooks/useCalendarDnD.ts` (optimisticTechFields in createAssignment onMutate)

### Added

#### Jobber-style Day View Grid (CalendarGridDayJobber)

- **Feature**: Replaced the Day view with a proper Jobber-style dispatch grid layout
- **Layout**:
  - Technician columns (Unassigned + each visible tech) with sticky headers
  - Time rail on the left (24 hours)
  - All-day/Anytime lane under header with proper droppable IDs
  - Visit count badges showing number of active visits per technician
  - Jobs positioned as blocks based on minutes-from-midnight, sized by duration
  - Events can span multiple hours visually
- **Drag/Drop**:
  - 15-minute drop zones throughout the grid
  - Drag between tech columns to reassign
  - Drag to all-day lane to schedule as all-day event
  - All-day lane droppable ID format: `allday|{techIdOrUnassigned}|{YYYY-MM-DD}`
- **Business Hours**:
  - Hours outside business hours greyed out (visual only, scheduling still allowed)
  - Auto-scroll to business hours start on mount
  - DEV badge showing current business hours for debugging
- **Files**:
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (NEW - main component)
  - `client/src/components/calendar/index.ts` (export new component)
  - `client/src/pages/Calendar.tsx` (wire up new component, add day-allday drop handling)
  - `client/src/lib/calendarDiagnostics.ts` (add 'day-allday' target type)

#### Calendar Drag & Drop Automated Tests

- **Feature**: Added comprehensive automated tests for calendar drag & drop operations
- **Tests cover**:
  - Schedule job (drag from unscheduled sidebar to calendar)
  - Reschedule job (drag to new date/time, different day)
  - Change technician (drag to different tech column)
  - Unassign technician (drag to "Unassigned" column)
  - Unschedule job (drag back to unscheduled sidebar)
  - Version mismatch handling (optimistic locking)
  - All-day event scheduling (schedule as all-day, convert timed↔all-day)
  - Combined operations (reschedule + reassign in single update)
- **All-day UTC helpers**: Added `createAllDayStartUTC()` and `createAllDayEndUTC()` helper functions to construct proper UTC timestamps for all-day events (avoids timezone issues with `setHours()`)
- **Files**:
  - `tests/calendar-drag-drop.test.ts` (NEW - 14 tests, all passing)

#### Company Business Hours (Table-backed) + Settings UI + Day View Integration

- **Feature**: Company-wide business hours stored per-tenant, one row per weekday (7 rows per company)
- **Database**: New `company_business_hours` table with columns:
  - `id` (UUID PK)
  - `company_id` (FK to companies)
  - `day_of_week` (0=Sunday...6=Saturday)
  - `is_open` (boolean)
  - `start_minutes`, `end_minutes` (minutes from midnight, 0-1440)
  - Constraints enforce closed days have null times, open days have valid times with end > start
- **Migration**: `migrations/2026_01_28_add_company_business_hours.sql`
  - Seeds defaults for existing companies: Mon-Fri 06:00-16:30, Sat-Sun closed
  - Idempotent via `ON CONFLICT DO NOTHING`
- **API Endpoints**:
  - `GET /api/company/business-hours` - Returns all 7 days
  - `PUT /api/company/business-hours` - Updates all 7 days (manager+ role required)
- **Settings UI**: New `/settings/business-hours` page with:
  - Open/closed toggle per day
  - Time pickers in 15-minute increments
  - Settings card added to main Settings page with clock icon
- **Day View Calendar Integration**:
  - Hours outside business hours are greyed out (subtle `bg-muted/40` background)
  - Auto-scroll to business start on mount (30 minutes padding)
  - Scheduling still allowed in grey hours (no enforcement)
- Files:
  - `migrations/2026_01_28_add_company_business_hours.sql` (NEW)
  - `shared/schema.ts` (companyBusinessHours table + types)
  - `server/storage/businessHours.ts` (NEW - repository)
  - `server/storage/index.ts` (register repository)
  - `server/routes/businessHours.ts` (NEW - API routes)
  - `server/routes/index.ts` (mount routes)
  - `client/src/pages/BusinessHoursSettingsPage.tsx` (NEW - settings UI)
  - `client/src/pages/SettingsPage.tsx` (add card)
  - `client/src/App.tsx` (add route)
  - `client/src/pages/Calendar.tsx` (fetch + pass business hours)
  - `client/src/components/calendar/CalendarGridDay.tsx` (grey-out + auto-scroll)

### Added

#### Hover preview on all calendar views

- **Feature**: Added consistent hover preview across all calendar views
- **Consistency**: Same hover preview dialog now appears everywhere:
  - Monthly view (fixed - CalendarEventChip now forwards ref and spreads props)
  - Weekly view (already had it)
  - Weekly technician view (NEW - added DraggableTechJobCard component)
  - Daily view (already had it)
- **Files changed**:
  - `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`:
    - Added `DraggableTechJobCard` component with `useDraggable` + `EventPreviewPopover`
    - Job cards are now draggable (were previously static divs)
    - Updated TechnicianDayDropZone and UnassignedDayDropZone to use new component
  - `client/src/components/calendar/CalendarEventChip.tsx`:
    - Convert to forwardRef to fix HoverCardTrigger compatibility
    - Accept and spread additional HTML props (onMouseEnter, onMouseLeave, etc.)
    - Merge external styles and className with internal ones

### Changed

#### Unified JobCard component for all calendar contexts

- **Refactor**: Created shared `JobCard` component used across all three job card contexts:
  - Scheduled timed jobs (via `ResizableJobCard` wrapper)
  - All-day jobs in the all-day lane
  - Unscheduled jobs in the sidebar
- **Benefits**:
  - Single source of truth for job card UI (hover preview, quick actions, styling)
  - Future changes automatically apply to all contexts
  - Reduced code duplication (~90 lines removed)
- **Component hierarchy**:
  - `JobCard` - Wraps `DraggableClient` with `EventPreviewPopover` and quick action buttons
  - `ResizableJobCard` - Uses `JobCard` internally, adds resize handle for timed events
  - All-day lane and unscheduled sidebar use `JobCard` directly
- **Files**:
  - `client/src/components/calendar/JobCard.tsx` (NEW - unified job card)
  - `client/src/components/calendar/ResizableJobCard.tsx` (refactored to use JobCard)
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (use JobCard for all-day lane)
  - `client/src/components/calendar/CalendarGridWeek.tsx` (use JobCard for all-day row)
  - `client/src/components/calendar/index.ts` (export JobCard)
  - `client/src/pages/Calendar.tsx` (use JobCard for unscheduled sidebar)

### Fixed

#### All-day cards missing job description text

- **Bug**: All-day job cards only showed client name, missing the job description/summary text that appears on timed job cards
- **Root cause**: `DraggableClient` only rendered the second line (summary/location) when `cardHeight > 28`, but all-day cards didn't pass a `cardHeight` prop
- **Fix**: Changed condition from `cardHeight && cardHeight > 28` to `cardHeight === undefined || cardHeight > 28` so the second line renders by default unless explicitly constrained by a small card height
- **Files changed**:
  - `client/src/components/calendar/DraggableClient.tsx` - Fix second line visibility condition

#### Unscheduled jobs missing hover preview and wrong click behavior

- **Bug**: Jobs in the Unscheduled sidebar didn't show the hover preview popover, and clicking them opened a different dialog instead of the Job Detail dialog
- **Root cause**: Unscheduled job rendering was missing `EventPreviewPopover` wrapper and using `setReportDialogClientId` instead of `handleClientClick`
- **Fix**:
  - Wrapped unscheduled `DraggableClient` with `EventPreviewPopover` for hover preview
  - Changed onClick handler to use `handleClientClick(clientData, item, true)` which opens JobDetailDialog focused on schedule section
- **Files changed**:
  - `client/src/pages/Calendar.tsx` - Import EventPreviewPopover, wrap unscheduled items, fix click handler

#### All-day job cards missing quick action buttons

- **Bug**: All-day job cards in the day view didn't have the reschedule/unschedule quick action buttons that timed job cards have
- **Fix**: Created `AllDayJobCard` component that matches `ResizableJobCard` functionality (minus resize handle):
  - Hover preview via `EventPreviewPopover`
  - Quick action buttons on hover (reschedule, unschedule)
  - Same visual styling as timed job cards for consistency
- **Files changed**:
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` - Add `AllDayJobCard` component, use it in all-day lane

#### Technician assignment from calendar failing with "Required at 'version'" validation error

- **Bug**: Assigning a technician to a job from the calendar page failed with validation error because the API requires a `version` field for optimistic locking, but the client wasn't sending it
- **Root cause**: The `assignTechnicians.mutate()` calls weren't including the job's version field
- **Fix**:
  - Added `technicianUserId` field to `UpdateAssignmentParams` interface in `useCalendarDnD.ts`
  - Updated `updateAssignment` mutation to include `technicianUserId` in the API payload
  - Updated drag/drop handlers to include `technicianUserId` in the update mutation (single atomic call instead of two separate calls)
  - Updated `onAssignTechnicians` callback to pass version from `selectedAssignment`
- **Files changed**:
  - `client/src/hooks/useCalendarDnD.ts` - Add technicianUserId to UpdateAssignmentParams and mutation payload
  - `client/src/pages/Calendar.tsx` - Update drag/drop handlers and JobDetailDialog callback

#### Version error flash + double API call when assigning technician from JobDetailDialog

- **Bug**: When assigning a technician from the job detail dialog, there was a brief flash of "Required at 'version'" error, but the assignment would then succeed
- **Root cause**: `handleTechnicianToggle` in JobDetailDialog was making TWO API calls:
  1. `assignTechnicianMutation.mutate()` - without version field (caused error)
  2. `onAssignTechnicians()` callback - triggered a second call from Calendar.tsx (with version, succeeded)
- **Fix**:
  - Added `version` field to `assignTechnicianMutation` in JobDetailDialog (now included in API payload)
  - Removed redundant `onAssignTechnicians` callback call - the internal mutation now handles everything
- **Files changed**:
  - `client/src/components/JobDetailDialog.tsx` - Add version to mutation, remove duplicate callback

#### Cannot unassign technician (move job to "Unassigned" column)

- **Bug**: Dragging a job to the "Unassigned" column in day view didn't actually remove the technician assignment
- **Root cause**: When `technicianId === 'unassigned'`, the code set `technicianUserId: undefined` which meant it wasn't included in the API payload at all
- **Fix**: Changed `undefined` to `null` when unassigning - `null` explicitly tells the server to remove the technician
- **Files changed**:
  - `client/src/pages/Calendar.tsx` - Change `technicianUserId: undefined` to `technicianUserId: null` for unassign case

#### Calendar drag/drop feels sluggish (waiting for API response)

- **Bug**: Moving jobs on the calendar felt slow because the UI waited for the API response before updating
- **Root cause**:
  - `onSuccess` handlers used `await refetchCalendar()` which blocked the toast until refetch completed
  - `updateAssignment.onMutate` didn't update technician fields in optimistic update
  - `createAssignment.onMutate` didn't remove jobs from unscheduled sidebar optimistically
- **Fix**: Improved optimistic updates for instant visual feedback:
  - **updateAssignment**: Now includes technician fields (`assignedTechnicianId`, `assignedTechnicianIds`) in optimistic update for instant technician changes
  - **createAssignment**: Now removes job from unscheduled sidebar immediately when scheduling, includes client metadata for visual display
  - **All mutations**: Show success toast immediately, refetch calendar in background without blocking
  - Proper rollback on error restores both calendar and unscheduled sidebar state
- **Files changed**:
  - `client/src/hooks/useCalendarDnD.ts` - Enhanced optimistic updates and async refetch

#### Remove legacy `assignment.year`/`assignment.month` fallbacks causing "Invalid time value" errors

- **Bug**: JobDetailDialog and other components crashed with "Invalid time value" when using legacy fallback `${assignment.year}-${assignment.month}-01` because these fields no longer exist in canonical model
- **Fix**: Replaced all references to `assignment.year`, `assignment.month`, `assignment.day` with canonical date fields (`scheduledDate`, `date`, or parsed from `startAt`)
- **Files changed**:
  - `client/src/components/JobDetailDialog.tsx` - Remove legacy fallback in "Created" display
  - `client/src/pages/Calendar.tsx` - Update `calculatePartsWithDates`, `allWeekEvents` filter, old items dialog, unscheduled sidebar
  - `client/src/App.tsx` - Update `totalOverdueCount` filter for unscheduled backlog
- **Note**: The normalized `CalendarEvent` type still has `year`/`month`/`day` fields (these are derived from canonical fields during normalization and are valid)

#### Day View calendar crash due to UUID delimiter collision

- **Bug**: Day View calendar crashed in development mode when technicians had UUID IDs
- **Root cause**: Droppable IDs used `-` as delimiter (e.g., `daily-a20dcc3d-d306-49a8-8b2a-c26838f43069-0-0-28-0-2026`), but UUIDs also contain dashes. When split by `-`, this produced 11 segments instead of the expected 7, triggering a validation error.
- **Fix**: Changed delimiter from `-` to `|` for all calendar droppable IDs (daily, weekly, allday, techweek). Now IDs like `daily|a20dcc3d-d306-49a8-8b2a-c26838f43069|0|0|28|0|2026` split correctly into 7 segments.
- **Change scope**:
  - ID builders in `CalendarGridDay.tsx`, `CalendarGridWeek.tsx`, `CalendarGridWeekTechnicians.tsx`
  - ID parsers in `Calendar.tsx`
  - Collision detection and target type detection in `Calendar.tsx`
- Files: `client/src/components/calendar/CalendarGridDay.tsx`, `client/src/components/calendar/CalendarGridWeek.tsx`, `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`, `client/src/pages/Calendar.tsx`

#### All-day constraint violation on Jobs API write paths

- **Bug**: `POST /api/jobs` and `PATCH /api/jobs/:id` could violate the `jobs_all_day_end_2359_check` PostgreSQL CHECK constraint when creating or updating all-day jobs
- **Root cause**: The Jobs storage layer (`createJob()`, `updateJob()`) did not call `sanitizeAllDayTimestamps()` before DB writes. The node-pg driver serializes JavaScript Date objects using local-timezone getters, which can produce incorrect timestamp values on non-UTC servers — breaking the constraint that requires `scheduledEnd` to be exactly `23:59:59` for all-day events
- **Fix**: Extracted `sanitizeAllDayTimestamps()`, `forceUTCTimestamp()`, and `assertAllDayUTCBoundaries()` from `server/storage/calendar.ts` into a shared utility (`server/utils/allDaySanitizer.ts`). Both calendar and jobs storage layers now import from the same utility. Added sanitization calls in `createJob()` and `updateJob()` right before the DB write.
- Files: `server/utils/allDaySanitizer.ts` (NEW), `server/storage/calendar.ts`, `server/storage/jobs.ts`

#### Timezone confirmation modal can't be dismissed (Prompt 5)

- **Bug**: After confirming timezone, the modal showed "saved" toast but stayed open, blocking the app
- **Root cause**: `invalidateQueries` triggers a background refetch; stale cache data (`timezoneConfirmed: false`) kept the modal visible during the refetch window
- **Fix**: Optimistically update the company settings cache via `queryClient.setQueryData` immediately on mutation success, setting `timezoneConfirmed: true` before the background refetch completes. Added `justConfirmed` local guard as a belt-and-suspenders defense against any stale-data flicker.
- Files: `client/src/components/TimezoneSetupDialog.tsx`

#### Timezone banner not dismissing after Regional Settings save (Prompt 6)

- **Bug**: Yellow "Set your company timezone" banner stayed visible after saving timezone in Regional Settings
- **Root cause**: Same stale-cache pattern — `RegionalSettingsPage` mutation only called `invalidateQueries` (background refetch) without optimistically updating the cache. Banner read stale `timezoneConfirmed: false` during the refetch window.
- **Fix**: Added `queryClient.setQueryData` in `RegionalSettingsPage` mutation `onSuccess` to immediately merge the server response (which includes `timezoneConfirmed: true`) into the cache. Banner and dialog both react instantly.
- Files: `client/src/pages/RegionalSettingsPage.tsx`

### Added

#### Taxes v1 Polish: Deletion Semantics + Invoice Consistency (Prompt 4)

- **`invoice_tax_lines` snapshot table**: New table freezes tax group composition at invoice creation time. Stores one row per component rate (e.g., GST 5% + PST 7% = 2 rows) with snapshotted rate name, percentage, taxable amount, and computed tax amount. Later edits to rates/groups do NOT affect historical invoices.
- **Tax DELETE hardening**: `DELETE /api/tax/:id` and `DELETE /api/tax/groups/:id` now check if the rate/group is referenced by any invoice (via `invoice_tax_lines` or `invoices.taxGroupId`). Always soft-deletes (sets `active=false`). Returns friendly message: "Deactivated because it's used on invoices. Historical invoices are unaffected."
- **Default group uniqueness**: `createTaxGroup`, `updateTaxGroup`, and `setDefaultTaxGroup` now use `SELECT FOR UPDATE` locking to prevent concurrent default assignment races (complements the partial unique index in PostgreSQL)
- **Invoice creation snapshots tax composition**: `POST /api/invoices/from-job/:jobId` now inserts `invoice_tax_lines` rows when applying the default tax group, freezing each rate's name, percentage, and computed tax amount
- **Migration**: `migrations/2026_01_28_add_invoice_tax_lines.sql`
- Files: `shared/schema.ts`, `server/storage/tax.ts`, `server/routes/tax.ts`, `server/routes/invoices.ts`

#### Timezone Required During Onboarding (Prompt 2 — onboarding gate)

- **Schema**: Added `timezoneConfirmedAt` timestamp column to `companySettings` (null = never confirmed)
- **Server**: `GET /api/company-settings` now includes `timezoneConfirmed` boolean derived from `timezoneConfirmedAt`
- **Server**: `PUT /api/company-settings` auto-stamps `timezoneConfirmedAt` when `timezone` field is included
- **Calendar API**: `GET /api/calendar` response now includes `timezoneConfirmed` flag; still returns fallback timezone when unconfirmed
- **TimezoneSetupDialog**: Blocking modal shown to owner/admin/manager roles when `timezoneConfirmed` is false; prefills from browser `Intl.DateTimeFormat`; cannot be dismissed without confirming
- **TimezoneSetupBanner**: Persistent amber banner shown globally when timezone is unconfirmed, linking to Regional Settings
- **Migration**: `migrations/2026_01_28_add_timezone_confirmed_at.sql`
- Files: `shared/schema.ts`, `server/routes/companySettings.ts`, `server/routes/calendar.ts`, `client/src/components/TimezoneSetupDialog.tsx`, `client/src/components/TimezoneSetupBanner.tsx`, `client/src/App.tsx`

#### Regional Settings Integration into Calendar UI (Prompt 3)

- **`useCompanyRegionalSettings()` hook**: New hook in `client/src/hooks/useCompanyRegionalSettings.ts` reads timezone, dateFormat, timeFormat, weekStartsOn from `/api/company-settings` with 5-minute cache; exports `nowInTimezone()` and `formatHourLabel()` helpers
- **Shared `TIMEZONE_OPTIONS`**: Consolidated into `client/src/lib/regionalConstants.ts` (superset of both previous lists); `RegionalSettingsPage.tsx` and `TimezoneSetupDialog.tsx` now import from shared constant
- **Calendar week/month views respect `weekStartsOn`**: `getWeekStart(date, weekStartsOn)` used in all 5 call sites (Calendar.tsx, CalendarGridWeek, CalendarGridWeekTechnicians, CalendarHeader, parts dialog); month grid day headers reorder to Mon-Sun or Sun-Sat; `firstDayOfMonth` offset adjusted for Monday-start grids
- **Calendar hour labels respect `timeFormat`**: CalendarGridWeek, CalendarGridDay, and CalendarHeader start-hour dropdown use `formatHourLabel(hour, timeFormat)` instead of inline 12h ternaries
- **Calendar "today" and "now" line use company timezone**: `nowInTimezone(tz)` replaces `new Date()` in CalendarGridWeek, CalendarGridDay, and CalendarGridWeekTechnicians for today highlight and current-time indicator
- **`timeFormat` threaded to event time display**: EventPreviewPopover, DraggableClient, and ResizableJobCard pass `timeFormat` to `formatTimeFromMinutes()` calls
- **Removed deprecated `getMondayOfWeek()`**: All callers migrated to `getWeekStart(date, weekStartsOn)`
- Files: `client/src/lib/regionalConstants.ts` (NEW), `client/src/hooks/useCompanyRegionalSettings.ts` (NEW), `client/src/pages/Calendar.tsx`, `client/src/components/calendar/calendarUtils.ts`, `client/src/components/calendar/CalendarHeader.tsx`, `client/src/components/calendar/CalendarGridWeek.tsx`, `client/src/components/calendar/CalendarGridDay.tsx`, `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`, `client/src/components/calendar/CalendarGridMonth.tsx`, `client/src/components/calendar/EventPreviewPopover.tsx`, `client/src/components/calendar/DraggableClient.tsx`, `client/src/components/calendar/ResizableJobCard.tsx`, `client/src/pages/RegionalSettingsPage.tsx`, `client/src/components/TimezoneSetupDialog.tsx`

#### Company Regional Settings (Prompt 2)

- **Schema**: Added `dateFormat`, `timeFormat`, `weekStartsOn` columns to `companySettings` table
  - `dateFormat`: `"MM/DD/YYYY"` | `"DD/MM/YYYY"` | `"YYYY-MM-DD"` (default: `"MM/DD/YYYY"`)
  - `timeFormat`: `"12h"` | `"24h"` (default: `"12h"`)
  - `weekStartsOn`: `"monday"` | `"sunday"` (default: `"monday"`)
- **Zod validation**: Added regional fields to `updateCompanySettingsSchema` in `server/routes/companySettings.ts`
- **Calendar timezone fix**: `buildRangeResponse()` in `server/routes/calendar.ts` now returns company timezone from settings instead of server process timezone (`getServerTimezone()` removed as dead code)
- **Calendar utils**: `formatTimeFromMinutes()` now accepts `timeFormat` parameter for 12h/24h display; `getWeekStart()` replaces `getMondayOfWeek()` with `weekStartsOn` support (legacy `getMondayOfWeek()` retained as deprecated alias)
- **Regional Settings page**: New `client/src/pages/RegionalSettingsPage.tsx` with Timezone, Date/Time Format, and Week Start selectors
- **Route registered**: `/settings/regional` in `client/src/App.tsx`, accessible from Settings page via Globe icon card
- **Migration**: `migrations/2026_01_28_add_regional_settings.sql`
- Files: `shared/schema.ts`, `server/routes/companySettings.ts`, `server/routes/calendar.ts`, `client/src/pages/RegionalSettingsPage.tsx`, `client/src/pages/SettingsPage.tsx`, `client/src/App.tsx`, `client/src/components/calendar/calendarUtils.ts`

#### Tax Settings v1: Multi-Tax Rates & Groups (Prompt 3)

- **3 new DB tables**:
  - `company_tax_rates` — Individual tax rates (e.g., GST 5%, PST 7%, HST 13%)
  - `company_tax_groups` — Composable groups (e.g., "GST+PST" = 12%)
  - `company_tax_group_rates` — Junction table linking groups to rates
  - Partial unique index: one default group per company
- **Invoice integration**: Added `taxGroupId` column to `invoices` table (nullable, FK to `company_tax_groups`)
- **Storage layer**: `server/storage/tax.ts` — full CRUD repository for rates, groups, and default group management
- **API routes**: `server/routes/tax.ts` mounted at `/api/tax` — CRUD endpoints for rates (`GET/POST/PUT/DELETE`) and groups (`GET/POST/PUT/DELETE /groups`, `POST /groups/:id/set-default`)
- **Invoice line tax application**: When creating an invoice from a job, the default tax group's combined rate is automatically applied to all line items
- **`updateInvoiceLine`**: New storage method for updating individual invoice line fields (used by tax integration)
- **TaxBillingRulesPage**: Replaced "Coming Soon" placeholder with full CRUD UI for tax rates and tax groups, including add/edit/delete dialogs, rate composition checkboxes, combined rate display, and default group toggle
- **Migration**: `migrations/2026_01_28_add_tax_rates_and_groups.sql`
- Files: `shared/schema.ts`, `server/storage/tax.ts`, `server/storage/invoices.ts`, `server/storage/index.ts`, `server/routes/tax.ts`, `server/routes/index.ts`, `server/routes/invoices.ts`, `client/src/pages/TaxBillingRulesPage.tsx`

### Fixed

#### All-day scheduling UTC timestamp hardening (Prompt 1 regression guard)
- Added `assertAllDayUTCBoundaries()` DEV-only assertion in `server/storage/calendar.ts`
  - Validates ISO start ends with `T00:00:00.000Z` and end with `T23:59:59.000Z` before SQL cast
  - Emits `[ALLDAY ASSERT FAIL]` console error if domain layer produces bad boundaries
  - Runs inside `sanitizeAllDayTimestamps()` before Date→SQL replacement
- Updated DEV log to use `scheduledStartIso` / `scheduledEndIso` field names for clarity
- Existing hardening already in place: `forceUTCTimestamp()`, `sanitizeAllDayTimestamps()`, calls in all 4 write paths (`scheduleJob`, `rescheduleJob`, `scheduleJobBypassWorkingHours`, `rescheduleJobBypassWorkingHours`)
- Files: `server/storage/calendar.ts`

#### Fix jobs_all_day_end_2359_check constraint violation on all-day scheduling
- **Root cause**: `timestamp without time zone` columns + node-pg Date
  serialization. The pg driver serializes Date objects using LOCAL time
  (`date.getHours()`, etc.), not UTC. PostgreSQL strips the timezone offset
  for `timestamp` columns and stores the local representation. When the
  server process isn't in UTC, `23:59:59.000Z` gets stored as e.g.
  `18:59:59` (EST), failing the `AT TIME ZONE 'UTC'` check constraint.
- **Fix**: Added centralized `sanitizeAllDayTimestamps()` helper in the
  storage layer that replaces Date objects with UTC-safe SQL expressions
  (`date.toISOString()::timestamp`) before every DB write. PostgreSQL
  ignores the Z suffix for `timestamp` columns, storing the literal UTC
  time values — guaranteeing 00:00:00 start and 23:59:59 end.
- **Coverage**: Applied to all 4 storage write paths: `scheduleJob`,
  `scheduleJobBypassWorkingHours`, `rescheduleJob`,
  `rescheduleJobBypassWorkingHours`.
- **DEV log**: `[SCHEDULE ALLDAY]` emitted at both the route handler and
  storage layer before DB write, logging jobId, date, scheduledStart, and
  scheduledEnd ISO strings.
- Files: `server/storage/calendar.ts`, `server/routes/calendar.ts`

#### Eliminate useSortable for unscheduled cards — fix silent drag failures
- **Root cause**: `useSortable` internally registers both a draggable AND a
  droppable, and its SortableContext lookup silently fails for items whose IDs
  don't match the context array (e.g., after optimistic dedup or id mutation).
  This left specific cards (e.g., Basil Box) with inert listeners — pointerdown
  reached the draggable root but the sensor never activated, triggering the
  `[DRAG-WARN] pointerdown without drag-start within 250ms` diagnostic.
- **Fix**: Replaced all `useSortable` usage with a single unconditional
  `useDraggable` call for ALL items (both calendar and unscheduled). No sentinel
  IDs needed. No SortableContext dependency for individual items.
- **Drag rules (Model A)**: Draggable UNLESS `DRAG_ENABLED` is false OR
  `isSaving` is true. No legacy overdue/assigned/status checks — server rejects
  invalid drops.
- **DEV `[UNSCHED-DRAG]` logging**: Every unscheduled card render logs jobId,
  clientName, disabled state, reason, status, openSubStatus, version,
  scheduledStart, scheduledEnd, deletedAt, and listener info.
- **`rawItem` prop**: Calendar.tsx now passes `rawItem={item}` to DraggableClient
  for comprehensive DEV diagnostic logging.
- Files: `client/src/components/calendar/DraggableClient.tsx`,
  `client/src/pages/Calendar.tsx`, `client/src/components/UnscheduledJobsSidebar.tsx`

#### Fix unscheduled cards that won't drag (conditional hooks violation)
- **Eliminated conditional hook calls**: `DraggableClient.tsx` previously used
  `inCalendar ? useDraggable() : null` and `!inCalendar ? useSortable() : null`,
  violating React's rules of hooks. Under StrictMode or concurrent features,
  some card instances could get mismatched hook state, causing listeners to
  silently vanish (explaining why cards #2 and #4 specifically failed while
  others worked). Both hooks are now called unconditionally every render;
  the unused hook receives a sentinel ID (`__noop_drag_` / `__noop_sort_`
  prefix) so dnd-kit doesn't register conflicting draggable/sortable entries.
- **Cursor-grab on unscheduled cards**: `getCursorStyle()` was previously
  gated behind `${inCalendar ? getCursorStyle() : ""}`, giving unscheduled
  cards no grab cursor. Now applied unconditionally to all draggable cards.
- **DEV `onPointerDownCapture` diagnostic**: Unscheduled cards now log
  `[UNSCHEDULED pointerdown root]` with jobId, disabled state, reason, and
  target element info on every pointerdown in development mode.
- **Pointer guards on unscheduled interactive children**: Saving spinner
  (`Loader2`) and hidden-technician warning (`AlertTriangle`) now have
  `onPointerDown`/`onMouseDown` stopPropagation to prevent stealing drag.
- **Click handling fix**: Removed `inCalendar` gate from click predicate —
  unscheduled cards now properly fire their `onClick` callback.
- **data-testid consistency**: Unscheduled card testid changed from
  `unscheduled-client-${client.id}` to `unscheduled-client-${id}` to match
  the drag ID used by dnd-kit.
- Files: `client/src/components/calendar/DraggableClient.tsx`

#### Drag-start reliability hardening (Calendar + Unscheduled sidebar)
- **Drag listeners moved to root element**: In `DraggableClient.tsx`, moved
  `{...listeners}` from a nested child `<div>` to the root draggable container.
  Previously, padding around the inner div created dead zones where pointerdown
  missed the sensor entirely. Also added `touchAction: "none"` to prevent
  browser gestures from competing with drag.
- **CalendarEventChip touchAction**: Added `touchAction: "none"` to the chip
  root style to prevent mobile scroll/gesture interference.
- **Interactive children pointer guards**: Added `onPointerDown` and
  `onMouseDown` with `stopPropagation()` to all interactive children inside
  draggable cards: remove buttons and "+N more" PopoverTrigger in
  `CalendarGridMonth.tsx`, reschedule/unschedule quick-action buttons in
  `ResizableJobCard.tsx`. Prevents these elements from swallowing the
  pointer event before the drag sensor sees it.
- **Sensor distance reduced to 3px**: `PointerSensor` activation constraint
  in `Calendar.tsx` reduced from `distance: 5` to `distance: 3` for more
  responsive first-attempt drag activation.
- **DEV-only missed-drag diagnostic**: Calendar now monitors `pointerdown`
  events on draggable elements and logs `[DRAG-WARN] pointerdown without
  drag-start within 250ms` if the drag sensor doesn't fire. Timer is cleared
  on successful `handleDragStart`. Only active in development mode.
- Files: `client/src/components/calendar/DraggableClient.tsx`,
  `client/src/components/calendar/CalendarEventChip.tsx`,
  `client/src/components/calendar/CalendarGridMonth.tsx`,
  `client/src/components/calendar/ResizableJobCard.tsx`,
  `client/src/pages/Calendar.tsx`

#### Minute-precision diagnostic logging + canonical startMinutes derivation
- **DEV-only `[DROP]` logging**: `handleDragEnd` in `Calendar.tsx` now logs
  intended hour:minute for weekly- and daily- timed targets before firing
  mutations. Log format: `[DROP] weekly timed target: { intendedHour, intendedMinute, targetDay, ... }`.
- **DEV-only `[DROP-RESULT]` logging**: `createAssignment.onSuccess` and
  `updateAssignment.onSuccess` in `useCalendarDnD.ts` now capture and log
  the mutation result: `[DROP-RESULT] { jobId, serverStartAt, serverEndAt, serverVersion }`.
  Previously the result was discarded as `_`.
- **`getAssignmentStartMinutes()` canonical derivation**: Now prefers `startAt`
  (or `scheduledStart`) ISO datetime to derive minutes-from-midnight, falling
  back to legacy `scheduledHour`/`scheduledStartMinutes` only when no ISO
  field exists. Prevents stale minute values after `toCanonicalEvent()` or
  `canonicalizeCalendarCache()` updates the raw event's `startAt` but not the
  legacy fields. Affects time labels in `DraggableClient`, `ResizableJobCard`,
  `EventPreviewPopover`, and lane calculation in `calculateLanes`.
- **UI rounding audit**: Confirmed `formatTimeFromMinutes()` uses `minutes % 60`
  with `padStart(2, '0')` — no `Math.floor`/`Math.round` on the minute value.
  No rounding issues found in the display pipeline.
- Files: `client/src/pages/Calendar.tsx`, `client/src/hooks/useCalendarDnD.ts`,
  `client/src/components/calendar/calendarUtils.ts`

#### Calendar minute-precision contract: strict timed drop-target parsing
- **Strict timed-target validation in `handleDragEnd`**: `weekly-` and `daily-`
  target IDs now reject drops with missing/NaN minute or hour segments. On
  invalid parse: `console.error` with full target ID, abort mutation, show
  user toast "Invalid drop target time. Please refresh." No silent fallback to
  minute=0. (`client/src/pages/Calendar.tsx`)
- **DEV-only QuarterDropZone segment assertions**: In development mode,
  `QuarterDropZone` in `CalendarGridWeek.tsx` asserts `weekly-` IDs have
  exactly 5 segments; in `CalendarGridDay.tsx` asserts `daily-` IDs have
  exactly 7 segments. Throws `Error("Timed droppable id missing minutes: …")`
  on violation — catches regressions at render time before any drop occurs.
- **Audit confirmed**: All timed slot ID generators already emit minute
  segments via `[0, 15, 30, 45].map()` in `QuarterDropZone`. No legacy
  hourly-only IDs exist. `CalendarGridWeekTechnicians.tsx` uses `techweek-`
  prefix (day-level, not timed) — no change needed.
- Files: `client/src/pages/Calendar.tsx`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Single canonical overdue predicate: calendar delegates to shared isJobOverdue()
- **Deleted duplicate overdue rules**: Removed `isEventOverdue()` (local multi-
  fallback logic) and `isOverdueDate()` (deprecated scheduledDate check) from
  `calendarUtils.ts`. Calendar now uses one thin adapter `isCalendarEventOverdue()`
  that maps CalendarEvent fields to the canonical `isJobOverdue()` from
  `shared/schema.ts`. Overdue is derived from `status + scheduledStart/scheduledEnd
  + durationMinutes` only — no `completed` flag, no `scheduledDate` fallback.
- **CalendarGridMonth.tsx**: Removed local day-level `dayDate < today` overdue
  variable. All 4 `!event.completed && isOverdue` checks replaced with
  `isCalendarEventOverdue(event)`.
- **CalendarGridWeek.tsx**: 2 overdue checks → `isCalendarEventOverdue(event)`.
- **CalendarGridDay.tsx**: 3 overdue checks → `isCalendarEventOverdue(event)`.
- Files: `client/src/components/calendar/calendarUtils.ts`,
  `client/src/components/calendar/CalendarGridMonth.tsx`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Model A cache normalization + eliminate remaining assignments-only cache writes
- **`canonicalizeCalendarCache()` post-refetch**: All four `onSuccess` handlers
  that `await refetchCalendar()` (schedule, reschedule, resize, unschedule) now
  call `canonicalizeCalendarCache()` immediately after. This ensures fresh server
  responses (which may use `scheduledStart`/`scheduledEnd`) are patched to
  `{ startAt, endAt }` in the React Query cache before any downstream code reads
  them. (`client/src/hooks/useCalendarDnD.ts`)
- **TechnicianDashboard Model A naming**: Renamed `allAssignments` → `allEvents`
  to match Model A terminology; month merge already used
  `events ?? assignments` fallback. (`client/src/pages/TechnicianDashboard.tsx`)
- **`isEventOverdue()` replaced scheduledDate-based checks**: (Now superseded
  by `isCalendarEventOverdue()` above.)
- Files: `client/src/hooks/useCalendarDnD.ts`,
  `client/src/pages/TechnicianDashboard.tsx`,
  `client/src/components/calendar/calendarUtils.ts`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Calendar minute-precision + time-field canonicalization (finish pass)
- **`toCanonicalEvent()` helper**: Added to `useCalendarDnD.ts` — maps
  `scheduledStart→startAt` and `scheduledEnd→endAt` on any raw or optimistic
  event written to React Query cache. Applied in both `createAssignment.onMutate`
  and `updateAssignment.onMutate` optimistic writes.
- **Defensive overdue date parsing**: Added `isOverdueDate()` helper to
  `calendarUtils.ts` using `toValidDate()` instead of raw `new Date()`.
  Replaced all `new Date(event.scheduledDate) < new Date()` calls in
  `CalendarGridWeek.tsx` (2 occurrences) and `CalendarGridDay.tsx`
  (3 occurrences) to prevent "Invalid time value" crashes.
- **Drop-target minute parsing verified**: Weekly drop zones produce
  `weekly-{day}-{hour}-{minute}-{dayNumber}` and daily zones produce
  `daily-{tech}-{hour}-{minute}-{day}-{month}-{year}`, both correctly parsed
  in `Calendar.tsx` `handleDragEnd`. No code changes needed.
- Files: `client/src/hooks/useCalendarDnD.ts`,
  `client/src/components/calendar/calendarUtils.ts`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Calendar UX + correctness hardening (Model A)
- **Drop-time minutes preserved**: Optimistic updates in `useCalendarDnD.ts` now
  compute and include canonical `startAt`/`endAt` ISO strings so
  `normalizeAssignments()` picks up exact drop coordinates (12:45 stays 12:45,
  not rounded to 12:00). Mutation responses normalized scheduledStart→startAt.
- **"Invalid time value" eliminated**: `normalizeAssignments()` in
  `calendarUtils.ts` now patches `raw` to always carry `startAt`/`endAt`, even
  when the source event only has `scheduledStart`/`scheduledEnd`.
- **Unscheduled sidebar shows client + summary**: `getUnscheduledCompanyName()`
  now checks `customerCompanyName` (the actual API field); `DraggableClient`
  accepts and displays `summary` prop on unscheduled cards.
- **Drag activation improved**: `PointerSensor` distance reduced from 8→5 for
  more responsive first-attempt drag starts.
- Files: `client/src/hooks/useCalendarDnD.ts`, `client/src/pages/Calendar.tsx`,
  `client/src/components/calendar/DraggableClient.tsx`,
  `client/src/components/calendar/calendarUtils.ts`

#### All-Day CHECK constraints: evaluate times in UTC (timestamptz-safe)
- `EXTRACT(HOUR/MINUTE/SECOND FROM timestamptz)` uses session timezone, not UTC;
  UTC values (00:00:00Z / 23:59:59Z) can fail in non-UTC sessions
- Recreated `jobs_all_day_start_midnight_check` and `jobs_all_day_end_2359_check`
  with `AT TIME ZONE 'UTC'` so EXTRACT always evaluates against UTC
- Changed guard from `is_all_day = false OR ... IS NULL` to
  `is_all_day IS DISTINCT FROM TRUE` (NULL-safe, same semantics via CHECK NULL pass-through)
- Migration: `migrations/2026_01_27_fix_all_day_constraints_utc.sql`
- Drizzle schema updated: `shared/schema.ts` (check definitions match migration)

#### Calendar Diagnostics: 4xx/5xx errors now correctly classified as failures
- `addDiagEntry()` auto-derives `isFail: true` when `type` ends with `-error`,
  `type === 'invariant-fail'`, or `data.status >= 400`
- Previously `logMutationError` emitted `{ type: "mutation-error", status: 500, isFail: false }`
- `invariantFailures` count in `generateReport()` now increments for all failures
- File: `client/src/lib/calendarDiagnostics.ts`

#### All-Day Scheduling: Eliminate duplicate normalization causing DB constraint violations

- **Symptom:** `POST /api/calendar/schedule` with `{ allDay: true, date }` sometimes
  throws `violates check constraint "jobs_all_day_end_2359_check"`.
- **Root cause:** Storage layer had duplicate all-day normalization blocks that
  could diverge from the canonical `normalizeScheduleTimes()` helper. Both
  `scheduleJob()` and `rescheduleJob()` re-derived timestamps after the domain
  layer had already computed them, and bypass functions used inline derivation
  instead of the shared helper.
- **Fix: Single helper, single code path** — `normalizeScheduleTimes()` in
  `server/domain/scheduling.ts` is now the only place that computes all-day
  boundaries (`00:00:00.000Z` start, `23:59:59.000Z` end).
- **Storage layer cleaned** (`server/storage/calendar.ts`):
  - Removed duplicate all-day blocks from `scheduleJob()` and `rescheduleJob()`
    (domain layer's `applyJobSchedulingPatch` already normalizes)
  - Replaced inline normalization in `scheduleJobBypassWorkingHours()` and
    `rescheduleJobBypassWorkingHours()` with `normalizeScheduleTimes()` calls
- **Assertion tightened** (`server/domain/scheduling.ts`):
  - `assertAllDayTimestampInvariant()` no longer accepts next-day midnight;
    only `23:59:59` on the same day is valid, matching DB constraint exactly
- **Client fix** (`client/src/lib/jobScheduling.ts`):
  - `createJobWithSchedule()` now uses `T23:59:59.000Z` for all-day end
    instead of next-day midnight (`T00:00:00.000Z` of day+1)

#### All-Day Scheduling: Original normalizeScheduleTimes helper (prior session)

- **Created `normalizeScheduleTimes()` helper** (`server/domain/scheduling.ts`):
  - Single source of truth for computing scheduledStart/scheduledEnd from route input
  - All-day: `00:00:00.000Z` start, `23:59:59.000Z` end (zero milliseconds)
  - Timed: start from startAt, end from endAt or start + durationMinutes (default 60)
  - Used by both POST /api/calendar/schedule and PATCH /api/calendar/schedule/:jobId
- **Fixed `deriveScheduleFields()`** to delegate all-day computation to `normalizeScheduleTimes()`
- **Route handlers refactored** (`server/routes/calendar.ts`):
  - Replaced inline time computation with `normalizeScheduleTimes()` calls
  - Both POST and PATCH endpoints now go through the same normalization

#### Calendar Page: Fix crash from outdated API contract

- **Updated `client/src/pages/Calendar.tsx`** to read `events` field from server response
  instead of legacy `assignments` field, matching `CalendarRangeResponseDto`.
- Backward-compatible fallback: `data?.events ?? data?.assignments` during transition.
- Renamed variables: `rawAssignments` → `rawEvents`, outer `assignments` → `events`,
  inner `events` (in useMemo) → `normalized` to avoid shadowing.
- Updated all 12+ call sites (`events.some(...)`, `events.find(...)`, `events.filter(...)`)
  in drag handlers, active client lookup, and parts calculation.
- Added `v.events` check to `normalizeArray` utility (before legacy `v.assignments` fallback).
- Updated dev assertion error message to reference `events` instead of `assignments`.

#### Calendar Module: Complete Model A migration (client-side)

- **Canonical `assignmentId = jobId` mapping** (`client/src/components/calendar/calendarUtils.ts`):
  - `normalizeAssignments` now sets `assignmentId: a.jobId ?? a.id` (was `a.id`)
  - Ensures all drag/drop, grid keys, and mutations use the job ID consistently
  - Renamed function parameter `rawAssignments` → `rawEvents`; updated all dev-only
    log messages from "assignment" to "event" terminology
  - Updated `CalendarEvent` type JSDoc to document MODEL A contract
- **Optimistic cache updates** (`client/src/hooks/useCalendarDnD.ts`):
  - All three mutation blocks (create/update/delete) now read `events` field from cache
    (falling back to `assignments` for backward compat) and write back as `events`
  - Renamed internal `deletedAssignment` → `deletedEvent`
- **TechnicianDashboard** (`client/src/pages/TechnicianDashboard.tsx`):
  - Month data merge now reads `events` field first (`?.events ?? ?.assignments`)

### Changed

#### Jobs Page: Separate Schedule, Status, and Assignment Columns

- **Restructured Jobs table columns** (`client/src/pages/Jobs.tsx`):
  - **Schedule** column: shows date (e.g., "Jan 27, 2026") or "Not scheduled"
  - **Status** column: lifecycle badge (Open/Completed/Invoiced/Archived) +
    optional openSubStatus label (In Progress/On Route/On Hold/Needs Review) +
    Overdue and All-day indicators. "Backlog" never appears in this column.
  - **Assignment** column (NEW): shows primary technician name + "+N" for
    additional technicians, or "Unassigned". Fetches names via `/api/team/technicians`.
- Removed unused `Users` icon import
- Backlog concept retained in filters and dev reconciliation panel only

#### Eradicate Legacy "Assignment" Terminology + Regression Guard

- **Renamed `CalendarAssignmentWithDetails` → `CalendarJobWithDetails`**:
  - No separate "assignment" entity exists; calendar events ARE jobs
  - `CalendarRangeResult.assignments` → `CalendarRangeResult.jobs`
  - Updated all import sites and type references

- **Renamed CalendarRepository methods to job-centric terminology**:
  - `getAssignmentsInRange` → `getScheduledJobsInRange`
  - `getAssignmentsInRangeWithMetadata` → `getScheduledJobsInRangeWithMetadata`
  - `getAssignmentById` → `getJobById`
  - `createAssignment` → `scheduleJob`
  - `updateAssignment` → `rescheduleJob`
  - `deleteAssignment` → `unscheduleJob`
  - `createAssignmentBypassWorkingHours` → `scheduleJobBypassWorkingHours`
  - `updateAssignmentBypassWorkingHours` → `rescheduleJobBypassWorkingHours`

- **Renamed IStorage calendar bindings**:
  - `getCalendarAssignmentsInDateRange` → `getCalendarScheduledJobsInDateRange`
  - `getCalendarAssignment` → `getCalendarJob`
  - `createCalendarAssignment` → `scheduleCalendarJob`
  - `updateCalendarAssignment` → `rescheduleCalendarJob`
  - `deleteCalendarAssignment` → `unscheduleCalendarJob`

- **Audit context labels intentionally preserved** (`"storage:createAssignment"`,
  `"storage:updateAssignment"`, `"storage:deleteAssignment"`) — these are stored
  in the database; changing them would break historical audit data lookups.

- **Files updated**:
  - `server/storage/calendar.ts` — type rename, method renames, JSDoc updates
  - `server/routes/calendar.ts` — import rename, call site updates, destructuring updates
  - `server/storage/index.ts` — IStorage interface + storage bindings renamed
  - `tests/scheduling.smoke.test.ts` — call site + destructuring updates

### Added

#### Regression Test: No Legacy Job Statuses

- **New test `tests/no-legacy-statuses.test.ts`** — uses ripgrep to scan `server/`,
  `client/`, `shared/` for banned legacy status strings used as job lifecycle values:
  - Banned: `scheduled`, `assigned`, `unscheduled`, `overdue`, `in_progress`, `requires_invoicing`
  - `in_progress` uses PCRE2 negative lookbehind to exclude valid `openSubStatus` comparisons
  - Allowlist excludes migration scripts, status rules docs, display-only UI labels, tests, etc.
  - Prevents accidental reintroduction of legacy status values

#### Fix Scheduling Smoke Tests Schema Drift

- **Renamed `tests/ensureTestSchema.ts` → `tests/ensureTestDbInvariants.ts`**:
  - Scoped explicitly to NODE_ENV=test (throws on import outside tests)
  - Applies idempotent DDL patches, then runs a schema-expectation audit
  - Audit verifies required columns: `open_sub_status`, `version`,
    `scheduled_start`, `scheduled_end`, `deleted_at`
  - Audit verifies required constraints: `jobs_status_check`,
    `jobs_open_sub_status_invariant_check`, `jobs_scheduled_end_requires_start_check`,
    `jobs_all_day_start_midnight_check`, `jobs_all_day_end_2359_check`
  - Fails hard with actionable "apply real migrations" message if any are missing

- **Fixed `tests/scheduling.smoke.test.ts` Test 2 legacy status assertion**:
  - Removed `status: "scheduled"` from updateJob call (violated `jobs_status_check`)
  - Changed assertion from `status === "scheduled"` to `status === "open"`
  - Scheduling is now derived from `scheduledStart IS NOT NULL`, not status value

- **Updated `tests/setup.ts`**:
  - Sets `NODE_ENV=test` before importing invariants module
  - Calls `ensureTestDbInvariants()` in `beforeAll`

- **Files changed**:
  - `tests/ensureTestSchema.ts` — **NEW** — idempotent DDL patches
  - `tests/setup.ts` — calls ensureTestSchema in beforeAll
  - `tests/scheduling.smoke.test.ts` — fixed legacy status assertion

#### Phase 2 Step 10: Jobs Page Canonical Predicate Alignment

- **Fixed overdue filter/display drift in Jobs page**:
  - Overdue filter previously used `statusInfo.isOverdue` which short-circuits on sub-status
    (`in_progress`, `on_route`, etc.) before reaching the overdue check — missing overdue jobs
    that have a sub-status set. Now uses canonical `isJobOverdue` predicate directly via `_overdue`.
  - Overdue badge in table rows also switched from `statusInfo.isOverdue` to `_overdue`.
  - Added `_overdue` to enriched job alongside `_scheduled`, `_assigned`, `_backlog`.

- **Added dev-only reconciliation panel** (`import.meta.env.DEV` gated):
  - Toggle button shows/hides a panel comparing client-side counts vs `/api/calendar/state-snapshot`.
  - Client section: lifecycle counts, derived counts (openScheduled, backlog, overdue).
  - Server section: state-snapshot totals, invariant checks (open = scheduled + backlog, violations).
  - Diff section: highlights any drift between client and server counts.
  - Sample JobIds section: up to 10 job IDs per bucket for debugging.
  - Fetches state-snapshot only when panel is open; not loaded in production.

- **Files updated**:
  - `client/src/pages/Jobs.tsx` — canonical predicate alignment, dev reconciliation panel

#### Phase 2 Step 9: Soft-Delete Enforcement (Final Audit)

- **Fixed `deleteJob()` to use `deletedAt` instead of just `isActive`**:
  - Sets `deletedAt = NOW()` for canonical soft delete
  - Increments `version` for optimistic locking
  - Also sets `isActive = false` for legacy compatibility
  - Only deletes if not already deleted (`deletedAt IS NULL`)

- **Added `deletedAt IS NULL` filter to all job queries in `server/storage/jobs.ts`**:
  - `getJobs()` - job list query (line 226)
  - `getJob()` - single job fetch (line 371)
  - `updateJobStatusWithEvent()` - status update transaction (line 1245)
  - `getActionRequiredJobs()` - on-hold/needs-review query (line 1360)

- **Fixed UI query invalidation after job deletion**:
  - `JobDetailPage.tsx` now invalidates `/api/calendar` and `/api/maintenance` queries
  - Ensures deleted job disappears from calendar and maintenance views

- **Calendar storage already had correct filters**:
  - `getAssignmentsInRange()` - includes `isNull(jobs.deletedAt)` at line 193
  - `getUnscheduledJobs()` - includes `isNull(jobs.deletedAt)` at line 391

- **Files updated**:
  - `server/storage/jobs.ts` - Added `isNull` import, soft-delete filters to 4 queries, fixed `deleteJob()`
  - `client/src/pages/JobDetailPage.tsx` - Added calendar/maintenance query invalidation

#### Phase 2 Step 8: Canonical Duration (Eliminate Scheduling Drift)

- **Renamed `estimated_duration_minutes` → `duration_minutes`** on jobs table:
  - Single canonical duration source for scheduled jobs
  - Eliminates drift between "estimated" and "actual" scheduled duration
  - Column rename via migration (no data change needed)

- **Canonicalized `isJobOverdue` effectiveEnd computation**:
  - Priority order: scheduledEnd > scheduledStart + durationMinutes > scheduledStart
  - Removed estimatedDurationMinutes from overdue logic
  - Updated SQL in dashboard.ts, admin.ts, maintenance.ts

- **Canonicalized Calendar DTO durationMinutes**:
  - All-day: 1440 (24 hours)
  - Timed with scheduledEnd: computed from timestamps
  - Job has durationMinutes: use job.durationMinutes
  - Default fallback: 60 minutes
  - Ensures UI uses same duration as scheduling

- **Added durationMinutes to CalendarAssignmentWithDetails**:
  - Interface now includes `durationMinutes: number | null`
  - All calendar queries select jobs.durationMinutes
  - Transformation objects include durationMinutes

- **Files updated**:
  - `shared/schema.ts` - Renamed column, updated isJobOverdue
  - `server/storage/calendar.ts` - Added durationMinutes to interface and queries
  - `server/storage/dashboard.ts` - SQL uses durationMinutes
  - `server/storage/admin.ts` - SQL uses durationMinutes
  - `server/storage/maintenance.ts` - SQL uses durationMinutes
  - `server/routes/calendar.ts` - transformToDto uses job.durationMinutes
  - `client/src/components/job/jobUtils.ts` - Updated type signatures

- **Migration**: `migrations/2026_01_27_rename_estimated_to_duration_minutes.sql`
  - Renames column from estimated_duration_minutes to duration_minutes

- **Remaining estimatedDurationMinutes usages** (allowed - template/input defaults):
  - `recurring_job_templates.estimatedDurationMinutes` - template default
  - `job_visits.estimatedDurationMinutes` - visit duration estimate
  - `tasks.estimatedDurationMinutes` - task duration estimate

#### Phase 2 Step 7: Stability & Correctness Hardening

- **DB CHECK constraints** - Added hard enforcement at database level:
  - `jobs_status_check` - status must be one of: open, completed, invoiced, archived
  - `jobs_scheduled_end_requires_start_check` - scheduledEnd requires scheduledStart
  - `jobs_all_day_start_midnight_check` - all-day events must have scheduledStart at 00:00:00
  - `jobs_all_day_end_2359_check` - all-day events must have scheduledEnd at 23:59:59

- **Runtime `assertJobInvariants(job)` function** in `server/domain/scheduling.ts`:
  - Runs in all environments (production + dev), not just dev mode
  - Throws `InvariantViolationError` with code `INVARIANT_VIOLATION` (400 status)
  - Checks all 6 invariants: status, openSubStatus, scheduledEnd requires start, all-day timestamps, end >= start

- **Expanded `/api/calendar/state-snapshot` endpoint**:
  - Now returns `violations` object with counts and job IDs for each invariant type
  - Violation types: invalidStatus, orphanedOpenSubStatus, endWithoutStart, allDayStartNotMidnight, allDayEndNot2359, endBeforeStart
  - Added `_invariants.no_violations` and `_invariants.total_violation_count` for quick health checks

- **Files updated**:
  - `shared/schema.ts` - Added 4 new CHECK constraints to jobs table
  - `server/domain/scheduling.ts` - Added `InvariantViolationError` class and `assertJobInvariants()` function
  - `server/storage/calendar.ts` - Expanded `getStateSnapshot()` to query for violations
  - `server/routes/calendar.ts` - Updated state-snapshot response to include violations

- **Migration**: `migrations/2026_01_27_add_job_invariant_constraints.sql`
  - Adds 4 CHECK constraints for status, scheduling, and all-day invariants

#### Phase 2 Step 5: Canonical "Overdue" Derived Flag (Updated)

- **AUTHORITATIVE RULE** - A job is overdue ONLY when:
  - `status === 'open'` (completed/invoiced/archived are NEVER overdue)
  - `scheduledStart IS NOT NULL` (backlog/unscheduled is NEVER overdue)
  - `effectiveEnd < now` (job should have finished by now)

- **effectiveEnd calculation** (priority order):
  1. `scheduledEnd` if present (includes all-day jobs with 23:59:59 end time)
  2. `scheduledStart + estimatedDurationMinutes` if duration exists
  3. `scheduledStart` as fallback (point-in-time job)

- **Single canonical `isJobOverdue(job, now?)` predicate** in `shared/schema.ts`:
  - Used consistently across client and server code
  - All-day jobs only become overdue once the entire day has passed (23:59:59 end time)
  - Removed all duplicate inline overdue calculations

- **Files updated**:
  - `shared/schema.ts` - Updated `isJobOverdue(job, now?)` to use effectiveEnd with estimatedDurationMinutes
  - `client/src/components/job/jobUtils.ts` - Both functions use canonical predicate, includes priority field
  - `client/src/pages/Jobs.tsx` - Removed duplicate local `getJobStatusDisplay`, now imports from jobUtils.ts
  - `server/storage/admin.ts` - SQL CASE expression for effectiveEnd with estimatedDurationMinutes
  - `server/storage/dashboard.ts` - SQL CASE expression for effectiveEnd with estimatedDurationMinutes
  - `server/storage/maintenance.ts` - SQL CASE expression for effectiveEnd with estimatedDurationMinutes

- **Migration**: `migrations/2026_01_27_add_estimated_duration_minutes.sql`
  - Adds `estimated_duration_minutes` column to jobs table
  - Used for effectiveEnd calculation when scheduledEnd is not set
  - `client/src/pages/ClientDetailPage.tsx` - Uses `isJobOverdue`
  - `client/src/pages/LocationDetailPage.tsx` - Uses `isJobOverdue`
  - `server/storage/admin.ts` - SQL uses `COALESCE(scheduled_end, scheduled_start) < NOW()`
  - `server/storage/dashboard.ts` - SQL uses `COALESCE(scheduled_end, scheduled_start) < NOW()`
  - `server/storage/maintenance.ts` - SQL uses `COALESCE(scheduled_end, scheduled_start) < CURRENT_TIMESTAMP`

#### Phase 2 Step 6: Remove templateStatusDefaultEnum

- **Removed `templateStatusDefaultEnum`** - All generated jobs now have `status = 'open'` (hardcoded)
- **Renamed column** - `statusDefault` → `openSubStatusDefault`:
  - Template only controls the optional `openSubStatus` (null = backlog, "on_hold" = held)
  - Values: `null` (normal backlog) or any valid `openSubStatusEnum` value

- **Files updated**:
  - `shared/schema.ts` - Removed enum, updated table definition and schemas
  - `server/domain/recurrence.ts` - Simplified job creation, always sets `status: 'open'`
  - `server/storage/recurringJobs.ts` - Updated to use `openSubStatusDefault`
  - `server/routes/recurringJobs.ts` - Updated validation
  - `client/src/pages/RecurringJobsPage.tsx` - Updated UI to use new field
  - `tests/recurring-jobs.test.ts` - Updated test data

- **Migration**: `migrations/2026_01_27_rename_status_default_to_open_sub_status_default.sql`
  - Renames column from `status_default` to `open_sub_status_default`
  - Converts "open" values to NULL
  - Removes NOT NULL constraint (sub-status is optional)

### Refactored

#### Code Deduplication
- **Removed duplicate `getJobStatusDisplay` from Jobs.tsx** - The local function (63 lines) was a duplicate of the one in `jobUtils.ts`. Now imports from `@/components/job/jobUtils` instead. ([Jobs.tsx:83-145 removed])

#### Optimistic Locking + Completion Desync Fix

- **Removed all `version ?? 0` fallbacks** - No more silently inventing version 0:
  - Client sends actual version (undefined if missing)
  - Server rejects with 409 VERSION_NOT_INITIALIZED if version is null

- **Added VERSION_NOT_INITIALIZED error** in `server/domain/scheduling.ts`:
  - New `VersionNotInitializedError` class (statusCode: 409, code: VERSION_NOT_INITIALIZED)
  - `assertVersionMatch()` now throws this error for null/undefined versions

- **Version check on job completion flow**:
  - `POST /api/jobs/:id/status` now requires `version` in request body
  - Rejects VERSION_MISMATCH if versions don't match
  - Rejects VERSION_NOT_INITIALIZED if job has null version
  - On success: status updated, version incremented atomically

- **Initialized all job versions in DB**:
  - Migration sets `version = 1` for all jobs with NULL version
  - Added NOT NULL DEFAULT 1 constraint to jobs.version column
  - Schema updated: `version: integer("version").notNull().default(1)`

- **Files updated**:
  - `client/src/hooks/useCalendarDnD.ts` - Removed `assignment.version ?? 0` (2 occurrences)
  - `client/src/components/JobDetailDialog.tsx` - Removed `assignment.version ?? 0` (3 occurrences)
  - `client/src/components/ClientDetailDialog.tsx` - Removed `assignment.version ?? 0` (2 occurrences)
  - `client/src/components/calendar/ResizableJobCard.tsx` - Removed `assignment.version ?? 1`
  - `server/domain/scheduling.ts` - Added `VersionNotInitializedError`, updated `assertVersionMatch()`
  - `server/routes/calendar.ts` - Response version fallback changed to 1 (post-migration safe)
  - `server/routes/jobs.ts` - Added version to statusUpdateSchema, added version check
  - `server/storage/calendar.ts` - Updated version checks to throw VERSION_NOT_INITIALIZED
  - `shared/schema.ts` - Changed jobs.version default from 0 to 1

- **Migration**: `migrations/2026_01_27_initialize_job_versions.sql`
  - Sets version = 1 for all NULL versions
  - Adds NOT NULL DEFAULT 1 constraint

- **Removed ALL version response fallbacks** in `server/routes/calendar.ts`:
  - `transformToDto()`: Changed `(job as any).version ?? 1` → `job.version`
  - Schedule/reschedule/unschedule responses: Changed `result.version ?? 1` → `result.version`
  - DTO type `CalendarAssignmentWithDetails` already has `version: number` (non-optional)
  - Storage selects include `version: jobs.version` in all queries

- **Removed legacy completion API surface**:
  - Deleted `completeAssignment()` method from `server/storage/calendar.ts`
  - Removed `completeCalendarAssignment` from `IStorage` interface and bindings in `server/storage/index.ts`
  - Canonical completion path: `POST /api/jobs/:id/status` with version check
  - Uses `jobRepository.updateJobStatusWithEvent()` for atomic status + audit

- **Added GIN index for technician array queries** (performance):
  - Migration: `migrations/2026_01_27_add_gin_index_assigned_technician_ids.sql`
  - Creates `idx_jobs_assigned_technician_ids_gin` using GIN operator class
  - Optimizes array containment queries (@>, &&) for technician-based calendar filtering

- **Canonicalized `isJobScheduled` predicate**:
  - Canonical truth: `scheduledStart IS NOT NULL` (exported from `shared/schema.ts`)
  - Updated `client/src/pages/LocationDetailPage.tsx` to use `isJobScheduled(j)` instead of `j.scheduledStart != null`
  - Updated `client/src/pages/ClientDetailPage.tsx` to use `isJobScheduled(job)` in all scheduled checks

### Fixed

#### Calendar & Scheduling
- **VERSION_MISMATCH (409) on drag-and-drop scheduling** - Multiple fixes:
  1. Server now returns explicit `jobVersion` field in `/api/calendar/unscheduled` response
  2. Client eliminated all unsafe `version ?? 0` fallbacks (14 occurrences removed)
  3. Added `requireJobVersion()` and `requireAssignmentVersion()` guard functions that validate version is a finite number, show toast and refetch if missing
  4. Auto-retry logic fetches fresh version and retries once on 409 errors
  5. Detailed diagnostics logging for debugging version conflicts
  ([Calendar.tsx], [useCalendarDnD.ts], [calendar.ts])

- **All-day row overlapping timed slots in week view** - Created new `AllDayRow` component with dynamic height calculation. Row now grows based on content (min 64px, max 200px) instead of fixed 84px, preventing overlap with timed grid below. ([CalendarGridWeek.tsx])

#### Job Detail Dialog
- **Split schedule UI causing confusion** - Removed view/edit mode split. Schedule editor is now always visible inline for faster scheduling. Removed conflicting header "Reschedule" popover. ([JobDetailDialog.tsx])

- **Date picker flicker** - Eliminated by removing duplicate Reschedule popover that shared focus with schedule section picker.

- **All-day Save button disabled** - Fixed by ensuring `selectedDate` defaults to today for unscheduled jobs.

- **Delete Job deleting calendar assignment instead of job** - Fixed `deleteJobMutation` to call `DELETE /api/jobs/:jobId` instead of `/api/calendar/assignments/:id`. Job deletion now properly soft-deletes the job record. ([JobDetailDialog.tsx])

- **Status mismatch between Calendar and Jobs list** - Added "jobs" to query invalidation groups for all scheduling mutations (`toggleComplete`, `updateDate`, `updateSchedule`, `unscheduleJob`, `deleteJobMutation`) so both views stay synchronized.

### Changed

- **Query invalidation** - Scheduling mutations now invalidate both calendar and jobs query groups for consistency.
- **useCalendarDnD** - Now exports `invalidateCalendarQueries` helper for use in Calendar.tsx.

#### Canonical Scheduling Model (MODEL A) - Phase 1 Steps 2 & 2.5 Complete

- **MODEL A: Timestamp Canonical** - All scheduled jobs now have `scheduledStart IS NOT NULL`:
  - Timed events: `scheduledStart` = actual start time, `scheduledEnd` = actual end time
  - All-day events: `scheduledStart` = midnight (00:00:00), `scheduledEnd` = 23:59:59
  - `isAllDay` is now a **display flag only**, NOT a scheduling determinant
  - Canonical predicate: `isJobScheduled(job) = scheduledStart IS NOT NULL`

- **Removed old null invariant** - Previously, all-day events had `scheduledStart = NULL`. This caused:
  - All-day events missing from calendar range queries (invisible in calendar)
  - Inconsistent scheduling predicates across codebase
  - Now fixed: all-day events always have midnight timestamps

- **New invariant helper** - `assertAllDayTimestampInvariant(job)` validates:
  - All-day events have midnight `scheduledStart`
  - All-day events have 23:59:59 `scheduledEnd` (or next-day 00:00:00)
  - Timed events have `scheduledEnd > scheduledStart`

- **Files updated for MODEL A**:
  - `shared/schema.ts` - Canonical `isJobScheduled()` only checks `scheduledStart != null`
  - `shared/types/calendar.ts` - Updated CalendarAssignmentDto documentation
  - `server/storage/calendar.ts` - All write functions set midnight for all-day
  - `server/routes/calendar.ts` - API returns timestamps for all-day (not null)
  - `server/domain/scheduling.ts` - Added `assertAllDayTimestampInvariant()`
  - `client/src/components/calendar/calendarUtils.ts` - Updated normalization docs
  - `client/src/lib/calendarDiagnostics.ts` - Updated invariant checks

#### Job Status Model (BREAKING) - Phase 1 Step 1 Complete

- **Normalized job status to 4 lifecycle values** - Replaced 12+ status values with exactly 4:
  - `open` - Active job that can be worked on
  - `completed` - Work finished (may need invoicing)
  - `invoiced` - Invoice created (locked for billing)
  - `archived` - Historical archive (includes canceled jobs)

- **Derived states instead of status values** - "scheduled" and "assigned" are now derived from fields:
  - `isJobScheduled(job)` - true if `scheduledStart IS NOT NULL` (MODEL A: all-day events have midnight timestamps)
  - `isJobAssigned(job)` - true if `primaryTechnicianId IS NOT NULL OR assignedTechnicianIds.length > 0`

- **Workflow sub-status for open jobs** - New `openSubStatus` column (only valid when `status = 'open'`):
  - `null` - Default, no special workflow state
  - `in_progress` - Work actively being performed
  - `on_hold` - Job is blocked (requires holdReason)
  - `on_route` - Technician traveling to job site
  - `needs_review` - Needs supervisor/manager review

- **Migration mapping**:
  - `assigned`, `unscheduled`, `scheduled` → `open` (now derived)
  - `in_progress`, `on_hold` → `open` + appropriate `openSubStatus`
  - `action_required` → `open` + `openSubStatus = 'needs_review'`
  - `requires_invoicing` → `completed`
  - `closed`, `canceled`, `cancelled` → `archived`

- **Runtime Guard Added** - `assertNormalizedJobStatus()` function in `server/schemas.ts` throws immediately on invalid status values. Use in any code path that persists or transforms job status.

- **Legacy Status Removal (13 files updated)**:
  - `server/storage/jobs.ts` - Removed `in_progress`, `requires_invoicing`, `closed` checks
  - `server/storage/dashboard.ts` - Replaced `CLOSED_STATUSES` array with `TERMINAL_STATUSES`
  - `server/storage/admin.ts` - Renamed `actionRequiredCount` → `onHoldCount`
  - `server/storage/calendar.ts` - Removed `scheduled`/`assigned` status derivation
  - `server/storage/customerCompanies.ts` - Simplified to `status === "open"` filter
  - `server/routes/admin.ts` - Rewrote scheduling health checks
  - `server/routes/reports.ts` - Updated `action_required` queries to `needs_review`
  - `server/routes/clients.ts` - Simplified open jobs filter
  - `server/scripts/schedulingSanityCheck.ts` - Complete rewrite
  - `client/src/components/job/jobUtils.ts` - Complete rewrite
  - `client/src/pages/Jobs.tsx` - Updated filter types
  - `client/src/lib/jobScheduling.ts` - Removed `scheduled` status assignment

See `docs/audit/phase1_step1_legacy_status_removals.md` for detailed report.

### Added

- `logVersionMismatch()` function in calendarDiagnostics.ts for detailed 409 error logging
- `fetchFreshJobVersion()` helper in useCalendarDnD.ts for auto-retry logic
- `_isRetry` field in CreateAssignmentParams and UpdateAssignmentParams to prevent infinite retry loops
- `AllDayRow` component in CalendarGridWeek.tsx with dynamic height calculation
- `openSubStatus` column in jobs table with CHECK constraint enforcing invariant
- `openSubStatusEnum` in server/schemas.ts for Zod validation
- `normalizeJobStatus()` function in shared/schema.ts to map legacy values
- `deriveOpenSubStatus()` function in shared/schema.ts for migration
- `isJobScheduled()` and `isJobAssigned()` helper functions in shared/schema.ts
- Database migration: `migrations/2026_01_26_normalize_job_status.sql`

---

## Version History

_Previous versions were not tracked in this changelog. See git history for details._
