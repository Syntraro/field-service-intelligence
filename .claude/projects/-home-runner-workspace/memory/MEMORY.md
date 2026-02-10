# Project Memory

## Architecture
- **Active recurrence engine** uses `recurring_job_templates` table (NOT the legacy `recurring_job_series`)
- Legacy tables `recurring_job_series` + `recurring_job_phases` exist but are unused by the new system
- `recurring_job_instances` provides idempotent generation with atomic claim mechanism
- `BaseRepository` in `server/storage/base.ts` has `tx()` helper for transactions
- Drizzle transaction type: `typeof db` (use `as unknown as DbOrTx` when casting from `db.transaction` callback)

## Key Types
- `TeamMember` (client/src/hooks/useTechnicians.ts): `id: string` (UUID), optional firstName/lastName/createdAt
- API `/api/team/technicians` returns: id, fullName, email, role, roleId, isSchedulable (NOT firstName/lastName/createdAt)
- `PMPartWithItem` (server/storage/pmParts.ts): extends LocationPMPartTemplate with itemName, itemSku, itemCategory, itemCost, itemUnitPrice

## PM Strategy
- PM fields live on `recurring_job_templates`: monthsOfYear, generationMode, generationDayOfMonth, autoSchedule, scheduledTimeLocal, includeLocationPmParts
- Generation modes: 'phase' (default, existing logic), 'period_start' (1st of month), 'day_of_month' (specific day)
- `copyLocationPMPartsToJob()` in `server/services/pmJobParts.ts` handles parts snapshot with tx support

## Patterns
- `storage.createJobPart()` includes invoice-guard + job existence check — too heavy for bulk generation; use direct `db.insert(jobParts)` for generation context
- All DB IDs are string UUIDs (varchar with gen_random_uuid() default)
- Pre-existing TS errors: PostCSS warning + chunk size warning in build (harmless)
