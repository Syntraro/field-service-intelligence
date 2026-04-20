-- 2026-04-19 Hybrid SaaS onboarding state: add companies.onboarding_completed_at.
--
-- Semantics:
--   NULL       -> owner has not finished onboarding; client route guard
--                 redirects `role = 'owner'` users to /onboarding.
--   TIMESTAMP  -> onboarding is considered complete; normal app access.
--
-- Public signups leave this NULL (see server/services/onboardingService.ts).
-- Invite signups never touch it (only the owner is gated; invitees are not
-- owners — server/routes/invitations.ts restricts roles to admin/tech/
-- dispatcher).
--
-- Backfill policy: ALL existing companies at migration time are stamped
-- with `onboarding_completed_at = created_at`. This is a LEGACY BYPASS,
-- not historical truth — legacy tenants must never be forced into the
-- wizard by this rollout.
--
-- Replay-safe via `ADD COLUMN IF NOT EXISTS` + `WHERE onboarding_completed_at IS NULL`.
--
-- Run via: npm run db:migrate

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp;

UPDATE companies
  SET onboarding_completed_at = created_at
  WHERE onboarding_completed_at IS NULL;
