# Key Domain Models

## Tenant Root
- **Companies** — Tenant root. Subscription data, tax settings, QBO connection. All other entities scoped via `companyId`.

## People
- **Users** — Scoped to company. Roles/permissions, technician profiles.
- **Customer Companies** — Main client companies (e.g., "Basil Box").
- **Client Locations** (`client_locations` table) — Service locations under customer companies. Formerly named `clients`.

## Work
- **Jobs** — Work orders. Status workflow, assigned technicians, equipment tracking. Linked to `client_locations`.
  - Statuses: Scheduled, In Progress, Completed, Cancelled, Invoiced, etc.
  - Types: PM, Repair, Install, etc.
  - Supports recurring job series.
- **Job Templates** — Reusable parts/billing configurations per job type.
- **Tasks** — Supplier visit tracking and task management.

## Billing
- **Invoices** — Billing with QBO sync, line items, tax calculation, client visibility toggles (show/hide prices, quantities, etc.).
  - Stored statuses: `draft`, `awaiting_payment`, `sent`, `partial_paid`, `paid`, `voided`.
  - `overdue` is NOT stored — computed at read time as `isPastDue`.
- **Payments** — Applied to invoices.

## Assets & Inventory
- **Equipment** — Location-level asset tracking, linked to jobs.
- **Parts** — Inventory tracking with categories, unit cost, reorder levels.

## QBO Sync Fields
- `qboCustomerId`, `qboInvoiceId`, `qboSyncToken` — optimistic locking for concurrent update protection.
- Customer Companies → QBO Customers; Client Locations → QBO Sub-Customers.

## Numeric Types
- Money amounts and quantities: PostgreSQL `numeric` type, stored as strings in TypeScript for precision.
- Never use JavaScript `number` for currency arithmetic.
