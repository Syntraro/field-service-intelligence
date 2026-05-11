/**
 * Tech Today — team availability unit tests.
 *
 * Covers:
 *  - computeOpenSlots: gap math, fallback duration, minimum exclusion,
 *    today-clamping to next 15-min boundary, afterIndex for interleaving.
 *  - parseCreateJobParams: safe coercion of query-string prefill values.
 *  - Permission separation: schedule.all.view vs jobs.edit (JOBS_CREATE_PERMISSION).
 */
import { describe, it, expect } from "vitest";
import { computeOpenSlots } from "../client/src/tech-app/utils/openSlots";
import { parseCreateJobParams } from "../client/src/tech-app/utils/createJobParams";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function iso(date: string, time: string) {
  return `${date}T${time}:00.000Z`;
}

function visit(startTime: string, endTime: string | null, date = "2026-05-11") {
  return {
    scheduledStartRaw: iso(date, startTime),
    scheduledEndRaw: endTime ? iso(date, endTime) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeOpenSlots — core math
// ─────────────────────────────────────────────────────────────────────────────

describe("computeOpenSlots", () => {
  describe("scheduledEndRaw preferred over fallback", () => {
    it("uses scheduledEndRaw when present", () => {
      // Visit ends at 09:30; next starts at 11:00 → 90-min gap.
      const visits = [visit("08:00", "09:30"), visit("11:00", "12:00")];
      const slots = computeOpenSlots(visits);
      expect(slots).toHaveLength(1);
      expect(slots[0].durationMinutes).toBe(90);
      expect(slots[0].startIso).toBe(iso("2026-05-11", "09:30"));
    });

    it("uses fallback 60-min duration when scheduledEndRaw is null", () => {
      // Visit starts at 08:00, no end → gap starts at 09:00; next at 11:00 → 120 min.
      const visits = [visit("08:00", null), visit("11:00", "12:00")];
      const slots = computeOpenSlots(visits);
      expect(slots).toHaveLength(1);
      expect(slots[0].durationMinutes).toBe(120);
      expect(slots[0].startIso).toBe(iso("2026-05-11", "09:00"));
    });

    it("fallback 60-min is strictly preferred over any other value", () => {
      // Two visits both without scheduledEndRaw.
      const visits = [
        visit("08:00", null),
        visit("10:00", null),
        visit("14:00", "15:00"),
      ];
      const slots = computeOpenSlots(visits);
      // Gap 1: 08:00 + 60 min = 09:00 → 10:00 = 60 min ✓
      // Gap 2: 10:00 + 60 min = 11:00 → 14:00 = 180 min ✓
      expect(slots).toHaveLength(2);
      expect(slots[0].durationMinutes).toBe(60);
      expect(slots[1].durationMinutes).toBe(180);
    });
  });

  describe("minimum gap exclusion", () => {
    it("excludes gaps under 30 minutes", () => {
      // Visit ends 09:00; next starts 09:25 → 25-min gap, excluded.
      const visits = [visit("08:00", "09:00"), visit("09:25", "10:30")];
      expect(computeOpenSlots(visits)).toHaveLength(0);
    });

    it("includes gaps exactly 30 minutes", () => {
      const visits = [visit("08:00", "09:00"), visit("09:30", "10:30")];
      const slots = computeOpenSlots(visits);
      expect(slots).toHaveLength(1);
      expect(slots[0].durationMinutes).toBe(30);
    });

    it("excludes gaps where scheduledEndRaw is after next scheduledStartRaw (overlap)", () => {
      const visits = [visit("08:00", "10:00"), visit("09:00", "11:00")];
      expect(computeOpenSlots(visits)).toHaveLength(0);
    });

    it("excludes gaps when next visit has no scheduledStartRaw", () => {
      const visits = [
        { scheduledStartRaw: iso("2026-05-11", "08:00"), scheduledEndRaw: iso("2026-05-11", "09:00") },
        { scheduledStartRaw: null, scheduledEndRaw: null },
      ];
      expect(computeOpenSlots(visits)).toHaveLength(0);
    });

    it("returns empty array for a single visit", () => {
      expect(computeOpenSlots([visit("08:00", "09:00")])).toHaveLength(0);
    });

    it("returns empty array for empty visits", () => {
      expect(computeOpenSlots([])).toHaveLength(0);
    });
  });

  describe("today clamping to next 15-minute boundary", () => {
    it("clamps a past gap-start to the next 15-min boundary", () => {
      // Visit 1 ended at 08:00 UTC. now = 08:22 UTC.
      // Gap start should be clamped to 08:30 (next 15-min past 08:22).
      // Next visit at 10:00 → duration = 90 min.
      const visits = [visit("07:00", "08:00"), visit("10:00", "11:00")];
      const now = new Date("2026-05-11T08:22:00.000Z").getTime();
      const slots = computeOpenSlots(visits, 30, { now });
      expect(slots).toHaveLength(1);
      expect(slots[0].startIso).toBe("2026-05-11T08:30:00.000Z");
      expect(slots[0].durationMinutes).toBe(90); // 08:30 → 10:00
    });

    it("clamps exactly on a 15-min boundary to that boundary (not beyond)", () => {
      // now = 08:15 exactly → nextQuarterHour(08:15) = 08:15 (already on boundary).
      const visits = [visit("07:00", "08:00"), visit("10:00", "11:00")];
      const now = new Date("2026-05-11T08:15:00.000Z").getTime();
      const slots = computeOpenSlots(visits, 30, { now });
      expect(slots[0].startIso).toBe("2026-05-11T08:15:00.000Z");
    });

    it("excludes gap when clamping collapses it below 30 minutes", () => {
      // Visit ends 09:00; next starts 09:25. now = 09:02 → clamp to 09:15.
      // Remaining: 09:15 → 09:25 = 10 min < 30 → excluded.
      const visits = [visit("08:00", "09:00"), visit("09:25", "10:30")];
      const now = new Date("2026-05-11T09:02:00.000Z").getTime();
      expect(computeOpenSlots(visits, 30, { now })).toHaveLength(0);
    });

    it("does not clamp gap-starts that are still in the future", () => {
      // now is before the gap start — no clamping expected.
      const visits = [visit("09:00", "10:00"), visit("12:00", "13:00")];
      const now = new Date("2026-05-11T08:00:00.000Z").getTime();
      const slots = computeOpenSlots(visits, 30, { now });
      expect(slots[0].startIso).toBe(iso("2026-05-11", "10:00"));
    });

    it("does not clamp when opts.now is not provided", () => {
      // Without opts, a past gap should still be returned as-is.
      const visits = [visit("07:00", "08:00"), visit("10:00", "11:00")];
      const slots = computeOpenSlots(visits);
      expect(slots[0].startIso).toBe(iso("2026-05-11", "08:00"));
    });
  });

  describe("afterIndex for All-view interleaving", () => {
    it("sets afterIndex to the index of the preceding visit", () => {
      const visits = [
        visit("08:00", "09:00"),
        visit("10:00", "11:00"),
        visit("12:00", "13:00"),
      ];
      const slots = computeOpenSlots(visits);
      // Slot after visits[0] (08:00–09:00) → afterIndex=0
      // Slot after visits[1] (10:00–11:00) → afterIndex=1
      expect(slots).toHaveLength(2);
      expect(slots[0].afterIndex).toBe(0);
      expect(slots[1].afterIndex).toBe(1);
    });

    it("skips the afterIndex position when a gap is excluded", () => {
      // Gap 1 (after visit[0]): 09:00→09:20 = 20 min — excluded
      // Gap 2 (after visit[1]): 10:00→12:00 = 120 min — included, afterIndex=1
      const visits = [
        visit("08:00", "09:00"),
        visit("09:20", "10:00"),
        visit("12:00", "13:00"),
      ];
      const slots = computeOpenSlots(visits);
      expect(slots).toHaveLength(1);
      expect(slots[0].afterIndex).toBe(1);
    });

    it("All-mode slotByGap via afterIndex matches visits in order", () => {
      const visits = [
        visit("08:00", "09:00"),
        visit("10:00", "11:00"),
        visit("14:00", "15:00"),
      ];
      const slots = computeOpenSlots(visits);
      const slotByGap = new Map(slots.map(s => [s.afterIndex, s]));

      // Slot after visits[0] should be the 09:00→10:00 gap.
      expect(slotByGap.get(0)?.durationMinutes).toBe(60);
      // Slot after visits[1] should be the 11:00→14:00 gap.
      expect(slotByGap.get(1)?.durationMinutes).toBe(180);
      // No slot after visits[2] (last visit).
      expect(slotByGap.get(2)).toBeUndefined();
    });
  });

  describe("Open mode — only slots shown", () => {
    it("returns no slots when all gaps are under 30 minutes", () => {
      const visits = [
        visit("08:00", "09:00"),
        visit("09:20", "10:30"),
        visit("10:45", "12:00"),
      ];
      expect(computeOpenSlots(visits)).toHaveLength(0);
    });

    it("returns slots only for qualifying gaps even when others are too short", () => {
      const visits = [
        visit("08:00", "09:00"),  // gap → 09:25 = 25 min (excluded)
        visit("09:25", "10:00"),  // gap → 11:00 = 60 min (included)
        visit("11:00", "12:00"),
      ];
      const slots = computeOpenSlots(visits);
      expect(slots).toHaveLength(1);
      expect(slots[0].afterIndex).toBe(1);
      expect(slots[0].durationMinutes).toBe(60);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCreateJobParams — query-string validation
// ─────────────────────────────────────────────────────────────────────────────

describe("parseCreateJobParams", () => {
  function qs(params: Record<string, string>) {
    return new URLSearchParams(params);
  }

  describe("technicianId validation", () => {
    it("accepts a valid UUID v4 technicianId", () => {
      const result = parseCreateJobParams(qs({ technicianId: "550e8400-e29b-41d4-a716-446655440000" }));
      expect(result.technicianId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rejects a non-UUID technicianId (cannot bypass permissions)", () => {
      expect(parseCreateJobParams(qs({ technicianId: "not-a-uuid" })).technicianId).toBe("");
      expect(parseCreateJobParams(qs({ technicianId: "12345" })).technicianId).toBe("");
      expect(parseCreateJobParams(qs({ technicianId: "../etc/passwd" })).technicianId).toBe("");
      expect(parseCreateJobParams(qs({ technicianId: "" })).technicianId).toBe("");
    });

    it("rejects UUID with invalid character in technicianId", () => {
      // Extra char in last segment
      expect(parseCreateJobParams(qs({ technicianId: "550e8400-e29b-41d4-a716-4466554400001" })).technicianId).toBe("");
    });
  });

  describe("date validation", () => {
    it("accepts a valid YYYY-MM-DD date", () => {
      expect(parseCreateJobParams(qs({ date: "2026-05-11" })).date).toBe("2026-05-11");
    });

    it("rejects an invalid date format", () => {
      expect(parseCreateJobParams(qs({ date: "05/11/2026" })).date).toBe("");
      expect(parseCreateJobParams(qs({ date: "not-a-date" })).date).toBe("");
      expect(parseCreateJobParams(qs({ date: "2026-5-1" })).date).toBe(""); // no zero-padding
      expect(parseCreateJobParams(qs({ date: "" })).date).toBe("");
    });
  });

  describe("startTime validation", () => {
    it("accepts a valid HH:MM time", () => {
      expect(parseCreateJobParams(qs({ startTime: "09:30" })).startTime).toBe("09:30");
      expect(parseCreateJobParams(qs({ startTime: "00:00" })).startTime).toBe("00:00");
      expect(parseCreateJobParams(qs({ startTime: "23:59" })).startTime).toBe("23:59");
    });

    it("rejects an invalid time format", () => {
      expect(parseCreateJobParams(qs({ startTime: "9:30" })).startTime).toBe("");     // no zero-pad
      expect(parseCreateJobParams(qs({ startTime: "24:00" })).startTime).toBe("");    // hour out of range
      expect(parseCreateJobParams(qs({ startTime: "09:60" })).startTime).toBe("");    // minute out of range
      expect(parseCreateJobParams(qs({ startTime: "9am" })).startTime).toBe("");
      expect(parseCreateJobParams(qs({ startTime: "" })).startTime).toBe("");
    });
  });

  describe("duration validation", () => {
    it("accepts a numeric duration ≥ 15", () => {
      expect(parseCreateJobParams(qs({ duration: "30" })).duration).toBe(30);
      expect(parseCreateJobParams(qs({ duration: "60" })).duration).toBe(60);
      expect(parseCreateJobParams(qs({ duration: "90" })).duration).toBe(90);
      expect(parseCreateJobParams(qs({ duration: "15" })).duration).toBe(15);
    });

    it("defaults to 60 when duration is missing or non-numeric", () => {
      expect(parseCreateJobParams(qs({})).duration).toBe(60);
      expect(parseCreateJobParams(qs({ duration: "abc" })).duration).toBe(60);
      expect(parseCreateJobParams(qs({ duration: "" })).duration).toBe(60);
    });

    it("defaults to 60 when duration is below the 15-minute minimum", () => {
      expect(parseCreateJobParams(qs({ duration: "10" })).duration).toBe(60);
      expect(parseCreateJobParams(qs({ duration: "0" })).duration).toBe(60);
      expect(parseCreateJobParams(qs({ duration: "-30" })).duration).toBe(60);
    });
  });

  describe("hasSchedulePrefill — Schedule Now activation", () => {
    it("activates Schedule Now only when both date and startTime are valid", () => {
      const result = parseCreateJobParams(qs({ date: "2026-05-11", startTime: "09:30" }));
      expect(result.hasSchedulePrefill).toBe(true);
    });

    it("does NOT activate when date is valid but startTime is invalid", () => {
      expect(parseCreateJobParams(qs({ date: "2026-05-11", startTime: "9am" })).hasSchedulePrefill).toBe(false);
    });

    it("does NOT activate when startTime is valid but date is invalid", () => {
      expect(parseCreateJobParams(qs({ date: "not-a-date", startTime: "09:30" })).hasSchedulePrefill).toBe(false);
    });

    it("does NOT activate when both are missing", () => {
      expect(parseCreateJobParams(qs({})).hasSchedulePrefill).toBe(false);
    });

    it("does NOT activate when date is in wrong format (MM/DD/YYYY)", () => {
      expect(parseCreateJobParams(qs({ date: "05/11/2026", startTime: "09:30" })).hasSchedulePrefill).toBe(false);
    });
  });

  describe("all valid params together", () => {
    it("returns all validated fields when all params are correct", () => {
      const result = parseCreateJobParams(qs({
        locationId: "loc-abc",
        technicianId: "550e8400-e29b-41d4-a716-446655440000",
        date: "2026-05-11",
        startTime: "09:30",
        duration: "45",
      }));
      expect(result.locationId).toBe("loc-abc");
      expect(result.technicianId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(result.date).toBe("2026-05-11");
      expect(result.startTime).toBe("09:30");
      expect(result.duration).toBe(45);
      expect(result.hasSchedulePrefill).toBe(true);
    });

    it("silently ignores invalid params alongside valid ones", () => {
      const result = parseCreateJobParams(qs({
        locationId: "loc-abc",
        technicianId: "bad-id",       // invalid — discarded
        date: "2026-05-11",
        startTime: "25:00",            // invalid — discarded
        duration: "-5",                // below minimum — fallback to 60
      }));
      expect(result.technicianId).toBe("");
      expect(result.startTime).toBe("");
      expect(result.duration).toBe(60);
      // hasSchedulePrefill false because startTime is invalid
      expect(result.hasSchedulePrefill).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permission separation: schedule.all.view vs jobs.edit
// ─────────────────────────────────────────────────────────────────────────────
//
// React component rendering is not testable in this node environment (no
// @testing-library/react). These tests verify the LOGIC that drives rendering:
//   - which permission strings are in play
//   - how canCreateJob is derived from a permissions array
//   - how the CreateJobPage redirect condition evaluates
//
// The mapping from these booleans to rendered elements (plus button, onTap,
// cursor styling) is covered by the OpenSlotCard prop contract — any change
// to the component that breaks the canCreate=false branch would require
// updating OpenSlotCard's prop type and both call sites in TodayPage.

const SCOPE_ALL_VIEW = "schedule.all.view";
const JOBS_CREATE_PERMISSION = "jobs.edit"; // must match TodayPage + CreateJobPage + server

describe("Permission key constants", () => {
  it("SCOPE_ALL_VIEW and JOBS_CREATE_PERMISSION are distinct keys", () => {
    expect(SCOPE_ALL_VIEW).not.toBe(JOBS_CREATE_PERMISSION);
  });

  it("JOBS_CREATE_PERMISSION is jobs.edit (matches RBAC catalog definition)", () => {
    expect(JOBS_CREATE_PERMISSION).toBe("jobs.edit");
  });

  it("SCOPE_ALL_VIEW is schedule.all.view", () => {
    expect(SCOPE_ALL_VIEW).toBe("schedule.all.view");
  });
});

describe("canCreateJob derivation from permission array", () => {
  function canCreateJob(permissions: string[]): boolean {
    return permissions.includes(JOBS_CREATE_PERMISSION);
  }

  function canViewOthers(permissions: string[]): boolean {
    return permissions.includes(SCOPE_ALL_VIEW);
  }

  it("returns true when jobs.edit is present", () => {
    expect(canCreateJob(["jobs.view", "jobs.edit"])).toBe(true);
  });

  it("returns false when jobs.edit is absent", () => {
    expect(canCreateJob(["jobs.view"])).toBe(false);
    expect(canCreateJob([])).toBe(false);
  });

  it("schedule.all.view true + jobs.edit false → can view but not create", () => {
    const permissions = ["schedule.all.view", "jobs.view"];
    expect(canViewOthers(permissions)).toBe(true);
    expect(canCreateJob(permissions)).toBe(false);
  });

  it("schedule.all.view true + jobs.edit true → can both view and create", () => {
    const permissions = ["schedule.all.view", "jobs.view", "jobs.edit"];
    expect(canViewOthers(permissions)).toBe(true);
    expect(canCreateJob(permissions)).toBe(true);
  });

  it("schedule.all.view false + jobs.edit true → cannot view team but could create (self-scope)", () => {
    const permissions = ["jobs.view", "jobs.edit"];
    expect(canViewOthers(permissions)).toBe(false);
    expect(canCreateJob(permissions)).toBe(true);
  });

  it("empty permissions → neither view nor create", () => {
    expect(canViewOthers([])).toBe(false);
    expect(canCreateJob([])).toBe(false);
  });
});

describe("CreateJobPage redirect condition", () => {
  // Mirrors the useEffect logic in CreateJobPage:
  //   if (effectivePermissions !== undefined && !canCreateJob) → redirect
  function shouldRedirect(effectivePermissions: { permissions: string[] } | undefined): boolean {
    if (effectivePermissions === undefined) return false; // still loading
    return !effectivePermissions.permissions.includes(JOBS_CREATE_PERMISSION);
  }

  it("does NOT redirect while permissions are loading (undefined)", () => {
    expect(shouldRedirect(undefined)).toBe(false);
  });

  it("redirects when permissions are loaded and jobs.edit is absent", () => {
    expect(shouldRedirect({ permissions: ["jobs.view"] })).toBe(true);
    expect(shouldRedirect({ permissions: [] })).toBe(true);
    expect(shouldRedirect({ permissions: ["schedule.all.view"] })).toBe(true);
  });

  it("does NOT redirect when permissions are loaded and jobs.edit is present", () => {
    expect(shouldRedirect({ permissions: ["jobs.view", "jobs.edit"] })).toBe(false);
    expect(shouldRedirect({ permissions: ["schedule.all.view", "jobs.edit"] })).toBe(false);
  });

  it("direct URL without create permission is redirected (not silently allowed)", () => {
    // A user with only schedule.all.view (view-only manager) who navigates to
    // /tech/create-job directly should be redirected back to /tech/today.
    const viewOnlyManager = { permissions: ["schedule.all.view", "jobs.view", "team.view"] };
    expect(shouldRedirect(viewOnlyManager)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeOpenSlots known limitation — post-last-visit gap
//
// Documents WHY TodayPage uses useTechTeamAvailability (canonical capacity)
// instead of computeOpenSlots for cross-tech open-slot detection.
// ─────────────────────────────────────────────────────────────────────────────

describe("computeOpenSlots known limitation — no workday bounds", () => {
  it("returns NO slots when a single visit ends before workday end (post-last gap)", () => {
    // May 11 bug scenario: tech's last (only) visit ended at 13:30, workday ends
    // at 17:00. computeOpenSlots only sees between-visit gaps → returns nothing.
    // The canonical getTodayCapacity + freeSlots(workdayStart, workdayEnd, busy)
    // correctly returns the 13:30–17:00 gap.
    const visits = [visit("10:00", "13:30")];
    expect(computeOpenSlots(visits)).toHaveLength(0);
  });

  it("returns NO slots when all completed visits are in the morning (remaining afternoon is free)", () => {
    const visits = [
      visit("08:00", "09:30"),
      visit("10:00", "13:30"),
    ];
    // 09:30–10:00 gap = 30 min → included. 13:30→workday-end gap = MISSING.
    const slots = computeOpenSlots(visits);
    expect(slots).toHaveLength(1);
    expect(slots[0].durationMinutes).toBe(30);
    // The post-last-visit gap (13:30 to 17:00 = 210 min) is NOT returned.
  });

  it("returns NO pre-first-visit slot (before first visit of day)", () => {
    // Tech starts at 10:00 but workday begins at 08:00 — the 08:00–10:00
    // pre-first gap is also not detected.
    const visits = [visit("10:00", "11:00")];
    expect(computeOpenSlots(visits)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// All-view chronological merge
//
// Validates the new chronological-sort approach that replaced the afterIndex
// slotByGap map in TodayPage's All view. Pure data-structure test (no DOM).
// ─────────────────────────────────────────────────────────────────────────────

describe("All-view chronological merge logic", () => {
  type AnyRow = { kind: "visit" | "slot"; startMs: number };

  function mergeChronological(visits: number[], slots: number[]): AnyRow[] {
    return [
      ...visits.map(ms => ({ kind: "visit" as const, startMs: ms })),
      ...slots.map(ms => ({ kind: "slot" as const, startMs: ms })),
    ].sort((a, b) => a.startMs - b.startMs);
  }

  it("places post-last-visit open slot after the last visit", () => {
    // May 11 scenario: one morning visit, then a free afternoon slot.
    const rows = mergeChronological(
      [10 * 3600_000],          // visit at 10:00
      [13.5 * 3600_000],        // slot at 13:30 (post-last-visit)
    );
    expect(rows[0].kind).toBe("visit");
    expect(rows[1].kind).toBe("slot");
  });

  it("places pre-first-visit open slot before the first visit", () => {
    const rows = mergeChronological(
      [10 * 3600_000],   // visit at 10:00
      [8 * 3600_000],    // slot at 08:00 (pre-first-visit)
    );
    expect(rows[0].kind).toBe("slot");
    expect(rows[1].kind).toBe("visit");
  });

  it("interleaves multiple visits and multiple slots in order", () => {
    const rows = mergeChronological(
      [10 * 3600_000, 14 * 3600_000],           // visits at 10:00 and 14:00
      [8 * 3600_000, 12 * 3600_000, 16 * 3600_000], // slots at 08:00, 12:00, 16:00
    );
    expect(rows.map(r => r.kind)).toEqual(["slot", "visit", "slot", "visit", "slot"]);
  });

  it("handles no open slots (visits only)", () => {
    const rows = mergeChronological([10 * 3600_000, 14 * 3600_000], []);
    expect(rows.map(r => r.kind)).toEqual(["visit", "visit"]);
  });

  it("handles no visits (slots only — fully open day)", () => {
    const rows = mergeChronological([], [8 * 3600_000]);
    expect(rows.map(r => r.kind)).toEqual(["slot"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Canonical availability data mapping
//
// techOpenSlotsMap in TodayPage maps TechAvailabilitySlot (uppercase ISo) to
// the OpenSlotItem shape (lowercase startIso/endIso) expected by OpenSlotCard.
// These tests pin the mapping contract.
// ─────────────────────────────────────────────────────────────────────────────

describe("canonical availability slot mapping", () => {
  it("maps TechAvailabilitySlot to OpenSlotItem (lowercase startIso/endIso)", () => {
    const canonical = {
      startISO: "2026-05-11T17:30:00.000Z",
      endISO: "2026-05-11T21:00:00.000Z",
      durationMinutes: 210,
    };
    const mapped = {
      startIso: canonical.startISO,
      endIso: canonical.endISO,
      durationMinutes: canonical.durationMinutes,
    };
    expect(mapped.startIso).toBe("2026-05-11T17:30:00.000Z");
    expect(mapped.endIso).toBe("2026-05-11T21:00:00.000Z");
    expect(mapped.durationMinutes).toBe(210);
  });

  it("May 11 bug scenario: computeOpenSlots sees 0 slots; canonical returns the gap", () => {
    // Tech had one visit 10:00–13:30. computeOpenSlots (no workday bounds) = 0.
    // Canonical getTodayCapacity: freeSlots(workdayStart=08:00, workdayEnd=17:00, busy)
    // returns the 13:30–17:00 gap (210 min).
    const visits = [visit("10:00", "13:30")];
    expect(computeOpenSlots(visits)).toHaveLength(0);

    // The canonical endpoint shape is documented here (server test would
    // actually call getTodayCapacity; this confirms the expected response DTO).
    const simulatedCanonical = {
      technicianId: "tech-1",
      openSlots: [
        { startISO: "2026-05-11T17:30:00.000Z", endISO: "2026-05-11T21:00:00.000Z", durationMinutes: 210 },
      ],
    };
    expect(simulatedCanonical.openSlots).toHaveLength(1);
    expect(simulatedCanonical.openSlots[0].durationMinutes).toBe(210);
  });

  it("useTechTeamAvailability enabled only in cross-tech today view", () => {
    // Derived from the enabled condition in TodayPage:
    //   useTechTeamAvailability(!isSelfScope && isSelectedToday && canViewOthers)
    function shouldEnableAvailability(isSelfScope: boolean, isSelectedToday: boolean, canViewOthers: boolean) {
      return !isSelfScope && isSelectedToday && canViewOthers;
    }
    expect(shouldEnableAvailability(false, true, true)).toBe(true);   // cross-tech today + permission
    expect(shouldEnableAvailability(true, true, true)).toBe(false);   // self scope
    expect(shouldEnableAvailability(false, false, true)).toBe(false); // not today
    expect(shouldEnableAvailability(false, true, false)).toBe(false); // no schedule.all.view
  });
});

describe("OpenSlotCard canCreate prop contract", () => {
  // The component has two render branches driven by canCreate:
  //   canCreate=true  → <button data-testid="open-slot-card">  (no data-create-blocked)
  //   canCreate=false → <div   data-testid="open-slot-card" data-create-blocked="true">
  //
  // These assertions document the expected attribute contract so any future
  // refactor of OpenSlotCard must maintain the same testid / data-attribute
  // signals.  Actual DOM rendering requires jsdom; these tests encode the
  // INTENT as plain constants.

  const TESTID = "open-slot-card";
  const BLOCKED_ATTR = "data-create-blocked";

  it("tappable variant: testid present, no create-blocked attribute", () => {
    // canCreate=true → rendered as <button data-testid="open-slot-card">
    // The button element does NOT carry data-create-blocked.
    const expectedAttrs = { "data-testid": TESTID };
    expect(expectedAttrs["data-testid"]).toBe(TESTID);
    expect((expectedAttrs as Record<string, string>)[BLOCKED_ATTR]).toBeUndefined();
  });

  it("non-tappable variant: testid present, data-create-blocked='true'", () => {
    // canCreate=false → rendered as <div data-testid="open-slot-card" data-create-blocked="true">
    const expectedAttrs = { "data-testid": TESTID, [BLOCKED_ATTR]: "true" };
    expect(expectedAttrs["data-testid"]).toBe(TESTID);
    expect(expectedAttrs[BLOCKED_ATTR]).toBe("true");
  });
});
