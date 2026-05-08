/**
 * Test Setup
 *
 * Configures the test environment for vitest.
 * Ensures the database schema is up-to-date before tests run.
 */

// 2026-04-29 Stripe completion: bootstrap `.env` before any other import
// runs so DATABASE_URL (and STRIPE_* keys, when needed) are available
// to modules that read process.env at import time. Side-effect import.
import "./loadEnv";

import { beforeAll, afterAll, vi } from "vitest";

// Set test environment BEFORE importing the invariants module
// (it refuses to load when NODE_ENV !== "test")
process.env.NODE_ENV = "test";

// 2026-05-08 Phase 5: provider-credential encryption key (AES-256-GCM,
// 32-byte base64). The crypto helper fails-closed when missing.
if (!process.env.COMMUNICATION_CREDENTIAL_KEY) {
  process.env.COMMUNICATION_CREDENTIAL_KEY =
    "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
}

import { ensureTestDbInvariants } from "./ensureTestDbInvariants";

// Increase test timeout for database operations
beforeAll(async () => {
  vi.setConfig({ testTimeout: 30000 });
  // Patch missing columns/constraints, then verify schema expectations
  await ensureTestDbInvariants();
});

afterAll(() => {
  // Cleanup
});
