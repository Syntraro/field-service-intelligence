# Subscription Management

This document explains the tenant subscription system for Monthly and Annual billing cycles.

## Overview

The subscription system supports:
- **Monthly billing**: Ongoing subscription with no end date
- **Annual billing**: Fixed 1-year term with optional auto-renewal
- **Renewal notices**: Automatic notifications at 30 and 7 days before annual term end
- **End-of-term automation**: Auto-renew or convert to monthly based on settings
- **Idempotent processing**: Safe to run the worker multiple times without duplicates

## Database Tables

### `tenant_subscriptions`
Stores one subscription per company (tenant).

| Column | Description |
|--------|-------------|
| `id` | Primary key |
| `company_id` | Tenant foreign key (unique) |
| `plan_id` | Optional link to subscription_plans |
| `billing_cycle` | 'monthly' or 'annual' |
| `status` | 'active', 'pending_renewal', or 'cancelled' |
| `auto_renew_annual` | If true, annual subscriptions auto-renew |
| `start_date` | When the subscription started |
| `end_date` | Required for annual (term end), null for monthly |
| `cancelled_at` | When the user cancelled |
| `reverted_from_annual` | True if was annual and auto-reverted to monthly |

### `subscription_events`
Audit trail and idempotency guard.

| Column | Description |
|--------|-------------|
| `id` | Primary key |
| `subscription_id` | Foreign key to tenant_subscriptions |
| `company_id` | Denormalized for tenant queries |
| `type` | Event type (see below) |
| `term_end_date` | The end date this event applies to (for idempotency) |
| `metadata` | JSON with additional context |
| `created_at` | When the event was recorded |

**Event Types:**
- `signup` - Initial subscription creation
- `renewal_notice_30` - 30-day renewal reminder sent
- `renewal_notice_7` - 7-day renewal reminder sent
- `annual_renewed` - Annual subscription auto-renewed
- `reverted_to_monthly` - Annual subscription converted to monthly
- `cancelled` - User cancelled the subscription
- `manual_renewal` - User manually renewed to annual

## API Endpoints

All endpoints are tenant-scoped via `req.companyId`.

### GET /api/subscriptions/me
Returns current subscription with computed fields:
```json
{
  "subscription": { ... },
  "daysUntilEnd": 45,
  "isInRenewalWindow": false,
  "willAutoRenew": true,
  "willRevertToMonthly": false
}
```

### POST /api/subscriptions/signup
Create or update subscription.
```json
{
  "billingCycle": "annual",
  "autoRenewAnnual": true,
  "planId": "optional-plan-id"
}
```

### POST /api/subscriptions/cancel
Cancel the subscription.
- Annual: `status='cancelled'`, access remains until `endDate`
- Monthly: `status='cancelled'` immediately

### POST /api/subscriptions/auto-renew
Toggle auto-renewal (annual only).
```json
{
  "autoRenewAnnual": true
}
```

### POST /api/subscriptions/renew-annual
Manually renew or convert to annual.
```json
{
  "autoRenewAnnual": true
}
```

### GET /api/subscriptions/events
Get subscription event history.

## Subscription Worker

The worker runs daily and handles:
1. **30-day notices**: Send renewal reminders
2. **7-day notices**: Send final reminders
3. **End-of-term processing**:
   - If `autoRenewAnnual=true`: Extend `endDate` by 1 year
   - If `autoRenewAnnual=false` and not cancelled: Convert to monthly
   - If `status='cancelled'`: Skip (user keeps access until `endDate`)

### Running the Worker

**In production**, call the worker daily via cron:

```typescript
import { runSubscriptionWorker } from './server/services/subscriptionWorker';

// Run daily at midnight UTC
cron.schedule('0 0 * * *', async () => {
  const result = await runSubscriptionWorker();
  console.log('Subscription worker result:', result);
});
```

**For testing**, use the dev script:

```bash
# Run worker manually
npm run dev:subscription-worker

# Or via the API (if you add a route):
curl -X POST http://localhost:5000/api/admin/run-subscription-worker
```

### Testing the Worker

The worker includes helper functions for testing:

```typescript
import {
  runSubscriptionWorker,
  processSubscriptionForTesting,
  fastForwardEndDate
} from './server/services/subscriptionWorker';

// Test 1: Create annual subscription with autoRenew=OFF, fast-forward, run worker
// Expected: Subscription converts to monthly
await fastForwardEndDate(companyId, 1); // Set endDate to yesterday
await runSubscriptionWorker();
// Check: billingCycle should now be 'monthly', endDate should be null

// Test 2: Create annual subscription with autoRenew=ON, fast-forward, run worker
// Expected: endDate extends by 1 year
const oldEndDate = subscription.endDate;
await fastForwardEndDate(companyId, 1);
await runSubscriptionWorker();
// Check: endDate should be oldEndDate + 1 year

// Test 3: Run worker twice
// Expected: No duplicate events or processing
await runSubscriptionWorker();
await runSubscriptionWorker();
// Check: Only one 'annual_renewed' or 'reverted_to_monthly' event per term

// Dry run test
const result = await processSubscriptionForTesting(companyId, {
  simulateEndDate: new Date('2025-01-01'),
  dryRun: true
});
console.log(result.action, result.details);
```

## Notification Delivery

Notifications are sent via the in-app notification system. When a renewal notice or state change occurs:

1. The worker records a `subscription_events` entry (idempotency guard)
2. If the event was created (not a duplicate), it calls the notification service
3. Notifications are sent to users with `owner` or `admin` roles

**To configure email delivery** (future enhancement):
- Hook into the notification service
- Check for `subscription_renewal_30`, `subscription_renewal_7`, etc. types
- Send email in addition to in-app notification

## State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                         MONTHLY                                  │
│  endDate=null, status='active'                                  │
│                                                                  │
│  → User can: cancel (→ cancelled immediately)                   │
│  → User can: renew-annual (→ annual)                           │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                              │ (reverted at term end if autoRenew=false)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         ANNUAL                                   │
│  endDate=startDate+1yr, status='active'                         │
│                                                                  │
│  → 30 days before endDate: renewal_notice_30                    │
│  → 7 days before endDate: renewal_notice_7                      │
│  → At endDate:                                                  │
│      - If autoRenew=true: extend endDate +1yr (annual_renewed)  │
│      - If autoRenew=false: convert to monthly (reverted)        │
│  → User can: cancel (→ cancelled, keeps access until endDate)   │
│  → User can: toggle autoRenew                                   │
│  → User can: renew-annual manually (extend +1yr from endDate)   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                              │ (user cancels)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       CANCELLED                                  │
│  status='cancelled', cancelledAt=now                            │
│                                                                  │
│  → Annual: access continues until endDate, then stops           │
│  → Monthly: access stops immediately                            │
│  → Worker skips cancelled subscriptions at end-of-term          │
│  → User can: reactivate (via renew-annual)                      │
└─────────────────────────────────────────────────────────────────┘
```

## UI Components

### Settings > Subscription
Located at `/settings/subscription`, this page allows:
- View current plan and billing cycle
- See days until renewal (for annual)
- Toggle auto-renewal
- Switch from monthly to annual
- Manually renew annual subscriptions
- Cancel subscription

### Signup Flow
When no subscription exists, the page shows billing cycle selection:
- Monthly option (flexible, cancel anytime)
- Annual option (20% savings, with auto-renew toggle)

## Migration

Run the migration to create the tables:

```bash
psql $DATABASE_URL -f migrations/2026_01_16_add_tenant_subscriptions.sql
```

Or push the Drizzle schema:

```bash
npm run db:push
```

## Security Considerations

1. **Tenant Isolation**: All queries filter by `companyId`
2. **Idempotency**: Unique constraint on `(subscriptionId, type, termEndDate)` prevents duplicate processing
3. **Audit Trail**: All state changes recorded in `subscription_events`
4. **Safe Defaults**: Auto-renewal defaults to `true` for best UX, but users can disable
5. **Graceful Cancellation**: Annual subscriptions keep access until term end

## Pricing Integration

The system is designed to work with your pricing logic:
- Link subscriptions to `subscription_plans` via `planId`
- The `revertedFromAnnual` flag can trigger different pricing for users who converted from annual
- Extend the `metadata` JSON in events to track pricing-related information
