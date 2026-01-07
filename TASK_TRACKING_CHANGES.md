# Task Tracking and Assignment Enhancements

## Summary
Enhanced the tasks system with comprehensive time tracking, assignment capabilities, and client/job linking. This update includes automatic status transitions, duration calculations, and performance optimizations.

## Changes Implemented

### 1. Database Schema Updates (shared/schema.ts)

#### New Fields Added to `tasks` table:
- **clientId**: Optional reference to clients table for task organization
- **estimatedDurationMinutes**: Optional estimated completion time in minutes
- **actualDurationMinutes**: Auto-calculated actual duration from checkedInAt to checkedOutAt

#### Status Enum Fixed:
- **Old**: Used 'OPEN' and 'CLOSED' (inconsistent with validation)
- **New**: Uses 'pending', 'in_progress', 'completed', 'cancelled' (matches route validation)
- **Default**: 'pending'

#### Performance Indexes Added:
- `tasks_company_assigned_idx` on (companyId, assignedToUserId)
- `tasks_company_status_idx` on (companyId, status)
- `tasks_company_job_idx` on (companyId, jobId)
- `tasks_company_client_idx` on (companyId, clientId)

#### Updated Zod Schemas:
- **insertTaskSchema**: Added clientId, estimatedDurationMinutes support
- **updateTaskSchema**: NEW - supports status, assignedToUserId, jobId, clientId, estimatedDurationMinutes, scheduling fields
- **Export**: Added UpdateTask type

### 2. Migration File Created

**File**: `migrations/0003_add_task_tracking_and_assignments.sql`

Actions performed:
- Added new columns (client_id, estimated_duration_minutes, actual_duration_minutes)
- Created 4 performance indexes
- Cleaned up invalid status values (set to 'pending' if not in enum)
- Added column comments for documentation

**Status**: ✅ Successfully executed

### 3. Service Layer Updates (server/services/tasks.service.ts)

#### createTask:
- Now accepts `clientId` and `estimatedDurationMinutes`
- Properly sets `status` from input (defaults to 'pending')

#### checkInTask:
- **NEW**: Auto-sets status to 'in_progress' when checking in
- Sets `checkedInAt` timestamp

#### checkOutTask:
- **NEW**: Auto-calculates `actualDurationMinutes` from checkedInAt to checkedOutAt
- Converts milliseconds to minutes and rounds

#### closeTask:
- **FIXED**: Sets status to 'completed' instead of 'CLOSED'
- **NEW**: Auto-checks out and calculates duration if task was checked in but not checked out
- Sets closedAt and closedByUserId

#### updateTask:
- **EXPANDED**: Now supports all updateable fields:
  - Basic: title, notes, type, scheduledStartAt, scheduledEndAt, allDay
  - Assignment: assignedToUserId
  - Linking: jobId, clientId
  - Duration: estimatedDurationMinutes
  - **Status with auto-timestamps**:
    - Transitioning to 'in_progress': Auto-sets checkedInAt if not already set
    - Transitioning to 'completed': Auto-sets closedAt, checkedOutAt, and calculates actualDurationMinutes

### 4. Route Handler Updates (server/routes/tasks.routes.ts)

#### Validation Schemas Updated:

**createTaskSchema**:
- Added: clientId, estimatedDurationMinutes

**updateTaskSchema**:
- Added: clientId, estimatedDurationMinutes, jobId, scheduledStartAt, scheduledEndAt, allDay
- Made assignedToUserId, jobId, clientId, estimatedDurationMinutes nullable

#### Route Logic:

**POST /api/tasks**:
- Now passes clientId and estimatedDurationMinutes to service

**PATCH /api/tasks/:id**:
- Maps 'description' field to 'notes' for backwards compatibility
- Passes all validated fields to updateTask service

### 5. Already Existing Features (Not Changed)

The following were already in place:
- assignedToUserId field
- jobId field
- checkedInAt, checkedOutAt timestamps
- scheduledStartAt, scheduledEndAt for planning
- Multi-tenant scoping via companyId
- Check-in/check-out endpoints

## Files Changed

1. ✅ `shared/schema.ts` - Schema and validation updates
2. ✅ `server/services/tasks.service.ts` - Service logic with auto-calculations
3. ✅ `server/routes/tasks.routes.ts` - Route validation and handling
4. ✅ `migrations/0003_add_task_tracking_and_assignments.sql` - Database migration (executed)

## Testing Checklist

