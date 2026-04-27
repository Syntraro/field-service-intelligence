/**
 * Unit tests for `client/src/lib/findNextAvailableSlot.ts` plus regression
 * guards for the canonical Create New Job modal.
 *
 * 2026-04-26 v3: rewrote the helper to derive availability from `workday`
 * bounds minus `kind: "booked"` blocks (instead of trusting the server's
 * pre-filtered `kind: "open"` rows, which drop gaps shorter than 120 min
 * and emit full-day extents that broke our past-time filter).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  findNextAvailableSlot,
  formatSlotTimeLabel,
  type CapacityResponse,
} from "../client/src/lib/findNextAvailableSlot";
import { formatDuration } from "../client/src/components/products-services/types";

// ---------------------------------------------------------------------------
// Fixture helpers — build a capacity response with the workday-aware shape
// the new algorithm consumes.
// ---------------------------------------------------------------------------

function tech(opts: {
  id: string;
  name?: string;
  workday: { startISO: string; endISO: string } | null;
  booked?: Array<{ startISO: string; endISO: string }>;
  /** Optional `kind: "open"` rows from the server — included so we can prove
   *  the helper IGNORES them and computes gaps from `booked` + workday. */
  serverOpens?: Array<{ startISO: string; endISO: string }>;
}) {
  const blocks = [
    ...(opts.booked ?? []).map((b) => ({
      kind: "booked" as const,
      startISO: b.startISO,
      endISO: b.endISO,
      durationMinutes: Math.round((Date.parse(b.endISO) - Date.parse(b.startISO)) / 60_000),
    })),
    ...(opts.serverOpens ?? []).map((b) => ({
      kind: "open" as const,
      startISO: b.startISO,
      endISO: b.endISO,
      durationMinutes: Math.round((Date.parse(b.endISO) - Date.parse(b.startISO)) / 60_000),
    })),
  ];
  return {
    technicianId: opts.id,
    name: opts.name ?? opts.id,
    workday: opts.workday,
    scheduleBlocks: blocks,
  };
}

