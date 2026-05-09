/**
 * Equipment-link error surfacing — unit + source pin (2026-05-08).
 *
 * Locks the contract that:
 *   1. The Job ↔ Equipment link mutations surface the server's actual
 *      error (not a hardcoded "Failed to add equipment to job." toast).
 *   2. `JOB_INVOICED_LOCKED` gets a friendly translated copy.
 *   3. Unknown / non-ApiError errors fall back to the supplied generic
 *      copy.
 *
 * The helper itself lives in `client/src/components/equipmentLinkErrors.ts`
 * and is consumed by `JobEquipmentSection.tsx`. The source-pin guard
 * at the bottom asserts the consumer hasn't regressed back to the
 * opaque `onError: () => toast(...)` pattern.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import { describeMutationError } from "../client/src/components/equipmentLinkErrors";
import { ApiError } from "../client/src/lib/queryClient";

const SECTION_PATH = resolve(
  __dirname,
  "../client/src/components/JobEquipmentSection.tsx",
);
const sectionSrc = readFileSync(SECTION_PATH, "utf-8");

// ─── 1. Unit: helper translates the three contract cases ──────────

describe("describeMutationError — friendly translations + fallback", () => {
  const FALLBACK = "Failed to add equipment to job.";

  it("special-cases JOB_INVOICED_LOCKED with the friendly copy", () => {
    const err = new ApiError(
      409,
      "/api/jobs/abc/equipment",
      "Job is invoiced; edits are locked. Contact a manager to unlock.",
      "JOB_INVOICED_LOCKED",
    );
    expect(describeMutationError(err, FALLBACK)).toBe(
      "This job is locked because it has been invoiced.",
    );
  });

  it("returns the server-supplied ApiError.message verbatim for non-special codes", () => {
    const err = new ApiError(
      404,
      "/api/jobs/abc/equipment",
      "Equipment not found",
      // No code set — server didn't tag this 404 with one. Helper still
      // surfaces the message rather than the generic fallback.
    );
    expect(describeMutationError(err, FALLBACK)).toBe("Equipment not found");
  });

  it("returns ApiError.message even when `code` is set but not in the friendly map", () => {
    const err = new ApiError(
      400,
      "/api/jobs/abc/equipment",
      "Invalid equipmentId format",
      "INVALID_UUID", // code present but not translated → use message
    );
    expect(describeMutationError(err, FALLBACK)).toBe(
      "Invalid equipmentId format",
    );
  });

  it("falls back to the supplied generic copy when ApiError carries no message", () => {
    // ApiError with empty message — defensive case if the server ever
    // returns a 5xx with no body. We don't surface "" to the user.
    const err = new ApiError(500, "/api/jobs/abc/equipment", "");
    expect(describeMutationError(err, FALLBACK)).toBe(FALLBACK);
  });

  it("surfaces the message of plain Error instances (e.g. network failures from fetch)", () => {
    const err = new Error("Network request failed");
    expect(describeMutationError(err, FALLBACK)).toBe("Network request failed");
  });

  it("falls back to the generic copy when the thrown value is not an Error", () => {
    expect(describeMutationError("oops", FALLBACK)).toBe(FALLBACK);
    expect(describeMutationError(undefined, FALLBACK)).toBe(FALLBACK);
    expect(describeMutationError({ unrecognized: "shape" }, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("respects the caller's specific fallback (add vs remove paths)", () => {
    const err = new ApiError(500, "/api/jobs/abc/equipment", "");
    expect(
      describeMutationError(err, "Failed to remove equipment from job."),
    ).toBe("Failed to remove equipment from job.");
  });
});

// ─── 2. Source pin: JobEquipmentSection wires the helper ──────────

describe("JobEquipmentSection — wires describeMutationError into both mutations", () => {
  it("imports the extracted helper", () => {
    expect(sectionSrc).toMatch(
      /import\s*\{\s*describeMutationError\s*\}\s*from\s*["']\.\/equipmentLinkErrors["']/,
    );
  });

  it("addMutation.onError reads the error and calls describeMutationError", () => {
    // Pin the canonical handler shape — `onError: (error: ...) => { ... describeMutationError(error, ...) }`.
    // Stops a future refactor from silently going back to `onError: () => toast(...)`.
    expect(sectionSrc).toMatch(
      /onError:\s*\(error:[^)]*\)\s*=>\s*\{[\s\S]{0,400}?describeMutationError\(\s*error,\s*"Failed to add equipment to job\."\s*\)/,
    );
  });

  it("removeMutation.onError reads the error and calls describeMutationError", () => {
    expect(sectionSrc).toMatch(
      /onError:\s*\(error:[^)]*\)\s*=>\s*\{[\s\S]{0,400}?describeMutationError\(\s*error,\s*"Failed to remove equipment from job\."\s*\)/,
    );
  });

  it("does NOT keep the prior opaque `onError: () =>` shape on either mutation", () => {
    // The old form took zero arguments — dropping the error entirely.
    // Both mutations must accept `(error: ...)`. Two `onError: () =>` would
    // mean a regression on at least one.
    const matches = sectionSrc.match(/onError:\s*\(\s*\)\s*=>/g) ?? [];
    expect(matches.length).toBe(0);
  });

  it("retains both generic fallback strings (preserved from prior copy)", () => {
    // Generic fallback is the contract: when the server returns a
    // weird/empty error, the user still gets a reasonable line.
    expect(sectionSrc).toContain('"Failed to add equipment to job."');
    expect(sectionSrc).toContain('"Failed to remove equipment from job."');
  });
});

// ─── 3. Server contract pin: invoiced-job error tags `code` ───────

describe("server contract — `assertJobNotInvoiced` emits the canonical JOB_INVOICED_LOCKED code", () => {
  // The error-handler middleware in `server/middleware/errorHandler.ts`
  // forwards `err.code` to the response body for 409s. So as long as
  // `assertJobNotInvoiced` keeps setting the code below, the client's
  // `describeMutationError(JOB_INVOICED_LOCKED → friendly copy)` branch
  // is meaningful. Pinning the server line stops a server-side rename
  // from silently breaking the client-side translation.
  const STORAGE_PATH = resolve(__dirname, "../server/storage/jobs.ts");
  const storageSrc = readFileSync(STORAGE_PATH, "utf-8");

  it("`assertJobNotInvoiced` throws with statusCode 409 + code JOB_INVOICED_LOCKED", () => {
    expect(storageSrc).toMatch(
      /\(err as any\)\.statusCode\s*=\s*409[\s\S]{0,200}?\(err as any\)\.code\s*=\s*"JOB_INVOICED_LOCKED"/,
    );
  });
});
