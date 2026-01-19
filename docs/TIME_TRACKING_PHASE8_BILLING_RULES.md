# Time Tracking Phase 8: Billing Rules + Rounding + Invoice Accuracy

## Overview

Phase 8 adds configurable billing rules for converting time entries into invoice line items. Companies can customize rounding, minimums, rate multipliers, and type-specific billing toggles.

## Features

### 1. Rounding Configuration

Control how raw time entry minutes are converted to billable minutes.

| Setting | Default | Description |
|---------|---------|-------------|
| `rounding_increment_minutes` | 15 | Round to nearest N minutes (1, 5, 6, 10, 15, 30, 60) |
| `rounding_mode` | up | How to round: `up`, `nearest`, or `down` |
| `minimum_billable_minutes` | 15 | Minimum billable time per entry |

**Rounding Examples (15-minute increment, round up):**
- 7 minutes → 15 minutes
- 23 minutes → 30 minutes
- 45 minutes → 45 minutes
- 8 minutes with 15-min minimum → 15 minutes

### 2. Type-Specific Billing Toggles

Control which entry types appear on invoices.

| Setting | Default | Description |
|---------|---------|-------------|
| `bill_travel` | true | Include travel time on invoices |
| `bill_supplier_run` | true | Include parts pickup trips |
| `bill_admin` | false | Include admin/paperwork time |

**Note:** Breaks are never billable regardless of settings.

### 3. Rate Multipliers

Adjust billing rates by entry type.

| Setting | Default | Description |
|---------|---------|-------------|
| `travel_rate_multiplier` | 1.0 | Multiplier for travel time (0.5 = 50% of base rate) |
| `on_site_rate_multiplier` | 1.0 | Multiplier for on-site work |

**Example:** With a $100/hr base rate and 0.5 travel multiplier:
- On-site: $100/hr (1.0 × $100)
- Travel: $50/hr (0.5 × $100)

### 4. Travel Caps

Limit billable travel time per job per day.

| Setting | Default | Description |
|---------|---------|-------------|
| `max_travel_minutes_per_job_per_day` | null | Max travel minutes to bill (null = no limit) |

**Cap Behavior:**
- Applied after rounding
- Oldest entries in the day are billed first
- Excess travel is capped (not excluded entirely)
- Cap is per job, per day

### 5. Invoice Snapshots

When time entries are invoiced, billing details are captured for audit:

| Column | Description |
|--------|-------------|
| `billed_minutes_snapshot` | Final minutes after rules applied |
| `billed_rate_snapshot` | Final hourly rate after multipliers |
| `billing_rules_hash` | Hash of rules used (for debugging) |

This ensures invoice amounts can be explained even if rules change later.

## API Endpoints

### Get Billing Rules

```bash
GET /api/time-billing/rules
```

Returns current rules with defaults for unconfigured companies.

**Response:**
```json
{
  "rules": {
    "id": "abc-123",
    "companyId": "company-456",
    "roundingIncrementMinutes": 15,
    "roundingMode": "up",
    "minimumBillableMinutes": 15,
    "billTravel": true,
    "billSupplierRun": true,
    "billAdmin": false,
    "travelRateMultiplier": "1.0",
    "onSiteRateMultiplier": "1.0",
    "maxTravelMinutesPerJobPerDay": null,
    "isDefault": false
  },
  "hash": "a1b2c3d4e5f6"
}
```

### Update Billing Rules

```bash
PUT /api/time-billing/rules
Content-Type: application/json

{
  "roundingIncrementMinutes": 6,
  "roundingMode": "nearest",
  "travelRateMultiplier": "0.75",
  "maxTravelMinutesPerJobPerDay": 60
}
```

### Reset to Defaults

```bash
DELETE /api/time-billing/rules
```

### Preview Billing Rules

Preview how rules would apply to a set of entries without creating an invoice.

```bash
POST /api/time-billing/preview
Content-Type: application/json

{
  "entries": [
    {
      "id": "entry-1",
      "type": "travel",
      "durationMinutes": 23,
      "billableRateSnapshot": "100.00",
      "jobId": "job-1",
      "startAt": "2026-01-18T08:00:00Z"
    },
    {
      "id": "entry-2",
      "type": "on_site",
      "durationMinutes": 47,
      "billableRateSnapshot": "100.00",
      "jobId": "job-1",
      "startAt": "2026-01-18T09:00:00Z"
    }
  ]
}
```

