# Secure Tenant Teardown — QA Checklist

**Feature:** Secure 4-Phase Tenant Deletion Workflow
**Shipped:** 2026-05-04
**Risk class:** HIGH — irreversibly deletes tenant data, files, and provider mappings.

This is the manual regression sweep that must pass against a staging environment before the feature is enabled in production. **Do not skip steps.** Every step verifies a structural security property the automated tests cannot fully prove (route-level capability gating, audit log shape, real DB constraints, real Resend/Slack output).

---

## Pre-flight

- [ ] Staging DB has the migration applied: `migrations/2026_05_04_tenant_deletion_requests.sql`. Verify with:
      ```sql
      SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_deletion_requests';
      SELECT indexname FROM pg_indexes WHERE tablename = 'tenant_deletion_requests';
      ```
      Expect the table plus the indexes including `tenant_deletion_requests_one_active_per_tenant_uq`.
- [ ] At least three platform users seeded:
      - `super_a@platform.staging` with role `platform_super_admin`
      - `admin_a@platform.staging` with role `platform_admin`
      - `support_a@platform.staging` with role `platform_support`
- [ ] At least one disposable test tenant exists with: ≥1 client, ≥1 invoice, R2 attachments uploaded, no QBO/Stripe Connect linkage. Note its `companyId`.
- [ ] `PLATFORM_OPS_ALERT_EMAILS` set to a controlled inbox (e.g. ops-staging@…).
- [ ] (Optional) `PLATFORM_TEARDOWN_SLACK_WEBHOOK` set to a #ops-staging channel.

---

## 1 — Capability gating (no UI, just curl)

### 1.1 Tenant user denied
- [ ] Sign in as a regular tenant `owner` at `/login`. With the tenant cookie, hit
      `GET /api/platform/tenants/<companyId>/teardown/preview`.
- [ ] Expect **HTTP 403** with `code: "PLATFORM_NOT_AUTHED"` or platform-role denial. The platform routes must reject tenant sessions outright.

### 1.2 Support user can preview, cannot request
- [ ] Sign in as `support_a` at `/platform/login`. Navigate to a tenant detail page.
- [ ] Verify the **Danger Zone card renders** with the history list, but the "Begin tenant deletion" button is **NOT shown** (capability gate).
- [ ] Hit `POST /api/platform/tenants/<companyId>/teardown/request` directly with curl. Expect **HTTP 403** with `code: "PLATFORM_CAPABILITY_DENIED"` and `capability: "platform:tenant_teardown_request"` in the body.

### 1.3 Admin can request, cannot approve
- [ ] Sign in as `admin_a` at `/platform/login`.
- [ ] In the Danger Zone, the "Begin tenant deletion" button **IS** visible.
- [ ] After filing a request (see step 2), reload — the active-request panel renders, but the green "Approve…" button is **NOT shown** to the admin user.
- [ ] Curl `POST .../approve/<requestId>` with the admin session — expect **HTTP 403** `PLATFORM_CAPABILITY_DENIED`, `capability: "platform:tenant_teardown_approve"`.

### 1.4 Super admin can approve
- [ ] Sign in as `super_a`. The "Approve…" button on the active request **IS** visible (when super_a is not the initiator).

---

## 2 — Happy path: end-to-end deletion

### 2.1 Preview
- [ ] As `admin_a`, click **Begin tenant deletion**.
- [ ] Wizard opens, computes preview within ~5s.
- [ ] Verify preview shows: company name, tenant id (UUID), users count, DB row total, R2 object count + size, "QBO mapping: —", "Stripe mapping: —", staff/portal session counts.
- [ ] Verify `preview_hash` is displayed and is a 64-char hex string.
- [ ] An audit row was written: `SELECT * FROM audit_logs WHERE action = 'platform_tenant_teardown_preview' ORDER BY created_at DESC LIMIT 1;` — confirm `target_company_id` matches and `details->>'previewHash'` matches the UI.

### 2.2 Request submission — typed confirmations enforced
- [ ] In the wizard, leave the reason short (< 20 chars). The submit button stays **disabled**.
- [ ] Type a 20+ char reason. Tenant-name input outline stays red until the exact name is typed (case-sensitive). Same for tenant-id (UUID, monospace) and the phrase `DELETE TENANT`.
- [ ] Submit. Toast shows "Teardown request created — awaiting super-admin approval."
- [ ] Active-request panel appears with status "Pending approval", initiator = `admin_a`, expires-in countdown (60min), and the typed reason in the red callout.
- [ ] Email arrives at `PLATFORM_OPS_ALERT_EMAILS` with subject `[Tenant Teardown] Request CREATED — pending approval`.
- [ ] Audit row exists with `action = 'platform_tenant_teardown_request_created'` and `details->>'requestId'` matches.

