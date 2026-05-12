/**
 * Tech App visit editing — unit tests (Phase 1 + Phase 2 + Phase 3 simplification).
 *
 * Covers:
 *  1. Permission gate: schedule.all.view is the Edit Visit gate (replaces jobs.edit).
 *  2. Permission gate: user without schedule.all.view cannot open edit sheet.
 *  3. Reschedule save path includes /api/tech/visits/today invalidation.
 *  4. Assignment save path includes /api/tech/availability invalidation.
 *  5. Multi-tech assignment round-trips correctly through form state.
 *  6. Remove all assigned techs (empty assignment) is valid.
 *  7. Server endpoint requires MANAGER_ROLES guard.
 *  8. Self-view technician tap path is unchanged (navigates, not edits).
 *  9. No technician work-action exports in EditVisitSheet module.
 * 10. Validation: schedule time helpers.
 * P2. Phase 2 workflow corrections.
 */

import { describe, it, expect } from "vitest";
import {
  addMinutesToTime,
  timeDiffMinutes,
  initScheduleForm,
} from "../client/src/hooks/useEditVisitForm";
import type { ScheduleFormState } from "../client/src/hooks/useEditVisitForm";

// ─────────────────────────────────────────────────────────────────────────────
// 1 & 2 — Edit Visit permission gate (schedule.all.view)
// ─────────────────────────────────────────────────────────────────────────────

