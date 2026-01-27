/**
 * Test Setup
 *
 * Configures the test environment for vitest.
 * Ensures the database schema is up-to-date before tests run.
 */

import { beforeAll, afterAll, vi } from "vitest";

// Set test environment BEFORE importing the invariants module
// (it refuses to load when NODE_ENV !== "test")
process.env.NODE_ENV = "test";

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