const NINE_AM = "2026-04-26T09:00:00.000Z";
const ELEVEN_AM = "2026-04-26T11:00:00.000Z";
const TWELVE_PM = "2026-04-26T12:00:00.000Z";
const TWO_PM = "2026-04-26T14:00:00.000Z";
const FIVE_PM = "2026-04-26T17:00:00.000Z";
const ONE_FIFTY_PM = "2026-04-26T13:50:00.000Z";

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe("findNextAvailableSlot", () => {
  it("returns null for empty / null capacity", () => {
    expect(findNextAvailableSlot({ technicians: [] }, 60)).toBeNull();
    expect(findNextAvailableSlot(null, 60)).toBeNull();
    expect(findNextAvailableSlot(undefined, 60)).toBeNull();
  });

  it("skips technicians with no workday (off today)", () => {
    const cap: CapacityResponse = {
      technicians: [tech({ id: "t1", workday: null, booked: [] })],
    };
    expect(findNextAvailableSlot(cap, 60, new Date(NINE_AM))).toBeNull();
  });

  // ── Core regression: empty afternoon after a morning job, now ≈ 1:50 PM ──

  it("returns 2:00 PM (window-clipped to now) when only a morning job exists and 'now' is 1:50 PM", () => {
    // The bug: at ~2 PM, the helper used to return null because the only
    // server-emitted "open" row started at the morning's job-end (e.g. 11
    // AM) and got rejected by the past-slot filter. Even when a usable
    // 3-hour afternoon was sitting there.
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "t1",
          name: "Alice",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [{ startISO: NINE_AM, endISO: ELEVEN_AM }], // morning job
          serverOpens: [{ startISO: ELEVEN_AM, endISO: FIVE_PM }], // 6h pre-filtered open
        }),
      ],
    };
    const now = new Date("2026-04-26T14:00:00.000Z");
    const match = findNextAvailableSlot(cap, 120, now); // 2 hours wanted
    expect(match).not.toBeNull();
    expect(match?.technicianId).toBe("t1");
    expect(match?.time).toBe("14:00"); // 2:00 PM
    expect(match?.date).toBe("2026-04-26");
    expect(match?.startISO).toBe(TWO_PM);
    expect(match?.endISO).toBe("2026-04-26T16:00:00.000Z"); // start + 2h
    expect(match?.durationMinutes).toBe(120);
  });

  it("uses workday + booked blocks (NOT the server's pre-filtered `kind: \"open\"` rows)", () => {
    // Construct a case where the server "open" row is misleading by itself
    // — the real free time is shorter than 120min so the server didn't emit
    // an open row at all. We must still find availability from the gap math.
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "t1",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [
            { startISO: NINE_AM, endISO: TWELVE_PM }, // 9–12
            { startISO: "2026-04-26T13:30:00.000Z", endISO: FIVE_PM }, // 1:30–5
          ],
          serverOpens: [], // server filtered the 12-13:30 gap (90min < 120 threshold)
        }),
      ],
    };
    // 60-min request — fits in the 12:00–13:30 gap.
    const match = findNextAvailableSlot(cap, 60, new Date(NINE_AM));
    expect(match?.startISO).toBe(TWELVE_PM);
    expect(match?.time).toBe("12:00");
    expect(match?.endISO).toBe("2026-04-26T13:00:00.000Z");
  });

  // ── Past-time clipping ──

  it("ignores past time when the workday is today (now=1:50 PM, morning gap dropped)", () => {
    // Morning gap exists 9-11, but now is 1:50 PM — that gap is fully past.
    // Afternoon gap [11, 17] minus busy nothing → starts at max(11, 13:50) = 13:50.
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "t1",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [],
        }),
      ],
    };
    const match = findNextAvailableSlot(cap, 60, new Date(ONE_FIFTY_PM));
    expect(match?.startISO).toBe(ONE_FIFTY_PM);
    expect(match?.time).toBe("13:50");
  });

  it("returns null when 'now' is past the workday end (day_over)", () => {
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "t1",
          workday: { startISO: NINE_AM, endISO: "2026-04-26T17:00:00.000Z" },
          booked: [],
        }),
      ],
    };
    const now = new Date("2026-04-26T18:30:00.000Z"); // 6:30 PM — past 5 PM workday end
    expect(findNextAvailableSlot(cap, 60, now)).toBeNull();
  });

  it("returns null when no remaining gap is long enough", () => {
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "t1",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [
            { startISO: NINE_AM, endISO: "2026-04-26T16:30:00.000Z" }, // 9–4:30
          ],
        }),
      ],
    };
    // 9 AM cursor, request 60 min: only 30 minutes left after the 9–16:30 booking
    const match = findNextAvailableSlot(cap, 60, new Date(NINE_AM));
    expect(match).toBeNull();
  });

  // ── Off-shift / cross-tech ──

  it("respects off-shift periods modeled as booked blocks", () => {
    // Lunch-break style: a booked block in the middle of the day. The
    // helper should pick the gap AFTER lunch when the morning gap is too
    // short.
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "t1",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [
            { startISO: NINE_AM, endISO: ELEVEN_AM }, // morning job
            { startISO: TWELVE_PM, endISO: "2026-04-26T13:00:00.000Z" }, // lunch
          ],
        }),
      ],
    };
    // 90-min request, before lunch we only have 60min (11–12). After lunch (13–17) = 4h.
    const match = findNextAvailableSlot(cap, 90, new Date(NINE_AM));
    expect(match?.startISO).toBe("2026-04-26T13:00:00.000Z");
  });

  it("picks the earliest start across multiple technicians", () => {
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "alice",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [{ startISO: NINE_AM, endISO: TWO_PM }], // free 14–17
        }),
        tech({
          id: "bob",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [{ startISO: NINE_AM, endISO: TWELVE_PM }], // free 12–17
        }),
      ],
    };
    const match = findNextAvailableSlot(cap, 60, new Date(NINE_AM));
    expect(match?.technicianId).toBe("bob");
    expect(match?.time).toBe("12:00");
  });

  it("breaks ties on start time with smallest technicianId", () => {
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "tech-zeta",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [],
        }),
        tech({
          id: "tech-alpha",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [],
        }),
      ],
    };
    const match = findNextAvailableSlot(cap, 60, new Date(NINE_AM));
    expect(match?.technicianId).toBe("tech-alpha");
    expect(match?.startISO).toBe(NINE_AM);
  });

  it("accepts `now` as a Date or as an epoch ms", () => {
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "t1",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [],
        }),
      ],
    };
    const epochMs = Date.parse(TWO_PM);
    const matchA = findNextAvailableSlot(cap, 60, epochMs);
    const matchB = findNextAvailableSlot(cap, 60, new Date(epochMs));
    expect(matchA?.time).toBe("14:00");
    expect(matchB?.time).toBe("14:00");
  });

  it("survives malformed booked blocks", () => {
    const cap = {
      technicians: [
        tech({
          id: "t1",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [
            { startISO: "bad", endISO: "bad" } as any,
            null as any,
            { startISO: NINE_AM, endISO: TWELVE_PM },
          ].filter(Boolean) as any,
        }),
      ],
    } as CapacityResponse;
    const match = findNextAvailableSlot(cap, 60, new Date(NINE_AM));
    expect(match?.startISO).toBe(TWELVE_PM); // gap 12-17 picked
  });

  it("technician with no later jobs is available immediately after now", () => {
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "t1",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [{ startISO: NINE_AM, endISO: ELEVEN_AM }], // done by 11
        }),
      ],
    };
    // Now is 2 PM — there are no jobs later in the day; tech is free.
    const match = findNextAvailableSlot(cap, 60, new Date(TWO_PM));
    expect(match?.startISO).toBe(TWO_PM);
    expect(match?.time).toBe("14:00");
    expect(match?.endISO).toBe("2026-04-26T15:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// formatSlotTimeLabel — toast / UI formatter
// ---------------------------------------------------------------------------

describe("formatSlotTimeLabel (toast time === form time)", () => {
  it("renders 14:00 as '2:00 PM'", () => {
    expect(formatSlotTimeLabel("2026-04-26", "14:00")).toBe("2:00 PM");
  });

  it("renders 10:00 as '10:00 AM'", () => {
    expect(formatSlotTimeLabel("2026-04-26", "10:00")).toBe("10:00 AM");
  });

  it("renders midnight as '12:00 AM'", () => {
    expect(formatSlotTimeLabel("2026-04-26", "00:00")).toBe("12:00 AM");
  });

  it("renders noon as '12:00 PM'", () => {
    expect(formatSlotTimeLabel("2026-04-26", "12:00")).toBe("12:00 PM");
  });

  it("preserves minutes (23:30 → 11:30 PM)", () => {
    expect(formatSlotTimeLabel("2026-04-26", "23:30")).toBe("11:30 PM");
  });

  it("falls back to the raw time on malformed input", () => {
    expect(formatSlotTimeLabel("", "14:00")).toBe("14:00");
    expect(formatSlotTimeLabel("2026-04-26", "")).toBe("");
    expect(formatSlotTimeLabel("2026-04-26", "bad")).toBe("bad");
    expect(formatSlotTimeLabel("2026-04-26", "25:00")).toBe("25:00");
  });

  it("toast label matches the form's `match.time` for the regression scenario", () => {
    // "Empty afternoon, 2 PM, 2h request" → form gets "14:00", toast says "2:00 PM".
    const cap: CapacityResponse = {
      technicians: [
        tech({
          id: "t1",
          name: "Alice",
          workday: { startISO: NINE_AM, endISO: FIVE_PM },
          booked: [{ startISO: NINE_AM, endISO: ELEVEN_AM }],
        }),
      ],
    };
    const match = findNextAvailableSlot(cap, 120, new Date(TWO_PM));
    expect(match?.time).toBe("14:00");
    expect(formatSlotTimeLabel(match!.date, match!.time)).toBe("2:00 PM");
  });
});

// ---------------------------------------------------------------------------
// Source-level regression guards on the canonical Create New Job modal.
// ---------------------------------------------------------------------------

describe("QuickAddJobDialog wiring (source-level guard)", () => {
  const filePath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "components",
    "QuickAddJobDialog.tsx",
  );
  const source = fs.readFileSync(filePath, "utf-8");

  it("imports the service-catalog endpoint", () => {
    expect(source).toMatch(/\/api\/items\?type=service/);
  });

  it("renders a service selector with the canonical test id", () => {
    expect(source).toMatch(/data-testid="select-service"/);
  });

  it("auto-fills duration from the selected service", () => {
    expect(source).toMatch(/estimatedDurationMinutes/);
  });

  it("exposes a Find Next Available control wired to the capacity endpoint", () => {
    expect(source).toMatch(/data-testid="button-find-next-available"/);
    expect(source).toMatch(/\/api\/dashboard\/capacity/);
    expect(source).toMatch(/findNextAvailableSlot/);
  });

  it("renders the service selector as a searchable combobox (Popover + CommandInput)", () => {
    expect(source).toMatch(/data-testid="input-service-search"/);
    expect(source).toMatch(/<CommandInput/);
    expect(source).toMatch(/role="combobox"/);
  });

  it("surfaces a Create-service action when the typed text isn't in the catalog", () => {
    // 2026-04-26 polish v6: the action is rendered by the canonical
    // selector shell (CreateOrSelectField → onCreateNew). The action label
    // and testid live in QuickAddJobDialog's call site.
    expect(source).toMatch(/data-testid="option-service-create"/);
    expect(source).toMatch(/Create service:/);
  });

  it("uses a one-shot quick-create POST /api/items for service creation", () => {
    // 2026-04-26 polish v6 replaced the full ProductServiceFormDialog
    // mount with an inline quick-create mutation that POSTs to the
    // canonical /api/items endpoint. No new endpoint introduced; same
    // wire path the EditVisit modal's create flow uses.
    expect(source).toMatch(/createServiceQuickMutation/);
    expect(source).toMatch(/"\/api\/items"/);
    // Quick-create payload must set type=service so it lands in the
    // service catalog and not the products list.
    expect(source).toMatch(/type:\s*"service"/);
  });

  it("renders durations via the canonical formatDuration helper (hours, not raw minutes)", () => {
    expect(source).toMatch(/formatServiceDuration/);
    expect(source).not.toMatch(/\$\{svc\.estimatedDurationMinutes\}m/);
  });

  it("formats the next-available toast via the canonical formatSlotTimeLabel helper", () => {
    expect(source).toMatch(/formatSlotTimeLabel\(match\.date, match\.time\)/);
    expect(source).not.toMatch(/format\(parseISO\(match\.startISO\)/);
  });

  it("imports findNextAvailableSlot AND formatSlotTimeLabel from the canonical module", () => {
    expect(source).toMatch(
      /import\s*{[^}]*findNextAvailableSlot[^}]*formatSlotTimeLabel[^}]*}\s*from\s*"@\/lib\/findNextAvailableSlot"/,
    );
  });
});