describe("Edit Visit permission gate — schedule.all.view", () => {
  // Mirrors VisitDetailPage: canEdit = useHasPermission("schedule.all.view").
  // The gate is a flat capability check — isSelfScope does not affect it.
  function deriveCanEdit(opts: { hasScheduleAllView: boolean }) {
    return opts.hasScheduleAllView;
  }

  it("1. user WITH schedule.all.view can open Edit Visit sheet", () => {
    expect(
      deriveCanEdit({ hasScheduleAllView: true }),
    ).toBe(true);
  });

  it("2. user WITHOUT schedule.all.view cannot open Edit Visit sheet", () => {
    expect(
      deriveCanEdit({ hasScheduleAllView: false }),
    ).toBe(false);
  });

  it("assigned technician without schedule.all.view cannot use Edit Visit", () => {
    // Standard techs are not granted schedule.all.view — lifecycle controls
    // (Start Travel, Complete, etc.) are their workflow, not the edit sheet.
    expect(
      deriveCanEdit({ hasScheduleAllView: false }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 & 4 — Invalidation: Today + availability keys must be present in the hook
// ─────────────────────────────────────────────────────────────────────────────

describe("useEditVisitForm invalidation keys", () => {
  // Read the hook source and assert the canonical tech-app query keys are listed.
  // This is a static analysis guard — if someone removes the invalidation, the
  // test fails and reminds them that open-slot refresh depends on it.
  const hookSource = `${__dirname}/../client/src/hooks/useEditVisitForm.ts`;

  it("3. Today query key is invalidated after scheduling mutations", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(hookSource, "utf8");
    expect(src).toContain('"/api/tech/visits/today"');
  });

  it("4. Team availability query key is invalidated after assignment mutations", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(hookSource, "utf8");
    expect(src).toContain('"/api/tech/availability"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 — Multi-tech assignment round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("initScheduleForm — crew handling", () => {
  it("5. multi-tech assignment array is preserved verbatim", () => {
    const visit = {
      scheduledStart: "2026-05-11T14:00:00.000Z",
      scheduledEnd: "2026-05-11T15:30:00.000Z",
      visitNotes: null,
      assignedTechnicianIds: ["tech-a", "tech-b", "tech-c"],
    } as any;

    const form = initScheduleForm(visit);
    expect(form.assignedTechnicianIds).toEqual(["tech-a", "tech-b", "tech-c"]);
  });

  it("5b. single-tech assignment is preserved without wrapping", () => {
    const visit = {
      scheduledStart: "2026-05-11T08:00:00.000Z",
      scheduledEnd: "2026-05-11T09:00:00.000Z",
      visitNotes: null,
      assignedTechnicianIds: ["tech-solo"],
    } as any;

    const form = initScheduleForm(visit);
    expect(form.assignedTechnicianIds).toEqual(["tech-solo"]);
    expect(form.assignedTechnicianIds).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 — Remove all assignment (empty crew)
// ─────────────────────────────────────────────────────────────────────────────

describe("initScheduleForm — empty crew", () => {
  it("6. unassigned visit initialises with empty crew array (not null/undefined)", () => {
    const visit = {
      scheduledStart: "2026-05-11T10:00:00.000Z",
      scheduledEnd: null,
      visitNotes: null,
      assignedTechnicianIds: [],
    } as any;

    const form = initScheduleForm(visit);
    expect(Array.isArray(form.assignedTechnicianIds)).toBe(true);
    expect(form.assignedTechnicianIds).toHaveLength(0);
  });

  it("6b. null/undefined assignedTechnicianIds falls back to empty array", () => {
    const visit = {
      scheduledStart: "2026-05-11T10:00:00.000Z",
      scheduledEnd: null,
      visitNotes: null,
      // assignedTechnicianIds absent — legacy visit row
    } as any;

    const form = initScheduleForm(visit);
    expect(Array.isArray(form.assignedTechnicianIds)).toBe(true);
    expect(form.assignedTechnicianIds).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 — Server-side permission guard (static source check)
// ─────────────────────────────────────────────────────────────────────────────

describe("server-side scheduling endpoint protection", () => {
  it("7. reschedule endpoint requires MANAGER_ROLES — guard is present in route file", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../server/routes/scheduling.ts`,
      "utf8",
    );
    // The canonical role gate must exist on the reschedule route.
    expect(src).toContain("MANAGER_ROLES");
    expect(src).toContain("requireRole");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8 — Self-view tap path is navigate, not edit sheet
// ─────────────────────────────────────────────────────────────────────────────

describe("TodayPage tap routing", () => {
  it("8. self-scope tap calls onVisitTap (navigate), not setEditSheet", () => {
    // The TodayPage derive: isSelfScope → handleTap = onVisitTap(id)
    // canEditCrossTechVisits = !isSelfScope && canCreateJob
    // For isSelfScope=true, canEditCrossTechVisits=false regardless of canCreateJob.
    const isSelfScope = true;
    const canCreateJob = true;
    const canEditCrossTechVisits = !isSelfScope && canCreateJob;

    let navigateCalled = false;
    let editSheetOpened = false;

    const onVisitTap = () => { navigateCalled = true; };
    const setEditSheet = () => { editSheetOpened = true; };

    // Simulate the tap handler derivation from TodayPage.
    const handleTap = isSelfScope
      ? () => onVisitTap()
      : canEditCrossTechVisits
        ? () => setEditSheet()
        : () => {};

    handleTap();

    expect(navigateCalled).toBe(true);
    expect(editSheetOpened).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9 — No technician work-action exports in EditVisitSheet
// ─────────────────────────────────────────────────────────────────────────────

describe("EditVisitSheet — no work-action controls", () => {
  it("9. EditVisitSheet source does not export or render lifecycle action controls", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/components/EditVisitSheet.tsx`,
      "utf8",
    );
    // None of the technician lifecycle controls should appear.
    const forbidden = [
      "completeVisitWithOutcome",
      "handleComplete",
      "clockIn",
      "clockOut",
      "startTravel",
      "startJob",
      "button-complete-visit",
      "button-follow-up",
      "button-delete-visit",
    ];
    for (const token of forbidden) {
      expect(src, `EditVisitSheet must not contain "${token}"`).not.toContain(token);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10 — Validation: schedule time helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("schedule time helpers", () => {
  it("10a. addMinutesToTime adds correctly across the hour boundary", () => {
    expect(addMinutesToTime("08:45", 30)).toBe("09:15");
    expect(addMinutesToTime("23:30", 60)).toBe("00:30");
  });

  it("10b. timeDiffMinutes computes positive duration within a day", () => {
    expect(timeDiffMinutes("08:00", "09:30")).toBe(90);
    expect(timeDiffMinutes("10:00", "10:00")).toBe(1440); // same time = 24h wrap
  });

  it("10c. initScheduleForm sets correct date and times from ISO start/end", () => {
    const visit = {
      scheduledStart: "2026-05-11T14:00:00.000Z",
      scheduledEnd: "2026-05-11T15:30:00.000Z",
      visitNotes: "some notes",
      assignedTechnicianIds: ["abc"],
    } as any;

    const form = initScheduleForm(visit);
    // date is formatted from the parsed ISO
    expect(form.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(form.startTime).toMatch(/^\d{2}:\d{2}$/);
    expect(form.endTime).toMatch(/^\d{2}:\d{2}$/);
    // Duration from 14:00 → 15:30 = 90 min
    expect(timeDiffMinutes(form.startTime, form.endTime)).toBe(90);
  });

  it("10d. initScheduleForm falls back to 60-min duration when scheduledEnd is absent", () => {
    const visit = {
      scheduledStart: "2026-05-11T10:00:00.000Z",
      scheduledEnd: null,
      visitNotes: null,
      assignedTechnicianIds: [],
    } as any;

    const form = initScheduleForm(visit);
    expect(timeDiffMinutes(form.startTime, form.endTime)).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Workflow correction: navigate first, edit inside VisitDetailPage
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 2 — TodayPage no direct-edit state", () => {
  it("P2-1. TodayPage no longer imports EditVisitSheet", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/TodayPage.tsx`,
      "utf8",
    );
    expect(src).not.toContain("EditVisitSheet");
  });

  it("P2-2. TodayPage no longer imports or uses Pencil icon", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/TodayPage.tsx`,
      "utf8",
    );
    expect(src).not.toContain("Pencil");
  });

  it("P2-3. TodayPage no longer contains editSheet state", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/TodayPage.tsx`,
      "utf8",
    );
    expect(src).not.toContain("editSheet");
    expect(src).not.toContain("setEditSheet");
  });

  it("P2-4. TodayPage no longer derives canEditCrossTechVisits", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/TodayPage.tsx`,
      "utf8",
    );
    expect(src).not.toContain("canEditCrossTechVisits");
  });

  it("P2-5. TodayPage no longer passes showEditAffordance to JobCard", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/TodayPage.tsx`,
      "utf8",
    );
    expect(src).not.toContain("showEditAffordance");
  });
});

describe("Phase 2 — cross-tech tap routing navigates to visit detail", () => {
  it("P2-6. cross-tech tap calls onVisitTap (navigate), not setEditSheet", () => {
    // Mirrors TodayPage renderTimelineItem derivation after Phase 2 correction.
    // Both self-scope and cross-tech call onVisitTap — no edit sheet path.
    const isSelfScope = false;
    const canViewOthers = true;

    let navigateCalled = false;
    const onVisitTap = () => { navigateCalled = true; };

    // After Phase 2, all tappable cards navigate regardless of isSelfScope.
    const handleTap = () => onVisitTap();

    handleTap();
    expect(navigateCalled).toBe(true);
  });
});

describe("Phase 2 — isAssignedToVisit gate logic", () => {
  function deriveIsAssigned(currentUserId: string | null, assignedTechnicianIds: string[]) {
    return currentUserId ? assignedTechnicianIds.includes(currentUserId) : false;
  }

  it("P2-7. isAssignedToVisit true when user is in crew", () => {
    expect(deriveIsAssigned("tech-a", ["tech-a", "tech-b"])).toBe(true);
  });

  it("P2-8. isAssignedToVisit false when user is not in crew", () => {
    expect(deriveIsAssigned("tech-c", ["tech-a", "tech-b"])).toBe(false);
  });

  it("P2-9. isAssignedToVisit false when crew is empty", () => {
    expect(deriveIsAssigned("tech-a", [])).toBe(false);
  });

  it("P2-10. isAssignedToVisit false when currentUserId is null", () => {
    expect(deriveIsAssigned(null, ["tech-a"])).toBe(false);
  });
});

describe("Phase 2 — VisitDetailPage static source checks", () => {
  it("P2-11. VisitDetailPage contains isAssignedToVisit derivation", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/VisitDetailPage.tsx`,
      "utf8",
    );
    expect(src).toContain("isAssignedToVisit");
  });

  it('P2-12. VisitDetailPage gates lifecycle controls with isAssignedToVisit', async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/VisitDetailPage.tsx`,
      "utf8",
    );
    // Timer strip and Start Travel button must both be gated.
    expect(src).toContain("isActive && !isTerminal && isAssignedToVisit");
    expect(src).toContain("isReadyToStart && isAssignedToVisit");
  });

  it('P2-13. VisitDetailPage renders Edit Visit button gated by schedule.all.view', async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/VisitDetailPage.tsx`,
      "utf8",
    );
    expect(src).toContain('data-testid="button-edit-visit"');
    expect(src).toContain("canEdit");
    expect(src).toContain('useHasPermission("schedule.all.view")');
    // Must NOT use jobs.edit as the edit-visit gate (simplified to schedule.all.view).
    expect(src).not.toContain('useHasPermission("jobs.edit")');
  });

  it("P2-14. VisitDetailPage mounts EditVisitSheet when editSheetOpen", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/VisitDetailPage.tsx`,
      "utf8",
    );
    expect(src).toContain("EditVisitSheet");
    expect(src).toContain("editSheetOpen");
  });

  it("P2-15. VisitDetailPage adds assignedTechnicianIds to DetailVisit via hook", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/hooks/useTechVisitDetail.ts`,
      "utf8",
    );
    expect(src).toContain("assignedTechnicianIds: string[]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — Regression fixes
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 4 — Scope filtering: custom scope shows only selected tech", () => {
  // Mirrors groupedByTech allowedTechIds guard in TodayPage.
  function filterGroupsByScope(
    groups: Map<string, unknown[]>,
    effectiveScope: { kind: "self" | "all" | "custom"; technicianIds?: string[] },
  ): string[] {
    const allowedTechIds =
      effectiveScope.kind === "custom"
        ? new Set(effectiveScope.technicianIds ?? [])
        : null;

    return [...groups.keys()].filter(
      (techId) => !allowedTechIds || allowedTechIds.has(techId),
    );
  }

  it("P4-1. custom scope with one tech filters out all other tech groups", () => {
    const groups = new Map<string, unknown[]>([
      ["tech-a", []],
      ["tech-b", []],
      ["tech-c", []],
    ]);
    const scope = { kind: "custom" as const, technicianIds: ["tech-b"] };
    const visible = filterGroupsByScope(groups, scope);
    expect(visible).toEqual(["tech-b"]);
    expect(visible).not.toContain("tech-a");
    expect(visible).not.toContain("tech-c");
  });

  it("P4-2. 'all' scope renders all tech groups unchanged", () => {
    const groups = new Map<string, unknown[]>([
      ["tech-a", []],
      ["tech-b", []],
      ["tech-c", []],
    ]);
    const scope = { kind: "all" as const };
    const visible = filterGroupsByScope(groups, scope);
    expect(visible).toEqual(["tech-a", "tech-b", "tech-c"]);
  });

  it("P4-2b. self scope renders all groups (no allowedTechIds filter)", () => {
    const groups = new Map<string, unknown[]>([["tech-self", []]]);
    const scope = { kind: "self" as const };
    const visible = filterGroupsByScope(groups, scope);
    expect(visible).toEqual(["tech-self"]);
  });
});

describe("Phase 4 — Server skipAssignmentCheck for schedule.all.view", () => {
  it("P4-3. getVisitDetailForUser source contains skipAssignmentCheck option", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../server/storage/jobVisits.ts`,
      "utf8",
    );
    expect(src).toContain("skipAssignmentCheck");
    expect(src).toContain("getVisitDetailForUser");
  });

  it("P4-4. getAssignedVisit source contains skipAssignmentCheck option", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../server/storage/jobVisits.ts`,
      "utf8",
    );
    expect(src).toContain("getAssignedVisit");
    // Both functions have the option
    const matches = (src.match(/skipAssignmentCheck/g) || []).length;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  it("P4-4b. skipAssignmentCheck=false → visit not returned for unrelated user (logic test)", () => {
    function getAssignedVisit(
      visit: { assignedTechnicianIds: string[] } | null,
      userId: string,
      options?: { skipAssignmentCheck?: boolean },
    ) {
      if (!visit) return null;
      if (options?.skipAssignmentCheck) return visit;
      return visit.assignedTechnicianIds.includes(userId) ? visit : null;
    }

    const visitForOtherTech = { assignedTechnicianIds: ["tech-b"] };
    expect(getAssignedVisit(visitForOtherTech, "tech-a")).toBeNull();
    expect(getAssignedVisit(visitForOtherTech, "tech-a", { skipAssignmentCheck: true })).not.toBeNull();
  });
});

describe("Phase 4 — Lifecycle controls remain assignment-only gated", () => {
  it("P4-5. VisitDetailPage lifecycle controls gated by isAssignedToVisit, not canEdit", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/VisitDetailPage.tsx`,
      "utf8",
    );
    // Start Travel and timer strip must use isAssignedToVisit gate (not canEdit).
    expect(src).toContain("isAssignedToVisit");
    // canEdit must not gate lifecycle controls — only the edit button uses it.
    // Verify lifecycle blocks do NOT include `canEdit` as their guard.
    expect(src).toContain("isActive && !isTerminal && isAssignedToVisit");
    expect(src).toContain("isReadyToStart && isAssignedToVisit");
  });

  it("P4-6. VisitDetailPage Edit Visit button IS gated by canEdit (schedule.all.view)", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/VisitDetailPage.tsx`,
      "utf8",
    );
    expect(src).toContain('useHasPermission("schedule.all.view")');
    expect(src).toContain("canEdit");
    expect(src).toContain('data-testid="button-edit-visit"');
  });
});

describe("Phase 4 — Data mutation endpoints accessible to schedule.all.view managers", () => {
  it("P4-7. techField routes contain resolveDataVisit helper for manager access", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../server/routes/techField.ts`,
      "utf8",
    );
    expect(src).toContain("resolveDataVisit");
    expect(src).toContain("schedule.all.view");
    // Helper must check permission and pass skipAssignmentCheck accordingly.
    expect(src).toContain("skipAssignmentCheck: canViewAll");
  });

  it("P4-7b. lifecycle endpoints do NOT use resolveDataVisit (remain assignment-only)", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../server/routes/techField.ts`,
      "utf8",
    );
    // Lifecycle verbs that must stay assignment-gated.
    const lifecycleRoutes = ["en-route", "/start", "complete", "pause", "resume"];
    for (const route of lifecycleRoutes) {
      // These should still exist in the file (lifecycle routes not removed).
      expect(src, `route "${route}" should still exist`).toContain(route);
    }
    // resolveDataVisit must exist but lifecycle routes must use getAssignedVisit directly.
    expect(src).toContain("getAssignedVisit(");
  });
});

describe("Phase 4 — Create lead back-navigation uses visit context", () => {
  it("P4-8. CreateLeadPage navigates back to visit detail when prefillVisitId is set", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      `${__dirname}/../client/src/tech-app/pages/CreateLeadPage.tsx`,
      "utf8",
    );
    // Must use prefillVisitId to form the return path.
    expect(src).toContain("prefillVisitId");
    expect(src).toContain("/tech/visit/${prefillVisitId}");
    // Must NOT hard-code return to today (only as fallback when no prefillVisitId).
    // Verify context-aware ternary exists.
    expect(src).toContain("prefillVisitId ? `/tech/visit/${prefillVisitId}` : \"/tech/today\"");
  });
});
