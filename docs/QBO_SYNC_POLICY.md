# QuickBooks Online Sync Policy

## Phase 10A: QBO Sync Lock + Out-of-Sync Flagging

### Core Policy

**QuickBooks is the accounting source of truth after sync.**

Once an invoice has been synced to QuickBooks Online (QBO), it becomes "billing-locked" in our app. After sync:

1. Our app does NOT automatically push subsequent billing changes to QBO
2. Users can still make billing changes, but must acknowledge the override
3. Any billing changes to a synced invoice will flag it as "out-of-sync"
4. Out-of-sync invoices require manual reconciliation in QuickBooks

### What is a "QBO-Synced Invoice"?

An invoice is considered synced to QuickBooks if:
- `qboInvoiceId` is set (has a QBO Invoice.Id), OR
- `qboLastSyncedAt` is set (has been synced previously)

### What is a "Billing-Locked Invoice"?

An invoice is billing-locked if:
- `billingLockedAt` is set, OR
- The invoice is QBO-synced (as defined above)

### Billing-Impacting Changes

The following changes are considered "billing-impacting" and require override acknowledgement on synced invoices:

| Field | Description |
|-------|-------------|
| `subtotal` | Invoice subtotal |
| `taxTotal` | Tax amount |
| `total` | Invoice total |
| `amountPaid` | Payment amount |
| `balance` | Balance due |
| `issueDate` | Invoice date |
| `dueDate` | Payment due date |
| `locationId` | Service location (affects billing) |
| `customerCompanyId` | Billing entity |
| `currency` | Currency code |
| `status` | Invoice status |
| Line items | Add, update, delete, or refresh line items |

### Non-Billing Changes (Always Allowed)

The following changes do NOT require override on synced invoices:

- `notesInternal` - Internal notes
- `notesCustomer` - Customer-facing message
- `clientMessage` - Client message
- `workDescription` - Work description
- `showQuantity`, `showUnitPrice`, etc. - Display toggles

### Override Process

When a user attempts to make a billing-impacting change to a synced invoice:

1. The system returns a 409 Conflict error
2. The UI displays a modal requiring:
   - Checkbox acknowledgement that QBO won't be updated
   - Text input for reason (minimum 10 characters)
3. If the user proceeds, the request is retried with:
   - `overrideQboLock: true`
   - `overrideReason: "<user's reason>"`
4. The invoice is marked as out-of-sync:
   - `qboOutOfSync: true`
   - `qboOutOfSyncAt: <timestamp>`
   - `qboOutOfSyncReason: "Edited after QBO sync: <reason>"`

### Out-of-Sync Resolution

Once an invoice is flagged as out-of-sync:

1. The user must manually update QuickBooks to match the changes
2. There is no automatic re-sync mechanism
3. The out-of-sync flag persists until manually cleared (future feature)

### UI Indicators

#### Invoice Detail Page

- **Green banner**: "Synced to QuickBooks" - displayed for in-sync invoices
- **Red banner**: "Out of Sync with QuickBooks" - displayed for out-of-sync invoices

#### Invoice List Page

- **"Synced" badge**: Green badge indicating QBO sync
- **"Out of Sync" badge**: Red warning badge requiring attention
- **Filter buttons**: Quick access to view synced/out-of-sync invoices

### Database Schema

New columns added to the `invoices` table:

| Column | Type | Description |
|--------|------|-------------|
| `billing_locked_at` | timestamp | When billing was locked |
| `billing_lock_reason` | text | "QBO_SYNCED" or other reason |
| `qbo_out_of_sync` | boolean | True if edited after sync |
| `qbo_out_of_sync_at` | timestamp | When invoice went out of sync |
| `qbo_out_of_sync_reason` | text | User-provided reason |
| `last_billing_edit_at` | timestamp | Last billing edit timestamp |
| `last_billing_edit_by` | varchar | User who made last edit |

### API Behavior

| Route | Behavior on Synced Invoice |
|-------|----------------------------|
| `PATCH /api/invoices/:id` | Returns 409 for billing changes without override |
| `POST /api/invoices/:id/lines` | Returns 409 without override |
| `DELETE /api/invoices/:id/lines/:lineId` | Returns 409 without override |
| `POST /api/invoices/:id/refresh-from-job` | Returns 409 without override |
| `POST /api/invoices/:id/send` | Returns 409 for status change without override |
| `POST /api/invoices/:id/void` | Returns 409 for status change without override |

### Migration

Run the migration to add the new columns:

```bash
psql $DATABASE_URL < migrations/2026_01_18_add_invoice_qbo_lock_out_of_sync.sql
```

The migration automatically backfills `billingLockedAt` and `billingLockReason` for invoices that are already synced.

### Audit Trail

All billing lock overrides are logged with:
- Company ID
- Invoice ID
- User ID
- Operation type
- Override reason
- QBO Invoice ID (if applicable)
- Timestamp

These logs are written to the application log as JSON events with event type `qbo_billing_lock_override`.
