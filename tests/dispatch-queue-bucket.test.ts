/**
 * Dispatch queue bucket tests.
 * Source-pin style: verifies behavioural contracts by inspecting source files.
 * Guards against regression on Focus removal and bucket grouping invariants.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const p = (rel: string) => resolve(ROOT, rel);
const read = (rel: string) => readFileSync(p(rel), "utf-8");

// ── Focus UI removed ──────────────────────────────────────────────────────────

describe("Focus UI removed", () => {
  it("FocusCard is not present in DispatchPreview", () => {
    expect(read("client/src/pages/DispatchPreview.tsx")).not.toContain("FocusCard");
  });

  it("Focus state is removed from DispatchPreview", () => {
    const src = read("client/src/pages/DispatchPreview.tsx");
    expect(src).not.toContain("focusedVisitIds");
    expect(src).not.toContain("isSelectionMode");
    expect(src).not.toContain("selectedVisitIdsForFocus");
    expect(src).not.toContain("handleAddToFocus");
    expect(src).not.toContain("handleClearFocus");
  });

  it("Focus props are not passed to DispatchUnscheduledPanel", () => {
    const src = read("client/src/pages/DispatchPreview.tsx");
    expect(src).not.toContain("onToggleSelectionMode");
    expect(src).not.toContain("onAddToFocus");
  });

  it("DispatchUnscheduledPanel has no Focus props", () => {
    const src = read("client/src/components/dispatch/DispatchUnscheduledPanel.tsx");
    expect(src).not.toContain("focusedVisitIds");
    expect(src).not.toContain("isSelectionMode");
    expect(src).not.toContain("onAddToFocus");
  });

  it("DispatchUnscheduledCard has no selection/Focus props", () => {
    const src = read("client/src/components/dispatch/DispatchUnscheduledCard.tsx");
    expect(src).not.toContain("isSelectionMode");
    expect(src).not.toContain("isChecked");
    expect(src).not.toContain("isFocused");
    expect(src).not.toContain("CheckCircle2");
    expect(src).not.toContain("ExternalLink");
  });
});

// ── Queue bucket data contract ────────────────────────────────────────────────

describe("Queue bucket data contract", () => {
  it("DispatchQueueBucket type and canonical values exported from dispatchPreviewTypes", () => {
    const src = read("client/src/components/dispatch/dispatchPreviewTypes.ts");
    expect(src).toContain("DispatchQueueBucket");
    expect(src).toContain("DISPATCH_QUEUE_BUCKET_VALUES");
    expect(src).toContain('"urgent"');
    expect(src).toContain('"today"');
    expect(src).toContain('"on_hold"');
    expect(src).toContain('"less_urgent"');
  });

  it("dispatchQueueBucket is a field on DispatchVisit", () => {
    const src = read("client/src/components/dispatch/dispatchPreviewTypes.ts");
    expect(src).toContain("dispatchQueueBucket: DispatchQueueBucket");
  });

  it("DispatchDropData carries optional queueBucket", () => {
    const src = read("client/src/components/dispatch/dispatchDndTypes.ts");
    expect(src).toContain("queueBucket?");
  });
});

// ── Unscheduled panel renders grouped sections ────────────────────────────────

describe("Unscheduled panel bucket sections", () => {
  it("registers droppable zones with queue-bucket- prefix", () => {
    const src = read("client/src/components/dispatch/DispatchUnscheduledPanel.tsx");
    // Droppable IDs are template literals: `queue-bucket-${bucket}`
    expect(src).toContain("queue-bucket-");
    expect(src).toContain("useDroppable");
    // All four bucket values are iterated via DISPATCH_QUEUE_BUCKET_VALUES
    expect(src).toContain("DISPATCH_QUEUE_BUCKET_VALUES");
  });

  it("bucket sections use useDroppable", () => {
    const src = read("client/src/components/dispatch/DispatchUnscheduledPanel.tsx");
    expect(src).toContain("useDroppable");
    expect(src).toContain("queueBucket: bucket");
  });
});

// ── Missing bucket normalises to today ───────────────────────────────────────

describe("Bucket normalisation", () => {
  it("normalizeQueueBucket returns today for null/undefined", () => {
    const src = read("client/src/components/dispatch/dispatchPreviewMappers.ts");
    expect(src).toContain('return "today"');
  });

  it("buildBacklogCard sets dispatchQueueBucket from bucket param", () => {
    const src = read("client/src/components/dispatch/dispatchPreviewMappers.ts");
    expect(src).toContain("dispatchQueueBucket: bucket");
  });

  it("mapUnscheduledToDispatchVisits reads visitBuckets from DTO", () => {
    const src = read("client/src/components/dispatch/dispatchPreviewMappers.ts");
    expect(src).toContain("visitBuckets");
    expect(src).toContain("normalizeQueueBucket(buckets[idx])");
  });
});

// ── Bucket update mutation ────────────────────────────────────────────────────

describe("updateQueueBucket mutation", () => {
  it("is exported from useDispatchPreviewMutations", () => {
    const src = read("client/src/components/dispatch/useDispatchPreviewMutations.ts");
    expect(src).toContain("updateQueueBucket");
    expect(src).toContain("/queue-bucket");
  });

  it("handleDragEnd handles queueBucket drops", () => {
    const src = read("client/src/pages/DispatchPreview.tsx");
    expect(src).toContain("dropData?.queueBucket");
    expect(src).toContain("updateQueueBucket");
  });

  it("scheduled-visit dropped on bucket calls unschedule + updateQueueBucket", () => {
    const src = read("client/src/pages/DispatchPreview.tsx");
    const bucketBlock = src.slice(
      src.indexOf("dropData?.queueBucket"),
      src.indexOf("// Day view requires technicianId"),
    );
    expect(bucketBlock).toContain('"scheduled-visit"');
    expect(bucketBlock).toContain("unscheduleVisit");
    expect(bucketBlock).toContain("updateQueueBucket");
  });
});

// ── Schema / migration ────────────────────────────────────────────────────────

describe("Schema and migration", () => {
  it("migration file adds dispatch_queue_bucket to job_visits", () => {
    const src = read("migrations/2026_05_17_dispatch_queue_bucket.sql");
    expect(src).toContain("dispatch_queue_bucket");
    expect(src).toContain("ALTER TABLE job_visits");
  });

  it("Drizzle schema includes dispatchQueueBucket on jobVisits", () => {
    const src = read("shared/schema.ts");
    expect(src).toContain("dispatchQueueBucket");
    expect(src).toContain("dispatch_queue_bucket");
  });

  it("UnscheduledJobDto includes visitBuckets", () => {
    const src = read("shared/types/scheduling.ts");
    expect(src).toContain("visitBuckets");
  });
});

// ── Server validation ─────────────────────────────────────────────────────────

describe("Server queue-bucket endpoint", () => {
  it("scheduling route has PATCH /visit/:visitId/queue-bucket", () => {
    const src = read("server/routes/scheduling.ts");
    expect(src).toContain("/visit/:visitId/queue-bucket");
    expect(src).toContain("queueBucketSchema");
  });

  it("queueBucketSchema validates all four bucket values", () => {
    const src = read("server/routes/scheduling.ts");
    expect(src).toContain('"urgent"');
    expect(src).toContain('"today"');
    expect(src).toContain('"on_hold"');
    expect(src).toContain('"less_urgent"');
  });

  it("visitBuckets subquery is in getUnscheduledJobs storage", () => {
    const src = read("server/storage/scheduling.ts");
    expect(src).toContain("visitBuckets");
    expect(src).toContain("visitBucketsSubquery");
    expect(src).toContain("dispatch_queue_bucket");
  });

  it("visitBuckets is forwarded in unscheduled route response", () => {
    const src = read("server/routes/scheduling.ts");
    expect(src).toContain("visitBuckets");
  });
});