### 2.3 Self-approval forbidden
- [ ] Still as `admin_a` (the initiator), curl `POST .../approve/<requestId>` with a password body — expect **HTTP 403** with `code: "SELF_APPROVAL_FORBIDDEN"`. (UI also gates this with the warning "You initiated this — a different super admin must approve.")

### 2.4 Approval re-auth
- [ ] Sign in as `super_a`. Click **Approve…** on the active request.
- [ ] Approval dialog shows tenant name, id, reason, initiator email.
- [ ] Submit with a **wrong password**. Expect inline error "Invalid password" + an audit row `platform_tenant_teardown_approve_reauth_failed` with `details->>'code' = 'INVALID_PASSWORD'`.
- [ ] Submit with the correct password. Toast: "Deletion approved — execution will start after the cooling-off window."
- [ ] Active-request panel updates to "Approved — execution scheduled" with the **30-minute countdown to execution**.
- [ ] Audit row `platform_tenant_teardown_approved` written with `details->>'executionScheduledAt'` populated.
- [ ] Email + Slack alert "Request APPROVED — execution scheduled" delivered.

### 2.5 Cooling-off cancel (sanity, then re-approve)
- [ ] Within the 30-min window, click **Cancel**. Confirm. Toast: "Request cancelled."
- [ ] Active-request panel disappears. History list shows the row with status "Cancelled".
- [ ] Audit row `platform_tenant_teardown_cancelled` written; alert email "Request CANCELLED" sent.
- [ ] **Re-file the request** as `admin_a` and **re-approve** as `super_a` for step 2.6. (Each cancellation/re-file produces a fresh row and audit chain — verify the unique-active-request index by attempting two filings between approvals; second should 409.)

### 2.6 Execution
- [ ] **For QA only**, temporarily set `EXECUTION_DELAY_MS` lower (or wait the full 30 min). Watch the worker logs for `[tenantTeardownExecutorWorker] execute sweep:` lines.
- [ ] When the row transitions, the active-panel status flips to "Executing now" then disappears (history shows "Completed").
- [ ] Audit rows `platform_tenant_teardown_executed` and the underlying `tenantTeardownService` audit rows present.
- [ ] Alert emails: "Execution STARTED" then "Execution COMPLETED".
- [ ] DB verification — every tenant-scoped table is empty for the deleted `companyId`:
      ```sql
      SELECT count(*) FROM jobs WHERE company_id = '<id>';
      SELECT count(*) FROM invoices WHERE company_id = '<id>';
      SELECT count(*) FROM clients WHERE company_id = '<id>';
      -- …etc., every FK table in the inventory
      ```
      Expect 0 across the board.
- [ ] R2 verification — the `tenants/<companyId>/` prefix is empty:
      ```bash
      aws s3 ls s3://<bucket>/tenants/<companyId>/ --endpoint-url <r2>
      ```
      Expect "no such file or directory" or zero objects.
- [ ] Companies row gone: `SELECT * FROM companies WHERE id = '<id>';` returns 0 rows.
- [ ] **The `tenant_deletion_requests` row PERSISTS** with `status='completed'`. The intentional missing FK on `company_id` lets the audit row outlive the company.

---

## 3 — Failure paths

### 3.1 Hash drift detected at execution
- [ ] File a fresh request and approve it. Within the cooling-off window, **modify the tenant** (e.g. create a new job, upload a new R2 file). Wait for execution.
- [ ] The execution row should transition to `failed` with `failure_reason` containing "Preview hash drift detected" or "Tenant-scoped DB rows still present" (depending on which guard fires first). The tenant data must remain intact.
- [ ] Alert email "Execution FAILED" delivered with the failure reason.
- [ ] No tenant rows deleted; rerun a fresh request to clean it up.

### 3.2 Stale preview rejected
- [ ] Open the preview wizard, then sit on the form for >5 minutes. Submit. Expect inline error referencing "Preview is older than 5 minutes — refresh and try again." (`code: PREVIEW_STALE`).

### 3.3 Tampered payload rejected
- [ ] Open browser dev tools while the wizard is open. Modify the in-memory `preview.hashable.totalFkRows` to a different number, then click submit. Expect server rejection with `code: PREVIEW_DRIFT` (the live re-preview re-hashes and disagrees).

