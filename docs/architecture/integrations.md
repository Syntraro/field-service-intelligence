# External Integrations

## QuickBooks Online (QBO)

**Scope:** Bidirectional sync for Clients, Invoices, and Payments.

**Customer hierarchy:**
- Customer Companies → QBO Customers
- Client Locations → QBO Sub-Customers

**Sync fields (optimistic locking):**
- `qboCustomerId`, `qboInvoiceId`, `qboSyncToken`

**Services:**
- `server/qbo/syncService.ts` — sync orchestration
- `server/qbo/mappers.ts` — entity mapping

**Sync triggers:** Manual sync buttons, automatic on invoice creation/update.

Full policy: `docs/QBO_SYNC_POLICY.md`.

## Route Optimization

**Provider:** OpenRouteService API

**Purpose:** Optimal technician routing for scheduled jobs.

**Capabilities:**
- GPS coordinate conversion for client locations
- Optimal visit sequencing
- Map visualization

**Service:** `server/routeOptimizationService.ts`

## Security: Impersonation

Platform admins can impersonate company admins/owners for support operations.

- Max session: 60 minutes
- Idle timeout: 15 minutes
- Full audit trail: `audit_logs` table
- Implementation: `ImpersonationBanner.tsx` (client), platform auth routes (server)

Full detail: `SECURITY.md`.
