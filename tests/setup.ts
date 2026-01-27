/**
 * Test Setup
 *
 * Configures the test environment for vitest.
 * Ensures the database schema is up-to-date before tests run.
 */

import { beforeAll, afterAll, vi } from "vitest";
import { ensureTestSchema } from "./ensureTestSchema";

// Set test environment
process.env.NODE_ENV = "test";

// Increase test timeout for database operations
beforeAll(async () => {
  vi.setConfig({ testTimeout: 30000 });
  // Ensure all required columns/constraints exist before any test runs
  await ensureTestSchema();
});

afterAll(() => {
  // Cleanup
});