**Response:**
```json
{
  "rulesHash": "a1b2c3d4e5f6",
  "totalBilledMinutes": 75,
  "totalExcludedMinutes": 0,
  "entries": [
    {
      "entryId": "entry-1",
      "originalMinutes": 23,
      "billedMinutes": 30,
      "originalRate": 100,
      "billedRate": 100,
      "entryType": "travel",
      "wasCapped": false,
      "wasExcluded": false
    },
    {
      "entryId": "entry-2",
      "originalMinutes": 47,
      "billedMinutes": 45,
      "originalRate": 100,
      "billedRate": 100,
      "entryType": "on_site",
      "wasCapped": false,
      "wasExcluded": false
    }
  ]
}
```

## Database Schema

### time_billing_rules

```sql
CREATE TABLE time_billing_rules (
  id VARCHAR(255) PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL UNIQUE,
  rounding_increment_minutes INTEGER NOT NULL DEFAULT 15,
  rounding_mode TEXT NOT NULL DEFAULT 'up',
  minimum_billable_minutes INTEGER NOT NULL DEFAULT 15,
  bill_travel BOOLEAN NOT NULL DEFAULT true,
  bill_supplier_run BOOLEAN NOT NULL DEFAULT true,
  bill_admin BOOLEAN NOT NULL DEFAULT false,
  travel_rate_multiplier TEXT NOT NULL DEFAULT '1.0',
  on_site_rate_multiplier TEXT NOT NULL DEFAULT '1.0',
  max_travel_minutes_per_job_per_day INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);
```

### time_entries (extended)

```sql
ALTER TABLE time_entries
  ADD COLUMN billed_minutes_snapshot INTEGER,
  ADD COLUMN billed_rate_snapshot TEXT,
  ADD COLUMN billing_rules_hash TEXT;
```

## UI Pages

### Billing Rules Settings

Route: `/settings/time-billing`

Manager-only page to configure:
- Rounding increment and mode
- Minimum billable minutes
- Entry type billing toggles (travel, supplier_run, admin)
- Rate multipliers
- Travel cap

## Invoice Integration

When creating an invoice from a job:

1. **Fetch Rules:** Get company billing rules (or defaults)
2. **Get Entries:** Find uninvoiced, completed, billable time entries for job
3. **Apply Rules:**
   - Check type billing toggles
   - Apply rounding and minimums
   - Apply rate multipliers
   - Apply travel caps (oldest first)
4. **Create Lines:** Group by technician + type, create invoice lines
5. **Snapshot:** Store billed minutes, rate, and rules hash on each entry

## Backward Compatibility

- Companies without custom rules use system defaults
- Default behavior matches pre-Phase 8 (15-min rounding up, all types billed)
- Existing invoices are not affected
- Rules only apply at invoice creation time

## Implementation Files

### Backend
- `shared/schema.ts` - timeBillingRules table + time_entries extensions
- `server/storage/timeBillingRules.ts` - Rules repository + application logic
- `server/storage/invoices.ts` - Updated addLaborLinesFromTimeEntries
- `server/routes/timeBillingRules.ts` - API endpoints

### Frontend
- `client/src/pages/TimeBillingRulesPage.tsx` - Settings UI

### Database
- `migrations/2026_01_18_add_time_billing_rules.sql` - Migration script

## Examples

### Example 1: Standard HVAC Contractor

```json
{
  "roundingIncrementMinutes": 15,
  "roundingMode": "up",
  "minimumBillableMinutes": 15,
  "billTravel": true,
  "billSupplierRun": true,
  "billAdmin": false,
  "travelRateMultiplier": "1.0",
  "onSiteRateMultiplier": "1.0",
  "maxTravelMinutesPerJobPerDay": null
}
```

### Example 2: Discounted Travel

```json
{
  "roundingIncrementMinutes": 6,
  "roundingMode": "nearest",
  "minimumBillableMinutes": 6,
  "billTravel": true,
  "billSupplierRun": true,
  "billAdmin": false,
  "travelRateMultiplier": "0.5",
  "onSiteRateMultiplier": "1.0",
  "maxTravelMinutesPerJobPerDay": 60
}
```
Travel is billed at 50% of base rate, capped at 1 hour per job per day.

### Example 3: No Travel Billing

```json
{
  "roundingIncrementMinutes": 15,
  "roundingMode": "up",
  "minimumBillableMinutes": 30,
  "billTravel": false,
  "billSupplierRun": false,
  "billAdmin": false,
  "travelRateMultiplier": "1.0",
  "onSiteRateMultiplier": "1.0",
  "maxTravelMinutesPerJobPerDay": null
}
```
Only on-site work is billed with 30-minute minimum.
