# Job Invoice Hardening

This document describes the backend hardening for the job-to-invoice workflow, ensuring data integrity, idempotency, and controlled mutability.

## Overview

The hardening addresses five key areas:
1. **Idempotency**: One invoice per job, safe handling of double-clicks and race conditions
2. **Pricing Snapshot**: Store prices at invoice creation time
3. **Post-Invoice Immutability**: Block labor/parts mutations on invoiced jobs
4. **Pre-Invoice Validation**: Prevent $0 or incomplete invoices
5. **Status Transitions**: Ensure job status correctly reflects invoiced state

## Database Constraints

### Unique Constraint
The `invoices` table has a unique constraint on `(companyId, jobId)`:

```sql
-- Already exists in schema
CREATE UNIQUE INDEX invoices_company_job_unique ON invoices(company_id, job_id);
```

This constraint:
- Prevents duplicate invoices for the same job
- Enables idempotent invoice creation via ON CONFLICT handling
- Allows race condition handling by catching constraint violations

## Idempotent Invoice Creation

### `createInvoiceFromJob` Method

Located in `server/storage/invoices.ts`, this method is idempotent:

```typescript
async createInvoiceFromJob(
  companyId: string,
  jobId: string,
  options?: { markJobCompleted?: boolean; skipValidation?: boolean }
): Promise<CreateInvoiceResult>
```

**Return Type:**
```typescript
interface CreateInvoiceResult {
  invoice: any;
  created: boolean; // true if newly created, false if already existed
  lines?: any[];
}
```

**Behavior:**
1. Checks if invoice already exists for job → returns existing with `created: false`
2. Validates job data (unless `skipValidation: true`)
3. Creates invoice with atomic job number allocation
4. Handles race conditions by catching unique constraint violation (PostgreSQL error 23505)
5. Re-fetches and returns existing invoice if race condition occurred

**Example Usage:**
```typescript
const result = await storage.createInvoiceFromJob(companyId, jobId);

if (result.created) {
  // New invoice created
  await storage.refreshInvoiceFromJob(companyId, result.invoice.id);
} else {
  // Invoice already existed - idempotent return
  console.log('Invoice already exists:', result.invoice.invoiceNumber);
}
```

## Pre-Invoice Validation

### `validateJobForInvoice` Method

Located in `server/storage/invoices.ts`:

```typescript
async validateJobForInvoice(companyId: string, jobId: string): Promise<InvoiceValidationResult>
```

**Return Type:**
```typescript
interface InvoiceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  jobData?: {
    hasClient: boolean;
    hasLocation: boolean;
    hasParts: boolean;
    hasEquipment: boolean;
    totalAmount: number;
  };
}
```

**Validations Performed:**
- Job exists and belongs to company
- Job has assigned client location
- Client location has parent customer company
- Job has at least one part/line item
- Total invoice amount > $0

**Example:**
```typescript
const validation = await storage.validateJobForInvoice(companyId, jobId);
if (!validation.valid) {
  throw createError(400, `Cannot create invoice: ${validation.errors.join(', ')}`);
}
```

## Post-Invoice Immutability

### Invoiced Job Statuses

Jobs in these statuses are considered "invoiced" and locked:
- `invoiced`
- `paid`
- `payment_pending`

### Storage Layer Guards

The following methods in `server/storage/jobs.ts` check for invoice lock before mutations:

| Method | Action |
|--------|--------|
| `createJobPart` | Add part to job |
| `updateJobPart` | Update part details |
| `deleteJobPart` | Remove part from job |
| `reorderJobParts` | Change part order |
| `createJobEquipment` | Add equipment to job |
| `updateJobEquipment` | Update equipment notes |
| `deleteJobEquipment` | Remove equipment from job |

### Error Response

When a mutation is attempted on an invoiced job:

```json
{
  "error": "Job is invoiced; edits are locked.",
  "code": "JOB_INVOICED_LOCKED"
}
```

HTTP Status: `409 Conflict`

### Override Mechanism

Each mutation method accepts an optional `options` parameter:

```typescript
interface JobMutationOptions {
  overrideInvoiceLock?: boolean;
}

// Example: Update part with override
await storage.updateJobPart(companyId, partId, updates, {
  overrideInvoiceLock: true
});
```

## Manager Override Endpoints