// ---------------------------------------------------------------------------
// Duration formatting helper (shared with products-services UI)
// ---------------------------------------------------------------------------

describe("formatDuration helper (canonical)", () => {
  it("renders 60 minutes as '1h'", () => expect(formatDuration(60)).toBe("1h"));
  it("renders 120 minutes as '2h'", () => expect(formatDuration(120)).toBe("2h"));
  it("renders 90 minutes as '1h 30m'", () => expect(formatDuration(90)).toBe("1h 30m"));
  it("renders 30 minutes as '30m'", () => expect(formatDuration(30)).toBe("30m"));
  it("renders 0 minutes as '0m'", () => expect(formatDuration(0)).toBe("0m"));
  it("renders null/undefined as '-'", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(undefined)).toBe("-");
  });
  it("renders 75 minutes as '1h 15m'", () => expect(formatDuration(75)).toBe("1h 15m"));
});

// ---------------------------------------------------------------------------
// AddVisitDialog wiring — guards the 2026-04-26 silent-schedule-failure fix.
// The dialog must:
//   - forward `jobVersion` into `scheduleVisit` as `expectedVersion`,
//   - check the returned `result.ok` before firing the success toast,
//   - keep the modal open on failure (no `onOpenChange(false)` on !ok).
// ---------------------------------------------------------------------------