### ✅ Already Verified:
1. Status enum fixed - tasks now use 'pending' instead of 'OPEN'
2. Migration executed successfully - new columns and indexes added
3. Existing tasks migrated to new status values (1 pending, 3 completed)

### To Test After Server Restart:

#### Task Creation:
- [ ] Create task with status 'pending' - should succeed
- [ ] Create task with assignedToUserId - should save assignment
- [ ] Create task with clientId - should link to client
- [ ] Create task with estimatedDurationMinutes - should save estimate
- [ ] Create task with jobId - should link to job

#### Time Tracking:
- [ ] Create task → check-in - should auto-set status to 'in_progress'
- [ ] Check-in task → check-out - should calculate actualDurationMinutes
- [ ] Check-in task → close (without checkout) - should auto-checkout and calculate duration
- [ ] Update task status to 'in_progress' - should auto-set checkedInAt
- [ ] Update task status to 'completed' - should auto-set closedAt and duration

#### Assignment & Linking:
- [ ] Assign task to technician - should update assignedToUserId
- [ ] Link task to job - should update jobId
- [ ] Link task to client - should update clientId
- [ ] Unassign task (set to null) - should clear assignment

#### Validation:
- [ ] Cannot check-out before check-in - should error
- [ ] Status transitions work correctly (pending → in_progress → completed)
- [ ] Multi-tenant isolation enforced (tasks scoped to companyId)

## API Examples

### Create Task with Full Details:
```json
POST /api/tasks
{
  "title": "Replace HVAC filters at Smith Building",
  "description": "Annual PM - replace all filters",
  "type": "GENERAL",
  "assignedToUserId": "tech-uuid-here",
  "clientId": "client-uuid-here",
  "jobId": "job-uuid-here",
  "estimatedDurationMinutes": 120,
  "scheduledStartAt": "2026-01-08T09:00:00Z",
  "scheduledEndAt": "2026-01-08T11:00:00Z"
}
```

### Update Task Status (Auto-time tracking):
```json
PATCH /api/tasks/:id
{
  "status": "in_progress"  // Auto-sets checkedInAt
}
```

```json
PATCH /api/tasks/:id
{
  "status": "completed"  // Auto-sets closedAt, checkedOutAt, actualDurationMinutes
}
```

### Reassign Task:
```json
PATCH /api/tasks/:id
{
  "assignedToUserId": "new-tech-uuid-here"
}
```

## Migration Notes

- All new columns are nullable to preserve existing data
- Existing tasks with invalid status values were set to 'pending'
- Indexes created with IF NOT EXISTS for idempotency
- Migration can be safely re-run

## Performance Impact

**Positive**:
- 4 new indexes improve query performance for:
  - Finding tasks by technician assignment
  - Filtering by status
  - Finding tasks by job
  - Finding tasks by client

**Minimal**:
- Additional columns add negligible storage overhead
- Auto-calculation logic runs only on status transitions

## Breaking Changes

**None** - All changes are backwards compatible:
- New fields are optional
- Existing API contracts maintained
- Old field names (description) mapped to new ones (notes)
- Status enum aligned with existing validation

## Next Steps

1. **Server Restart Required**: Restart development server to load updated schema
2. **Frontend Updates** (if needed):
   - Add clientId selector to NewTaskDialog
   - Add estimatedDurationMinutes input
   - Display actualDurationMinutes on completed tasks
   - Show status transitions in UI
3. **Documentation**: Update API documentation with new fields
4. **Monitoring**: Track duration calculations for performance insights

## Rollback Plan

If issues arise, revert by:
1. Revert code changes in git
2. Run rollback SQL:
```sql
ALTER TABLE tasks DROP COLUMN IF EXISTS client_id;
ALTER TABLE tasks DROP COLUMN IF EXISTS estimated_duration_minutes;
ALTER TABLE tasks DROP COLUMN IF EXISTS actual_duration_minutes;
DROP INDEX IF EXISTS tasks_company_assigned_idx;
DROP INDEX IF EXISTS tasks_company_status_idx;
DROP INDEX IF EXISTS tasks_company_job_idx;
DROP INDEX IF EXISTS tasks_company_client_idx;
```

## Support

For issues or questions about these changes, reference:
- This document: `TASK_TRACKING_CHANGES.md`
- Schema file: `shared/schema.ts` lines 1500-1576
- Service logic: `server/services/tasks.service.ts`
- Migration: `migrations/0003_add_task_tracking_and_assignments.sql`
