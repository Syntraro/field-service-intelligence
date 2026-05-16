/**
 * Tests for ReceivablesActionsRail activity rendering refinements.
 *
 * Covers:
 *  - groupNotes: communication + same-transaction promise_to_pay collapse into one card.
 *  - groupNotes: promise_to_pay created independently (>2 s gap) stays standalone.
 *  - groupNotes: communication without a promise renders as a group with empty promises[].
 *  - groupNotes: standalone promise_to_pay (no matching communication) renders separately.
 *  - groupNotes: a consumed promise is never double-rendered.
 *  - groupNotes: system-created communication notes are not used as group anchors.
 *  - Right-rail source pins: no open-invoice-detail link, single-line action labels.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { groupNotes } from "../client/src/pages/receivables/ReceivablesActionsRail";

// ── groupNotes logic ──────────────────────────────────────────────────────────

function makeNote(
  overrides: Partial<{
    id: string;
    noteType: string;
    noteText: string;
    promisedAt: string | null;
    createdAt: string;
    createdBySystem: boolean;
    outcome: string | null;
    contactMethod: string | null;
    communicatedAt: string | null;
    user: { id: string; fullName: string } | null;
  }>,
) {
  return {
    id: "note-1",
    noteType: "general",
    noteText: "A note",
    promisedAt: null,
    createdAt: "2026-05-14T12:00:00.000Z",
    createdBySystem: false,
    outcome: null,
    contactMethod: null,
    communicatedAt: null,
    user: { id: "user-1", fullName: "Test User", firstName: null, lastName: null },
    ...overrides,
  };
}

describe("groupNotes", () => {
  it("groups a communication + same-timestamp promise_to_pay into one card", () => {
    const ts = "2026-05-14T12:00:00.000Z";
    const comm = makeNote({ id: "c1", noteType: "communication", outcome: "spoke_with", createdAt: ts });
    const promise = makeNote({ id: "p1", noteType: "promise_to_pay", promisedAt: "2026-05-20T12:00:00.000Z", createdAt: ts });

    const result = groupNotes([promise, comm]); // DESC order: promise first
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("group");
    if (result[0].type === "group") {
      expect(result[0].group.communication.id).toBe("c1");
      expect(result[0].group.promises).toHaveLength(1);
      expect(result[0].group.promises[0].id).toBe("p1");
    }
  });

  it("groups communication + promise_to_pay within the 2 s window", () => {
    const comm = makeNote({ id: "c1", noteType: "communication", createdAt: "2026-05-14T12:00:00.000Z" });
    const promise = makeNote({ id: "p1", noteType: "promise_to_pay", createdAt: "2026-05-14T12:00:01.500Z" });

    const result = groupNotes([comm, promise]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("group");
  });

  it("does NOT group communication + promise_to_pay more than 2 s apart", () => {
    const comm = makeNote({ id: "c1", noteType: "communication", createdAt: "2026-05-14T12:00:00.000Z" });
    const promise = makeNote({ id: "p1", noteType: "promise_to_pay", createdAt: "2026-05-14T12:00:03.000Z" });

    const result = groupNotes([comm, promise]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("group");
    if (result[0].type === "group") {
      expect(result[0].group.promises).toHaveLength(0);
    }
    expect(result[1].type).toBe("standalone");
    if (result[1].type === "standalone") {
      expect(result[1].note.id).toBe("p1");
    }
  });

  it("communication without a promise renders as a group with empty promises[]", () => {
    const comm = makeNote({ id: "c1", noteType: "communication" });
    const result = groupNotes([comm]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("group");
    if (result[0].type === "group") {
      expect(result[0].group.promises).toHaveLength(0);
    }
  });

  it("standalone promise_to_pay (no matching communication) renders as standalone", () => {
    const promise = makeNote({ id: "p1", noteType: "promise_to_pay" });
    const result = groupNotes([promise]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("standalone");
  });

  it("consumed promise is not double-rendered", () => {
    const ts = "2026-05-14T12:00:00.000Z";
    const comm = makeNote({ id: "c1", noteType: "communication", createdAt: ts });
    const promise = makeNote({ id: "p1", noteType: "promise_to_pay", createdAt: ts });

    const result = groupNotes([comm, promise]);
    // promise should appear only inside the group, not as a second standalone item
    const standalones = result.filter((r) => r.type === "standalone");
    expect(standalones).toHaveLength(0);
    expect(result).toHaveLength(1);
  });

  it("system-created communication notes are NOT used as group anchors", () => {
    const ts = "2026-05-14T12:00:00.000Z";
    const sysComm = makeNote({ id: "c1", noteType: "communication", createdBySystem: true, createdAt: ts });
    const promise = makeNote({ id: "p1", noteType: "promise_to_pay", createdAt: ts });

    const result = groupNotes([sysComm, promise]);
    // system comm → standalone; promise → standalone (no group formed)
    expect(result).toHaveLength(2);
    result.forEach((r) => expect(r.type).toBe("standalone"));
  });

  it("general notes remain standalone regardless of timing", () => {
    const ts = "2026-05-14T12:00:00.000Z";
    const note1 = makeNote({ id: "n1", noteType: "general", createdAt: ts });
    const note2 = makeNote({ id: "n2", noteType: "dispute", createdAt: ts });

    const result = groupNotes([note1, note2]);
    expect(result).toHaveLength(2);
    result.forEach((r) => expect(r.type).toBe("standalone"));
  });

  it("preserves original note order for standalone items", () => {
    const n1 = makeNote({ id: "n1", noteType: "reminder", createdAt: "2026-05-14T13:00:00.000Z" });
    const n2 = makeNote({ id: "n2", noteType: "general",  createdAt: "2026-05-14T12:00:00.000Z" });

    const result = groupNotes([n1, n2]);
    expect(result[0].type).toBe("standalone");
    if (result[0].type === "standalone") expect(result[0].note.id).toBe("n1");
    expect(result[1].type).toBe("standalone");
    if (result[1].type === "standalone") expect(result[1].note.id).toBe("n2");
  });
});

// ── Source pins: ReceivablesActionsRail ───────────────────────────────────────

const RAIL_PATH = path.resolve(
  __dirname,
  "../client/src/pages/receivables/ReceivablesActionsRail.tsx",
);

describe("ReceivablesActionsRail activity/rail source pins", () => {
  let src: string;
  beforeAll(() => {
    src = fs.readFileSync(RAIL_PATH, "utf-8");
  });

  it("activity section has overflow-y-auto for independent scrolling", () => {
    expect(src).toContain("overflow-y-auto");
    // Specifically on the notes section div (flex-1 min-h-0 overflow-y-auto)
    expect(src).toMatch(/flex-1 min-h-0 overflow-y-auto/);
  });

  it("does not contain the open-invoice-detail link", () => {
    expect(src).not.toContain("receivables-action-open-detail");
    expect(src).not.toContain("Open invoice detail");
  });

  it("primary action button is labeled 'Client Communication'", () => {
    expect(src).toContain("Client Communication");
  });

  it("does not contain old multi-line action descriptions", () => {
    expect(src).not.toContain("Log communication");
    expect(src).not.toContain("Send invoice reminder");
    expect(src).not.toContain("Send account statement");
    expect(src).not.toContain("Collect payment");
  });

  it("action buttons use single-line items-center layout (not items-start)", () => {
    // The single-invoice action buttons must use items-center (compact, single-line)
    // items-start was used for the two-line layout
    const actionSection = src.slice(
      src.indexOf("receivables-action-contact-client"),
      src.indexOf("receivables-notes-section"),
    );
    expect(actionSection).not.toContain("items-start");
  });

  it("still has data-testid receivables-action-contact-client (existing pin)", () => {
    expect(src).toContain("receivables-action-contact-client");
  });

  it("still imports ContactClientModal (existing pin)", () => {
    expect(src).toContain("ContactClientModal");
  });

  it("does not import useLocation (removed with nav button)", () => {
    expect(src).not.toContain("useLocation");
  });

  it("does not import formatDistanceToNow (relative timestamps removed)", () => {
    expect(src).not.toContain("formatDistanceToNow");
  });

  it("activity cards show absolute date before headline (meta-first layout)", () => {
    // format() is used for the absolute date display
    expect(src).toContain("format(new Date(");
    // no relative timestamp wrapper remains
    expect(src).not.toContain("addSuffix: true");
  });

  it("exports groupNotes for testability", () => {
    expect(src).toMatch(/export function groupNotes/);
  });
});