### 3.4 Request expiry
- [ ] File a request. Do NOT approve. Wait 60 min (or temporarily lower `REQUEST_EXPIRY_MS`).
- [ ] The expire loop transitions the row to `expired` within ~5 min of the deadline.
- [ ] Audit row `platform_tenant_teardown_expired` + alert "Request EXPIRED" delivered.
- [ ] Approval attempt now returns `code: REQUEST_EXPIRED`.

### 3.5 Cannot cancel an executing row
- [ ] During the brief executing window, attempt `POST .../cancel/<requestId>`. Expect **HTTP 409** with `code: "EXECUTING_NOT_CANCELLABLE"`.

### 3.6 Active-request rate limit
- [ ] File a request, do NOT cancel. Try to file a second on the same tenant. Expect **HTTP 409** with `code: "ACTIVE_REQUEST_EXISTS"` from the service-layer precheck. (DB partial-unique index is the safety net under it — verify by direct INSERT in a SQL console; expect 23505.)

---

## 4 — Audit completeness

For one full cycle (preview → request → approve → execute), confirm every row is present in `audit_logs` with the right shape:

```sql
SELECT action, target_company_id, platform_admin_email, details->>'requestId' AS req_id, created_at
FROM audit_logs
WHERE action LIKE 'platform_tenant_teardown_%'
ORDER BY created_at;
```

Expected (in order):
1. `platform_tenant_teardown_preview` — admin
2. `platform_tenant_teardown_request_created` — admin
3. (any failed reauth attempts: `platform_tenant_teardown_approve_reauth_failed`)
4. `platform_tenant_teardown_approved` — super admin
5. `platform_tenant_teardown_execute_started` — system (F1 hardening, 2026-05-04)
6. `platform_tenant_teardown_executed` — system (F1 hardening, 2026-05-04)

For an expired-then-cancelled tenant, expect `platform_tenant_teardown_expired` (system) instead of execute_started/executed.

All rows have `target_company_id` set. All rows have `details->>'requestId'` matching the same UUID. The `request_user_agent` and `preview_payload_json` fields on the request row are NEVER copied into the audit `details` (sensitive content stays in the source-of-truth table). Worker-emitted rows have `platform_admin_email = 'system'` and include `details.environment.dbHost` (host only — no credentials).

### 4.1 — Stale-executing reaper (F2 hardening, 2026-05-04)

If a worker is killed during a teardown:
- [ ] Verify the row is in `status='executing'` with `execution_started_at` set: `SELECT status, execution_started_at FROM tenant_deletion_requests WHERE id = '<id>';`.
- [ ] Wait `STALE_EXECUTING_AFTER_MS` (60 min by default) past `execution_started_at`. The reaper sweep runs every 5 minutes and will mark the row `failed` with `failure_reason = 'Execution marked failed after stale executing timeout'`.
- [ ] Verify the audit row written: `SELECT details FROM audit_logs WHERE action = 'platform_tenant_teardown_execute_failed' AND details->>'stale' = 'true' ORDER BY created_at DESC LIMIT 1;` — should contain `staleTimeoutMs` and `executionStartedAt`.
- [ ] Verify the alert email has subject `[Tenant Teardown] Execution FAILED` and `failureReason` matches the constant string.
- [ ] **Critical: verify the underlying `teardownTenant` was NOT re-invoked.** Reaper is a state-machine transition only; it never retries the destructive operation. Inspect worker logs for the absence of `[tenantTeardownService]` activity around the reap timestamp.
- [ ] Confirm the row stays in `failed` (cannot transition back to `approved` — only manual SQL or a fresh request can produce a new run).

---

## 5 — Regression sanity (existing flows unchanged)

- [ ] Direct teardown via the legacy `tenantTeardownService` (used by reset scripts) still works for non-platform-admin code paths.
- [ ] Existing platform routes (`/feedback`, `/issues`, `/support-sessions`, `/bulk`, `/entitlements`) untouched — capability gates still pass for the legacy roles.
- [ ] Tenant-side login, jobs, invoices, calendar — all unaffected (touch-test one of each).
- [ ] `npm run check` passes (TypeScript clean).
- [ ] Targeted automated suite green:
      ```bash
      npx vitest run tests/tenant-deletion-request-security.test.ts
      npx vitest run tests/tenant-teardown.test.ts
      npx vitest run tests/platform-auth-separation.test.ts
      ```

---

## Sign-off

- QA engineer: _____ Date: _____
- Platform owner: _____ Date: _____
- Production rollout authorised after both signatures.