describe("AddVisitDialog — silent schedule-failure regression guards", () => {
  const filePath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "components",
    "AddVisitDialog.tsx",
  );
  const source = fs.readFileSync(filePath, "utf-8");

  it("forwards jobVersion into scheduleVisit as expectedVersion", () => {
    expect(source).toMatch(/expectedVersion:\s*jobVersion/);
  });

  it("destructures jobVersion from props (no longer dropping it)", () => {
    expect(source).toMatch(/function AddVisitDialog\([\s\S]*?jobVersion[\s\S]*?\}\s*:\s*AddVisitDialogProps/);
  });

  it("guards the success toast behind result.ok", () => {
    // Must check the returned DispatchMutationResult.ok before toasting +
    // closing. If the next-line check on the result object disappears,
    // we'd be back to the silent-success behaviour.
    expect(source).toMatch(/const\s+result\s*=\s*await\s+scheduleVisit/);
    expect(source).toMatch(/if\s*\(\s*!\s*result\.ok\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// useDispatchPreviewMutations — scheduleVisit must prefer expectedVersion
// over the cache-derived freshVersion lookup, and return a structured
// result instead of swallowing errors.
// ---------------------------------------------------------------------------

describe("useDispatchPreviewMutations — typed-result guards (Option A)", () => {
  const filePath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "components",
    "dispatch",
    "useDispatchPreviewMutations.ts",
  );
  const source = fs.readFileSync(filePath, "utf-8");

  it("DispatchMutationResult is exported from the hook module", () => {
    expect(source).toMatch(/export\s+type\s+DispatchMutationResult/);
  });

  // ── scheduleVisit ──

  it("ScheduleParams accepts an explicit expectedVersion", () => {
    expect(source).toMatch(/expectedVersion\?:\s*number/);
  });

  it("scheduleVisit prefers expectedVersion over freshVersion()", () => {
    expect(source).toMatch(/expectedVersion\s*\?\?\s*freshVersion\(/);
  });

  it("scheduleVisit declares Promise<DispatchMutationResult>", () => {
    expect(source).toMatch(/const\s+scheduleVisit\s*=\s*useCallback\(async[\s\S]*?Promise<DispatchMutationResult>/);
  });

  // ── rescheduleVisit ──

  it("rescheduleVisit declares Promise<DispatchMutationResult>", () => {
    expect(source).toMatch(/const\s+rescheduleVisit\s*=\s*useCallback\(async[\s\S]*?Promise<DispatchMutationResult>/);
  });

  it("rescheduleVisit returns ok:true on success and ok:false on failure", () => {
    // Slice from `const rescheduleVisit` to the next top-level callback so we
    // only assert against this function's body.
    const slice = source.slice(
      source.indexOf("const rescheduleVisit"),
      source.indexOf("const unscheduleVisit"),
    );
    expect(slice).toMatch(/return\s*\{\s*ok:\s*true/);
    expect(slice).toMatch(/return\s*\{\s*ok:\s*false/);
  });

  // ── unscheduleVisit ──

  it("unscheduleVisit declares Promise<DispatchMutationResult>", () => {
    expect(source).toMatch(/const\s+unscheduleVisit\s*=\s*useCallback\(async[\s\S]*?Promise<DispatchMutationResult>/);
  });

  it("unscheduleVisit returns ok:true on success and ok:false on failure", () => {
    const slice = source.slice(
      source.indexOf("const unscheduleVisit"),
      source.indexOf("const resizeVisit"),
    );
    expect(slice).toMatch(/return\s*\{\s*ok:\s*true/);
    expect(slice).toMatch(/return\s*\{\s*ok:\s*false/);
  });

  // ── completeVisitWithOutcome ──

  it("completeVisitWithOutcome declares Promise<DispatchMutationResult>", () => {
    expect(source).toMatch(/const\s+completeVisitWithOutcome\s*=\s*useCallback\(async[\s\S]*?Promise<DispatchMutationResult>/);
  });

  it("completeVisitWithOutcome treats 409 (already terminal) as success", () => {
    const slice = source.slice(
      source.indexOf("const completeVisitWithOutcome"),
      source.indexOf("const reopenVisit"),
    );
    // The 409 short-circuit must return ok:true so the caller's success UI
    // (close modal, run onAfterMutation) still runs — a prior completion
    // already landed; this is the canonical idempotent recovery.
    expect(slice).toMatch(/err\?\.status\s*===\s*409[\s\S]*?return\s*\{\s*ok:\s*true/);
  });

  // ── deleteVisit ──

  it("deleteVisit declares Promise<DispatchMutationResult>", () => {
    expect(source).toMatch(/const\s+deleteVisit\s*=\s*useCallback\(async[\s\S]*?Promise<DispatchMutationResult>/);
  });

  it("deleteVisit returns ok:true on success and ok:false on failure", () => {
    const slice = source.slice(
      source.indexOf("const deleteVisit"),
      source.indexOf("const completeTask"),
    );
    expect(slice).toMatch(/return\s*\{\s*ok:\s*true/);
    expect(slice).toMatch(/return\s*\{\s*ok:\s*false/);
  });
});

// ---------------------------------------------------------------------------
// EditVisitModal — every operational hook caller now branches on result.ok.
// ---------------------------------------------------------------------------

describe("EditVisitModal — Option A caller guards", () => {
  const filePath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "components",
    "visits",
    "EditVisitModal.tsx",
  );
  const source = fs.readFileSync(filePath, "utf-8");

  it("handleSaveOperational unschedule branch checks result.ok", () => {
    expect(source).toMatch(/const\s+result\s*=\s*await\s+unscheduleVisit\(\s*\{\s*visitId,\s*jobId\s*\}\s*\);[\s\S]{0,120}if\s*\(\s*!\s*result\.ok\s*\)/);
  });

  it("handleSaveOperational reschedule (existing-scheduled-visit) branch checks result.ok", () => {
    // Slice down to just the rescheduleVisit branch — this is the third
    // sub-branch in the if / else-if / else chain.
    const slice = source.slice(
      source.indexOf("Reschedule / crew change on an existing"),
      source.indexOf("// Metadata PATCH"),
    );
    expect(slice).toMatch(/const\s+result\s*=\s*await\s+rescheduleVisit/);
    expect(slice).toMatch(/if\s*\(\s*!\s*result\.ok\s*\)/);
  });

  it("handleUnschedule checks result.ok before close", () => {
    const slice = source.slice(
      source.indexOf("const handleUnschedule"),
      source.indexOf("const handleComplete"),
    );
    expect(slice).toMatch(/const\s+result\s*=\s*await\s+unscheduleVisit/);
    expect(slice).toMatch(/if\s*\(\s*!\s*result\.ok\s*\)\s*\{[\s\S]*?return;/);
  });

  it("handleComplete checks result.ok before close", () => {
    const slice = source.slice(
      source.indexOf("const handleComplete"),
      source.indexOf("const handleDelete"),
    );
    expect(slice).toMatch(/const\s+result\s*=\s*await\s+completeVisitWithOutcome/);
    expect(slice).toMatch(/if\s*\(\s*!\s*result\.ok\s*\)\s*\{[\s\S]*?return;/);
  });

  it("handleDelete checks result.ok before close", () => {
    const slice = source.slice(
      source.indexOf("const handleDelete"),
      source.length,
    );
    expect(slice).toMatch(/const\s+result\s*=\s*await\s+deleteVisit/);
    expect(slice).toMatch(/if\s*\(\s*!\s*result\.ok\s*\)\s*\{[\s\S]*?return;/);
  });
});

// ---------------------------------------------------------------------------
// DashboardActionModal — both schedule branches now check result.ok.
// ---------------------------------------------------------------------------

describe("DashboardActionModal — Option A caller guards (rescheduleVisit branch)", () => {
  const filePath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "components",
    "DashboardActionModal.tsx",
  );
  const source = fs.readFileSync(filePath, "utf-8");

  it("captures rescheduleVisit's result before any success UI", () => {
    expect(source).toMatch(/const\s+result\s*=\s*await\s+rescheduleVisit/);
  });

  it("returns early on !result.ok in the rescheduleVisit branch", () => {
    // Slice from the rescheduleVisit call down to the next scheduleVisit
    // call (the alternate branch). The "if (!result.ok) return;" guard
    // must fall inside this range.
    const startIdx = source.indexOf("const result = await rescheduleVisit");
    const endIdx = source.indexOf("const result = await scheduleVisit", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const slice = source.slice(startIdx, endIdx);
    expect(slice).toMatch(/if\s*\(\s*!\s*result\.ok\s*\)\s*\{[\s\S]*?return;/);
  });
});

// ---------------------------------------------------------------------------
// DashboardActionModal + EditVisitModal — guards the 2026-04-26 audit fix.
// Both modals previously fired a green success toast (and closed the row /
// modal) even when scheduleVisit returned { ok: false }. After the fix,
// each scheduleVisit call site MUST branch on `result.ok` before any
// success UI runs.
// ---------------------------------------------------------------------------

describe("DashboardActionModal — scheduleVisit silent-success guard", () => {
  const filePath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "components",
    "DashboardActionModal.tsx",
  );
  const source = fs.readFileSync(filePath, "utf-8");

  it("captures scheduleVisit's result before firing the success toast", () => {
    expect(source).toMatch(/const\s+result\s*=\s*await\s+scheduleVisit/);
    expect(source).toMatch(/if\s*\(\s*!\s*result\.ok\s*\)/);
  });

  it("does not fire the green 'Scheduled' toast inside the !result.ok branch", () => {
    // Sanity: the only literal "Scheduled" success toast lives AFTER
    // the if/else block. The early return on !result.ok must skip it.
    const successToastIdx = source.indexOf(`title: "Scheduled"`);
    const earlyReturnIdx = source.search(/if\s*\(\s*!\s*result\.ok\s*\)\s*\{[\s\S]*?return;\s*\}/);
    expect(successToastIdx).toBeGreaterThan(earlyReturnIdx);
    expect(earlyReturnIdx).toBeGreaterThan(-1);
  });
});

describe("EditVisitModal — scheduleVisit silent-success guard", () => {
  const filePath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "components",
    "visits",
    "EditVisitModal.tsx",
  );
  const source = fs.readFileSync(filePath, "utf-8");

  it("captures scheduleVisit's result on the wasUnscheduled (backlog → scheduled) branch", () => {
    // The promotion path inside handleSaveOperational must check ok
    // before falling through to the "Visit Updated" toast + modal close.
    expect(source).toMatch(/const\s+result\s*=\s*await\s+scheduleVisit/);
    expect(source).toMatch(/if\s*\(\s*!\s*result\.ok\s*\)\s*\{[\s\S]*?return;/);
  });

  it("returns BEFORE flipping notesCarriedByOperational on failure", () => {
    // Defensive: if we set notesCarriedByOperational=true after a failed
    // scheduleVisit, the metadata block would silently skip the notes
    // PATCH and the user's edits would vanish. Order check.
    const m = source.match(
      /const\s+result\s*=\s*await\s+scheduleVisit[\s\S]*?if\s*\(\s*!\s*result\.ok\s*\)\s*\{[\s\S]*?return;\s*\}[\s\S]*?notesCarriedByOperational/,
    );
    expect(m).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TaskDetailPage (tech app) — silent-error fix guards.
// Before 2026-04-26: handleStart's catch only handled timer-conflict; handleStop
// and handleComplete had `catch { /* handled by mutation */ }` but the underlying
// useTechTasks mutations have no onError handler, so failures were entirely
// silent. The fix surfaces an inline error banner via showError(err).
// ---------------------------------------------------------------------------

describe("TaskDetailPage (tech app) — silent-error fix guards", () => {
  const filePath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "tech-app",
    "pages",
    "TaskDetailPage.tsx",
  );
  const source = fs.readFileSync(filePath, "utf-8");

  it("imports the canonical displayApiError helper", () => {
    expect(source).toMatch(/from\s*"\.\.\/utils\/apiErrorDisplay"/);
    expect(source).toMatch(/import\s*\{[^}]*displayApiError[^}]*\}/);
  });

  it("declares actionError state + showError helper", () => {
    expect(source).toMatch(/const\s+\[actionError,\s*setActionError\]/);
    expect(source).toMatch(/const\s+showError\s*=\s*\(err: unknown\)/);
  });

  it("handleStart surfaces non-timer-conflict failures via showError", () => {
    const slice = source.slice(
      source.indexOf("const handleStart"),
      source.indexOf("const handleStop"),
    );
    expect(slice).toMatch(/parseTimerConflict\(e\)/);
    // Non-conflict failures must reach showError (not be silently swallowed).
    expect(slice).toMatch(/showError\(e\)/);
  });

  it("handleStop surfaces failures via showError (replaces empty catch)", () => {
    const slice = source.slice(
      source.indexOf("const handleStop"),
      source.indexOf("const handleComplete"),
    );
    expect(slice).toMatch(/showError\(e\)/);
    // The misleading "/* handled by mutation */" comment must NOT come back.
    expect(slice).not.toMatch(/handled by mutation/);
  });

  it("handleComplete surfaces failures via showError (replaces empty catch)", () => {
    const startIdx = source.indexOf("const handleComplete");
    // Anchor end on the next `return (` AFTER handleComplete (the JSX
    // return). indexOf without a fromIndex would find the first early
    // return at the top of the file and produce an empty slice.
    const endIdx = source.indexOf("return (", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const slice = source.slice(startIdx, endIdx);
    expect(slice).toMatch(/showError\(e\)/);
    expect(slice).not.toMatch(/handled by mutation/);
    // setLocation must remain inside the try (after the await), so it
    // skips on failure. Catches outside the try are fine but the success
    // navigation must be inside.
    expect(slice).toMatch(/await\s+closeTask\.mutateAsync[\s\S]*?setLocation\("\/tech\/today"\)/);
  });

  it("renders an inline error banner that screen readers announce", () => {
    expect(source).toMatch(/data-testid="task-detail-error"/);
    expect(source).toMatch(/role="alert"/);
    expect(source).toMatch(/aria-live="assertive"/);
    // Banner must render only when actionError is non-null so dismissal works.
    expect(source).toMatch(/\{actionError && \(/);
  });
});

// ---------------------------------------------------------------------------
// EditVisitModal — 2026-04-26 service suggestions + duration-driven schedule.
// Guards the four contract points the audit signed off on:
//   1. Suggestions render on empty open + exclude already-selected services.
//   2. ProductOption carries estimatedDurationMinutes through the catalog hook.
//   3. End time is replaced by a Duration select; save still emits ISO ends.
//   4. Adding a service with estimatedDurationMinutes auto-bumps duration
//      ONLY when the user has not manually edited duration.
// ---------------------------------------------------------------------------

describe("EditVisitModal — service suggestions + duration-driven schedule", () => {
  const modalPath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "components",
    "visits",
    "EditVisitModal.tsx",
  );
  const productEntityPath = path.resolve(
    __dirname,
    "..",
    "client",
    "src",
    "lib",
    "entities",
    "productEntity.ts",
  );
  const modalSrc = fs.readFileSync(modalPath, "utf-8");
  const peSrc = fs.readFileSync(productEntityPath, "utf-8");

  // ── ProductOption widening ──────────────────────────────────────────

  it("ProductOption surfaces estimatedDurationMinutes", () => {
    expect(peSrc).toMatch(/estimatedDurationMinutes\?:\s*number\s*\|\s*null/);
  });

  it("normalizeProductRow reads estimated_duration_minutes from snake_case AND camelCase", () => {
    expect(peSrc).toMatch(/r\?\.estimatedDurationMinutes\s*\?\?\s*r\?\.estimated_duration_minutes/);
  });

  it("exports useTopServiceSuggestions + recordServiceUsage from productEntity", () => {
    expect(peSrc).toMatch(/export\s+function\s+useTopServiceSuggestions/);
    expect(peSrc).toMatch(/export\s+function\s+recordServiceUsage/);
  });

  it("recency map is namespaced by company id (no cross-tenant leak)", () => {
    expect(peSrc).toMatch(/syntraro:recent-services:/);
    expect(peSrc).toMatch(/recencyStorageKey\(companyId/);
  });

  it("useTopServiceSuggestions filters excluded ids AND descriptions", () => {
    const sliceStart = peSrc.indexOf("export function useTopServiceSuggestions");
    const sliceEnd = peSrc.indexOf("// ── Normalization ──", sliceStart);
    const slice = peSrc.slice(sliceStart, sliceEnd > sliceStart ? sliceEnd : peSrc.length);
    expect(slice).toMatch(/excludeIds:\s*string\[\]/);
    expect(slice).toMatch(/excludeDescriptions\?:\s*string\[\]/);
    expect(slice).toMatch(/excludeIdSet\.has\(/);
    expect(slice).toMatch(/excludeNameSet\.has\(/);
  });

  // ── ServiceMultiSelect — empty-state suggestions ───────────────────

  it("ServiceMultiSelect renders Suggested services on empty open", () => {
    expect(modalSrc).toMatch(/showingSuggestions/);
    expect(modalSrc).toMatch(/heading="Suggested services"/);
    // Suggestion rows use a backtick-template testid with the svc id
    // appended; quoted-string form would never match.
    expect(modalSrc).toMatch(/option-service-suggested-\$\{svc\.id\}/);
  });

  it("ServiceMultiSelect wires recordServiceUsage on add (typeahead + suggestion + create)", () => {
    const slice = modalSrc.slice(modalSrc.indexOf("function ServiceMultiSelect"));
    // Recency must be recorded for ALL three add paths so the next open
    // shows the just-used item near the top.
    expect((slice.match(/recordServiceUsage\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("ServiceMultiSelect excludes already-selected services by id AND by description", () => {
    const slice = modalSrc.slice(modalSrc.indexOf("function ServiceMultiSelect"));
    expect(slice).toMatch(/selectedProductIds\.has\(/);
    expect(slice).toMatch(/selectedDescriptions/);
  });

  // ── Schedule grid — Duration replaces End ──────────────────────────

  it("schedule grid renders a Duration select instead of an End time input", () => {
    expect(modalSrc).toMatch(/data-testid="select-duration"/);
    expect(modalSrc).not.toMatch(/data-testid="input-end-time"/);
    // Imports the canonical short-form duration options shared with QuickAddJobDialog.
    expect(modalSrc).toMatch(/DURATION_OPTIONS_SHORT[^;]*from\s*"@\/lib\/schedulingConstants"/);
  });

  it("Duration onChange flips manuallyEditedDuration AND derives endTime from startTime + minutes", () => {
    expect(modalSrc).toMatch(/setManuallyEditedDuration\(true\)/);
    expect(modalSrc).toMatch(/addMinutesToTime\(s\.startTime,\s*minutes\)/);
  });

  it("save still emits canonical startAt + endAt ISO strings", () => {
    // The save path is unchanged — derives Date objects from `date + endTime`
    // and serializes via toISOString. Guard the call sites.
    expect(modalSrc).toMatch(/startAt\s*=\s*start\.toISOString\(\)/);
    expect(modalSrc).toMatch(/endAt\s*=\s*end\.toISOString\(\)/);
  });

  // ── Auto-bump on add ───────────────────────────────────────────────

  it("addServiceMutation.onSuccess bumps duration only when not manually edited", () => {
    const slice = modalSrc.slice(modalSrc.indexOf("const addServiceMutation"));
    // Reads duration from the second arg (the input product variables).
    expect(slice).toMatch(/onSuccess:\s*\(_data,\s*product\)/);
    // Guard: bump skipped when the user has overridden duration manually.
    expect(slice).toMatch(/!manuallyEditedDuration/);
    // Bump applies the service's estimatedDurationMinutes ON TOP OF the
    // current duration (accumulate; don't replace).
    expect(slice).toMatch(/currentDur\s*\+\s*dur/);
    // Removing a service must not auto-decrement — guard that
    // removeServiceMutation never reads estimatedDurationMinutes.
    const removeSlice = modalSrc.slice(
      modalSrc.indexOf("const removeServiceMutation"),
      modalSrc.indexOf("// ── Save ──"),
    );
    expect(removeSlice).not.toMatch(/estimatedDurationMinutes/);
    expect(removeSlice).not.toMatch(/setSchedule/);
  });

  it("manuallyEditedDuration resets on visit init AND on modal close", () => {
    // Both reset paths exist so the next open starts in auto-bump mode.
    const initSlice = modalSrc.slice(
      modalSrc.indexOf("// Init form state from visit data"),
      modalSrc.indexOf("// Reset follow-up state on close"),
    );
    expect(initSlice).toMatch(/setManuallyEditedDuration\(false\)/);
    const closeSlice = modalSrc.slice(
      modalSrc.indexOf("// Reset follow-up state on close"),
      modalSrc.indexOf("// ── Invalidation"),
    );
    expect(closeSlice).toMatch(/setManuallyEditedDuration\(false\)/);
  });
});

// ---------------------------------------------------------------------------
// Repo-wide guard: only one canonical Create New Job modal exists.
// ---------------------------------------------------------------------------

describe("Create New Job modal — single canonical source", () => {
  function listFilesRecursive(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) listFilesRecursive(full, out);
      else if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it("only QuickAddJobDialog.tsx contains the canonical create-job test IDs", () => {
    const componentsDir = path.resolve(__dirname, "..", "client", "src", "components");
    const pagesDir = path.resolve(__dirname, "..", "client", "src", "pages");
    const all = [...listFilesRecursive(componentsDir), ...listFilesRecursive(pagesDir)];
    const offenders = all.filter((f) => {
      const src = fs.readFileSync(f, "utf-8");
      return src.includes('data-testid="input-summary"') &&
             src.includes('data-testid="button-create-job"');
    });
    expect(offenders.map((f) => path.basename(f))).toEqual(["QuickAddJobDialog.tsx"]);
  });
});