For managers needing to modify invoiced jobs, admin endpoints are available under `/api/jobs/:jobId/admin/`.

### Available Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/jobs/:jobId/admin/parts` | Add part to invoiced job |
| PUT | `/api/jobs/:jobId/admin/parts/:id` | Update part on invoiced job |
| DELETE | `/api/jobs/:jobId/admin/parts/:id` | Remove part from invoiced job |
| POST | `/api/jobs/:jobId/admin/equipment` | Add equipment to invoiced job |
| DELETE | `/api/jobs/:jobId/admin/equipment/:id` | Remove equipment from invoiced job |

### Required Parameters

All admin override endpoints require a `reason` field:

```json
{
  "reason": "Customer requested correction after invoice sent",
  "description": "Replacement filter",
  "quantity": "1",
  "unitPrice": "45.00"
}
```

### Response

Responses include override metadata:

```json
{
  "id": "part-123",
  "description": "Replacement filter",
  "quantity": "1",
  "_adminOverride": true,
  "_reason": "Customer requested correction after invoice sent"
}
```

### Access Control

- Requires `MANAGER_ROLES` (owner, admin, manager)
- Returns `409` if job is NOT invoiced (use regular endpoints instead)
- All operations are logged for audit purposes

## Pricing Snapshot

### How It Works

1. When invoice is created, prices are copied from job parts
2. `refreshInvoiceFromJob` snapshots current prices into `invoice_lines`
3. Each line stores:
   - `unitPrice` - price at invoice time
   - `unitCost` - cost at invoice time (if tracked)
   - `snapshotData` - JSON with original product/part details

### Important: Never Re-derive Prices

Invoice line prices should never be re-calculated from current catalog prices. The snapshot captures prices at invoice creation time.

```typescript
// CORRECT: Prices stored at invoice creation
const line = {
  unitPrice: jobPart.unitPrice,  // Captured from job part
  quantity: jobPart.quantity,
  total: unitPrice * quantity    // Calculated at snapshot time
};

// WRONG: Don't recalculate from catalog
const line = {
  unitPrice: await getCatalogPrice(productId),  // Never do this
};
```

## Testing

### Verify Idempotency

```bash
# Create invoice (first call)
curl -X POST /api/invoices/from-job/job-123 \
  -H "Content-Type: application/json" \
  -d '{"markJobCompleted": true}'
# Response: { "id": "inv-456", "_created": true }

# Create again (idempotent)
curl -X POST /api/invoices/from-job/job-123 \
  -H "Content-Type: application/json" \
  -d '{"markJobCompleted": true}'
# Response: { "id": "inv-456", "_created": false }
```

### Verify Lock Enforcement

```bash
# Try to add part to invoiced job (should fail)
curl -X POST /api/jobs/job-123/parts \
  -H "Content-Type: application/json" \
  -d '{"description": "New part", "quantity": 1}'
# Response: 409 { "error": "Job is invoiced; edits are locked.", "code": "JOB_INVOICED_LOCKED" }

# Use admin override (should succeed)
curl -X POST /api/jobs/job-123/admin/parts \
  -H "Content-Type: application/json" \
  -d '{"reason": "Customer correction", "description": "New part", "quantity": 1}'
# Response: 201 { "id": "...", "_adminOverride": true }
```

### Verify Validation

```bash
# Try to invoice job with no parts
curl -X POST /api/invoices/from-job/empty-job \
  -H "Content-Type: application/json"
# Response: 400 { "error": "Cannot create invoice: Job has no line items" }
```

## Migration Notes

No database migrations required. The hardening uses:
- Existing unique constraint on `(companyId, jobId)`
- Storage layer enforcement (no schema changes)
- New endpoints that use existing storage methods with override flags

## Security Considerations

1. **Tenant Isolation**: All operations filtered by `companyId`
2. **Role-Based Access**: Admin override endpoints require manager role
3. **Audit Trail**: All override operations logged with reason
4. **Graceful Degradation**: Returns 409 for lock conflicts, not 500
5. **Idempotency**: Safe for retry/double-click scenarios

## Related Files

- `server/storage/invoices.ts` - Invoice creation and validation
- `server/storage/jobs.ts` - Job mutation guards
- `server/routes/invoices.ts` - Invoice API endpoints
- `server/routes/jobs.ts` - Job API endpoints including admin overrides
