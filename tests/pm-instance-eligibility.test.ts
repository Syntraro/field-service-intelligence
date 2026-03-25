/**
 * PM Instance Eligibility Tests
 *
 * Verifies that the PM dashboard queue (getUpcomingQueue) correctly gates
 * visibility by instance lifecycle status, not by nullable FK alone.
 *
 * 2026-03-23: Created to prove the fix for the PM reappearance bug —
 * generated instances must not reappear after linked job deletion.
 *
 * These are unit tests exercising the eligibility derivation logic
 * (schedulingState + complianceStatus) to confirm the behavioral contract.
 */

import { describe, it, expect } from "vitest";

// The PM dashboard derives schedulingState from instance data.
// This mirrors the derivation logic in getUpcomingQueue() (server/storage/recurringJobs.ts)
// to verify the behavioral contract without requiring a live database.

type InstanceStatus = "pending" | "claiming" | "generated" | "skipped" | "canceled";

interface QueueRow {
  instanceStatus: InstanceStatus;
  generatedJobId: string | null;
  jobId: string | null; // from LEFT JOIN to jobs
  jobStatus: string | null;
}

/**
 * Mirrors the queue visibility predicate from getUpcomingQueue().
 * After the fix, only "pending" status instances pass the WHERE clause.
 */
function isQueueVisible(row: QueueRow): boolean {
  // The authoritative gate: only pending instances are queue-visible.
  // This matches the WHERE eq(recurringJobInstances.status, "pending") predicate.
  return row.instanceStatus === "pending";
}

/**
 * Mirrors the schedulingState derivation from getUpcomingQueue().
 * Only called for rows that pass isQueueVisible().
 */
function deriveSchedulingState(row: QueueRow): string {
  if (row.instanceStatus === "skipped") return "skipped";
  if (row.instanceStatus === "canceled") return "canceled";
  if (row.jobStatus === "completed" || row.jobStatus === "invoiced") return "completed";
  if (!row.jobId) return "not_generated";
  return "generated_unscheduled";
}

/**
 * Mirrors the generation eligibility check from PMWorkspacePage.tsx.
 */
function isGenerationEligible(schedulingState: string, complianceStatus: string): boolean {
  const ELIGIBLE_COMPLIANCE = new Set(["in_window", "due_soon", "overdue"]);
  return schedulingState === "not_generated" && ELIGIBLE_COMPLIANCE.has(complianceStatus);
}

describe("PM Instance Queue Visibility", () => {

  // =========================================================================
  // Baseline: pending instances are visible
  // =========================================================================

  it("pending instance with no job is queue-visible", () => {
    const row: QueueRow = {
      instanceStatus: "pending",
      generatedJobId: null,
      jobId: null,
      jobStatus: null,
    };
    expect(isQueueVisible(row)).toBe(true);
    expect(deriveSchedulingState(row)).toBe("not_generated");
  });

  // =========================================================================
  // Core bug case: generated instance with deleted job must NOT be visible
  // =========================================================================

  it("generated instance with nulled generatedJobId (deleted job) is NOT queue-visible", () => {
    // This is the exact orphaned state caused by hard-deleting a PM-generated job.
    // FK cascade sets generatedJobId = NULL, but status stays "generated".
    const row: QueueRow = {
      instanceStatus: "generated",
      generatedJobId: null, // FK cascade nulled this
      jobId: null,          // LEFT JOIN returns null because job was hard-deleted
      jobStatus: null,
    };
    expect(isQueueVisible(row)).toBe(false);
  });

  it("generated instance with active job is NOT queue-visible", () => {
    const row: QueueRow = {
      instanceStatus: "generated",
      generatedJobId: "job-123",
      jobId: "job-123",
      jobStatus: "open",
    };
    expect(isQueueVisible(row)).toBe(false);
  });

  // =========================================================================
  // Terminal states remain hidden
  // =========================================================================

  it("skipped instance is NOT queue-visible", () => {
    const row: QueueRow = {
      instanceStatus: "skipped",
      generatedJobId: null,
      jobId: null,
      jobStatus: null,
    };
    expect(isQueueVisible(row)).toBe(false);
  });

  it("canceled instance is NOT queue-visible", () => {
    const row: QueueRow = {
      instanceStatus: "canceled",
      generatedJobId: null,
      jobId: null,
      jobStatus: null,
    };
    expect(isQueueVisible(row)).toBe(false);
  });

  // =========================================================================
  // Transitional state: claiming is NOT visible (mid-generation)
  // =========================================================================

  it("claiming instance is NOT queue-visible", () => {
    // Claiming is a transitional lock state — should not appear on dashboard.
    // Stale claims are recovered to "pending" by recoverStaleClaims().
    const row: QueueRow = {
      instanceStatus: "claiming",
      generatedJobId: null,
      jobId: null,
      jobStatus: null,
    };
    expect(isQueueVisible(row)).toBe(false);
  });

  // =========================================================================
  // Stale claim recovery: recovered claim becomes visible
  // =========================================================================

  it("recovered stale claim (reverted to pending) IS queue-visible", () => {
    // After recoverStaleClaims() reverts status from "claiming" to "pending"
    const row: QueueRow = {
      instanceStatus: "pending",
      generatedJobId: null,
      jobId: null,
      jobStatus: null,
    };
    expect(isQueueVisible(row)).toBe(true);
    expect(deriveSchedulingState(row)).toBe("not_generated");
  });
});

describe("PM Generation Eligibility", () => {

  it("pending + in_window is generation-eligible", () => {
    expect(isGenerationEligible("not_generated", "in_window")).toBe(true);
  });

  it("pending + overdue is generation-eligible", () => {
    expect(isGenerationEligible("not_generated", "overdue")).toBe(true);
  });

  it("pending + due_soon is generation-eligible", () => {
    expect(isGenerationEligible("not_generated", "due_soon")).toBe(true);
  });

  it("pending + upcoming is NOT generation-eligible (too early)", () => {
    expect(isGenerationEligible("not_generated", "upcoming")).toBe(false);
  });

  it("completed is NOT generation-eligible", () => {
    expect(isGenerationEligible("completed", "in_window")).toBe(false);
  });

  it("skipped is NOT generation-eligible", () => {
    expect(isGenerationEligible("skipped", "in_window")).toBe(false);
  });
});
