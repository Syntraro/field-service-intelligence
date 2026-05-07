/**
 * Activity Feed drawer — 2026-05-07 source-level pins + registry guards.
 *
 *   • Universal header surfaces the Activity trigger near Tasks / + New.
 *   • Drawer mount lives at the App shell layer.
 *   • Canonical event-type registry pins:
 *       – includes the operational set spec'd for the global feed
 *       – does NOT include excluded low-signal lifecycle event_types
 *       – default-enabled set excludes `note.created` (notes opt-in)
 *   • Customize view exposes ONE toggle per CATEGORY (not per event):
 *       – Visit Updates, Technician Updates, Quote Updates,
 *         Invoice Updates, Payment Updates, Notes
 *       – No individual sub-event toggles surface in the UI.
 *   • Drawer header has exactly ONE close affordance (the built-in
 *     `SheetPrimitive.Close` is suppressed via [&>button]:hidden).
 *   • Server preferences route validates against the canonical set.
 *
 * Display formatter pins (the bug we are fixing):
 *   • formatActivityEvent never uses the raw `events.summary` text.
 *   • Title for visit.completed is "Visit completed" or
 *     "<Tech> completed a visit" — never the legacy
 *     "Visit completed with outcome=completed (job <uuid>)" string.
 *   • Title never contains raw enum patterns like `outcome=`,
 *     `status=`, JSON characters, or the raw event_type key.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  ACTIVITY_FEED_EVENT_TYPES,
  ACTIVITY_FEED_EVENT_DEFINITIONS,
  ACTIVITY_FEED_CATEGORIES,
  DEFAULT_ENABLED_EVENT_TYPES,
  isCanonicalActivityEventType,
  categoriesFromEventTypes,
  eventTypesFromCategories,
  type ActivityFeedCategory,
} from "../shared/activityFeedRegistry";
import { formatActivityEvent } from "../client/src/components/activity-feed/formatActivityEvent";
import type { ActivityFeedItem } from "../client/src/components/activity-feed/useActivityFeed";

const ROOT = join(__dirname, "..");
const APP_PATH = join(ROOT, "client/src/App.tsx");
const DRAWER_PATH = join(ROOT, "client/src/components/activity-feed/ActivityFeedDrawer.tsx");
const BUTTON_PATH = join(ROOT, "client/src/components/activity-feed/ActivityFeedButton.tsx");
const ITEM_PATH = join(ROOT, "client/src/components/activity-feed/ActivityFeedItem.tsx");
const CUSTOMIZE_PATH = join(ROOT, "client/src/components/activity-feed/CustomizeActivityFeedView.tsx");
const ROUTE_PATH = join(ROOT, "server/routes/activityFeed.ts");
const ROUTE_INDEX_PATH = join(ROOT, "server/routes/index.ts");

const appSrc = readFileSync(APP_PATH, "utf-8");
const drawerSrc = readFileSync(DRAWER_PATH, "utf-8");
const buttonSrc = readFileSync(BUTTON_PATH, "utf-8");
const itemSrc = readFileSync(ITEM_PATH, "utf-8");
const customizeSrc = readFileSync(CUSTOMIZE_PATH, "utf-8");
const routeSrc = readFileSync(ROUTE_PATH, "utf-8");
const routeIndexSrc = readFileSync(ROUTE_INDEX_PATH, "utf-8");

// ────────────────────────────────────────────────────────────────────
// Header / drawer integration
// ────────────────────────────────────────────────────────────────────

describe("Activity Feed — universal header integration", () => {
  it("mounts the ActivityFeedButton in the global header", () => {
    expect(appSrc).toMatch(/import\s*\{\s*ActivityFeedButton\s*\}\s*from\s+"@\/components\/activity-feed\/ActivityFeedButton"/);
    expect(appSrc).toMatch(/<ActivityFeedButton[\s\S]*?open=\{activityFeedOpen\}[\s\S]*?onClick=/);
  });

  it("mounts the ActivityFeedDrawer at the app-shell layer", () => {
    expect(appSrc).toMatch(/import\s*\{\s*ActivityFeedDrawer\s*\}\s*from\s+"@\/components\/activity-feed\/ActivityFeedDrawer"/);
    expect(appSrc).toMatch(/<ActivityFeedDrawer\s+open=\{activityFeedOpen\}\s+onOpenChange=\{setActivityFeedOpen\}/);
  });

  it("applies a green active-state to the trigger when the drawer is open", () => {
    expect(buttonSrc).toMatch(/bg-brand/);
    expect(buttonSrc).toMatch(/aria-expanded=\{open\}/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Drawer header — exactly ONE close button
// ────────────────────────────────────────────────────────────────────

describe("Activity Feed — drawer chrome (narrow, single close, no extras)", () => {
  it("suppresses the built-in SheetContent close via [&>button]:hidden", () => {
    // The shadcn Sheet primitive renders SheetPrimitive.Close as a direct
    // child <button> of SheetContent. Our drawer overrides that with a
    // header-aligned X, so we hide the default to avoid duplicates.
    expect(drawerSrc).toMatch(/\[&>button\]:hidden/);
  });

  it("renders one and only one close affordance per view (feed + customize)", () => {
    const closeIcons = drawerSrc.match(/<X\b/g) ?? [];
    // 2 occurrences = one X in the feed-view header, one in the customize-view header.
    expect(closeIcons.length).toBe(2);
    expect(drawerSrc.match(/aria-label="Close activity feed"/g)?.length).toBe(2);
  });

  it("uses the spec'd narrow width (~340px) instead of the wider 440 default", () => {
    expect(drawerSrc).toMatch(/sm:max-w-\[340px\]/);
    expect(drawerSrc).not.toMatch(/sm:max-w-\[440px\]/);
  });

  it("does NOT render a standalone Customize Feed body button", () => {
    // The gear icon in the header is the ONLY way to enter the customize
    // view. The previous standalone "Customize Feed" button + Sliders
    // import were removed.
    expect(drawerSrc).not.toMatch(/Customize Feed</);
    expect(drawerSrc).not.toMatch(/data-testid="activity-feed-customize-button"/);
    expect(drawerSrc).not.toMatch(/\bSliders\b/);
  });

  it("still mounts the gear/settings icon that opens the customize view", () => {
    expect(drawerSrc).toMatch(/import\s*\{[^}]*\bSettings\b/);
    expect(drawerSrc).toMatch(/data-testid="activity-feed-open-customize"/);
    expect(drawerSrc).toMatch(/setView\("customize"\)/);
  });

  it("does NOT render a 'New since' separator anywhere", () => {
    expect(drawerSrc).not.toMatch(/New since/i);
    expect(drawerSrc).not.toMatch(/newSinceLabel/);
  });

  it("does NOT render a refresh button (chrome reduced to gear + close only)", () => {
    expect(drawerSrc).not.toMatch(/data-testid="activity-feed-refresh"/);
    expect(drawerSrc).not.toMatch(/aria-label="Refresh"/);
    expect(drawerSrc).not.toMatch(/\bRefreshCw\b/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Canonical event-type registry — inclusions + exclusions
// ────────────────────────────────────────────────────────────────────

describe("Activity Feed — canonical event-type registry", () => {
  const REQUIRED_EVENT_TYPES = [
    "visit.started", "visit.completed", "visit.on_route", "tech.arrived",
    "quote.approved", "quote.declined",
    "invoice.viewed", "invoice.paid", "invoice.partial_paid", "payment.failed",
    "timesheet.clocked_in", "timesheet.clocked_out",
    "note.created",
  ];

  const EXCLUDED_EVENT_TYPES = [
    "job.created", "job.scheduled", "job.unscheduled", "job.reassigned",
    "quote.created", "quote.sent",
    "invoice.sent", "invoice.created",
    "client.created", "client.updated",
    "review.submitted", "marketing.campaign",
  ];

  it("includes every canonical operational event_type", () => {
    for (const t of REQUIRED_EVENT_TYPES) {
      expect(ACTIVITY_FEED_EVENT_TYPES).toContain(t);
      expect(isCanonicalActivityEventType(t)).toBe(true);
    }
  });

  it("excludes low-signal lifecycle event_types from the registry", () => {
    for (const t of EXCLUDED_EVENT_TYPES) {
      expect(ACTIVITY_FEED_EVENT_TYPES).not.toContain(t);
      expect(isCanonicalActivityEventType(t)).toBe(false);
    }
  });

  it("has one definition per event_type with a known category", () => {
    const categoryKeys = new Set(ACTIVITY_FEED_CATEGORIES.map((c) => c.key));
    for (const def of ACTIVITY_FEED_EVENT_DEFINITIONS) {
      expect(ACTIVITY_FEED_EVENT_TYPES).toContain(def.eventType);
      expect(categoryKeys.has(def.category)).toBe(true);
    }
    expect(ACTIVITY_FEED_EVENT_DEFINITIONS.length).toBe(ACTIVITY_FEED_EVENT_TYPES.length);
  });

  it("defaults `note.created` to OFF (notes opt-in)", () => {
    expect(ACTIVITY_FEED_EVENT_TYPES).toContain("note.created");
    expect(DEFAULT_ENABLED_EVENT_TYPES).not.toContain("note.created");
  });

  it("defaults all non-note canonical event_types to ON", () => {
    for (const t of ACTIVITY_FEED_EVENT_TYPES) {
      if (t === "note.created") continue;
      expect(DEFAULT_ENABLED_EVENT_TYPES).toContain(t);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Customize Feed — category toggles ONLY (no per-event toggles)
// ────────────────────────────────────────────────────────────────────

describe("Activity Feed — Customize view shows category toggles only", () => {
  it("registry exposes exactly the six required categories", () => {
    const keys = ACTIVITY_FEED_CATEGORIES.map((c) => c.key).sort();
    expect(keys).toEqual([
      "invoice_updates",
      "notes",
      "payment_updates",
      "quote_updates",
      "technician_updates",
      "visit_updates",
    ]);
  });

  it("category labels match the user-facing strings", () => {
    const labels = Object.fromEntries(
      ACTIVITY_FEED_CATEGORIES.map((c) => [c.key, c.label]),
    );
    expect(labels.visit_updates).toBe("Visit Updates");
    expect(labels.technician_updates).toBe("Technician Updates");
    expect(labels.quote_updates).toBe("Quote Updates");
    expect(labels.invoice_updates).toBe("Invoice Updates");
    expect(labels.payment_updates).toBe("Payment Updates");
    expect(labels.notes).toBe("Notes");
  });

  it("category bundles match the spec exactly", () => {
    const bundle = (k: ActivityFeedCategory) =>
      ACTIVITY_FEED_CATEGORIES.find((c) => c.key === k)!.eventTypes.slice().sort();
    expect(bundle("visit_updates")).toEqual(["visit.completed", "visit.started"]);
    expect(bundle("technician_updates")).toEqual([
      "tech.arrived",
      "timesheet.clocked_in",
      "timesheet.clocked_out",
      "visit.on_route",
    ]);
    expect(bundle("quote_updates")).toEqual(["quote.approved", "quote.declined"]);
    expect(bundle("invoice_updates")).toEqual(["invoice.paid", "invoice.viewed"]);
    expect(bundle("payment_updates")).toEqual(["invoice.partial_paid", "payment.failed"]);
    expect(bundle("notes")).toEqual(["note.created"]);
  });

  it("Notes category is the only one disabled by default", () => {
    for (const cat of ACTIVITY_FEED_CATEGORIES) {
      if (cat.key === "notes") expect(cat.defaultEnabled).toBe(false);
      else expect(cat.defaultEnabled).toBe(true);
    }
  });

  it("source renders one toggle per category and references no per-event toggles", () => {
    expect(customizeSrc).toMatch(/ACTIVITY_FEED_CATEGORIES/);
    expect(customizeSrc).toMatch(/eventTypesFromCategories/);
    expect(customizeSrc).toMatch(/categoriesFromEventTypes/);
    // The old per-event Switch loop and per-event group iteration must
    // not survive in the source.
    expect(customizeSrc).not.toMatch(/ACTIVITY_FEED_EVENT_DEFINITIONS/);
    expect(customizeSrc).not.toMatch(/ACTIVITY_FEED_GROUPS/);
    // Per-event labels from the spec must NOT be hard-coded here. They
    // can only appear in user-facing copy if someone re-introduced the
    // per-event toggle list.
    for (const banned of [
      "Visit started", "Visit completed",
      "Technician arrived",
      "Quote approved", "Quote declined",
      "Invoice paid",
      "Technician clocked in", "Technician clocked out",
    ]) {
      expect(customizeSrc).not.toContain(banned);
    }
  });

  it("category projection round-trips: enable Visit Updates → both visit.* event_types saved", () => {
    const saved = eventTypesFromCategories({
      visit_updates: true,
      technician_updates: false,
      quote_updates: false,
      invoice_updates: false,
      payment_updates: false,
      notes: false,
    });
    expect(saved).toEqual(["visit.started", "visit.completed"]);

    const projected = categoriesFromEventTypes(saved);
    expect(projected.visit_updates).toBe(true);
    expect(projected.technician_updates).toBe(false);
  });

  it("category read normalizes partial enables to category-on", () => {
    // Older saved data — only ONE event_type from a category is enabled.
    const projected = categoriesFromEventTypes(["visit.started"]);
    // Spec D: "treat the category toggle as enabled if any are enabled"
    expect(projected.visit_updates).toBe(true);
    // Save round-trip normalizes back to the full set.
    const renormalized = eventTypesFromCategories(projected);
    expect(renormalized).toContain("visit.started");
    expect(renormalized).toContain("visit.completed");
  });

  it("the canonical defaults projection turns notes off by default", () => {
    const projected = categoriesFromEventTypes(DEFAULT_ENABLED_EVENT_TYPES);
    expect(projected.visit_updates).toBe(true);
    expect(projected.technician_updates).toBe(true);
    expect(projected.quote_updates).toBe(true);
    expect(projected.invoice_updates).toBe(true);
    expect(projected.payment_updates).toBe(true);
    expect(projected.notes).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Display formatter — clean copy, never raw enum/JSON/event_type
// ────────────────────────────────────────────────────────────────────

function makeItem(eventType: string, overrides: Partial<ActivityFeedItem> = {}): ActivityFeedItem {
  return {
    id: "id",
    tenantId: "t",
    actorUserId: null,
    actorType: "user",
    entityType: "visit",
    entityId: "e",
    eventType,
    severity: "info",
    summary: "RAW SUMMARY THAT MUST NOT LEAK",
    meta: {},
    createdAt: new Date().toISOString(),
    actor: null,
    ...overrides,
  };
}

describe("Activity Feed — display formatter copy", () => {
  it("ignores the raw events.summary and rebuilds the title", () => {
    const item = makeItem("visit.completed", {
      summary: "Visit completed with outcome=completed (job 123)",
      meta: { jobId: "j", outcome: "completed", holdReason: null },
    });
    const out = formatActivityEvent(item);
    expect(out.title).toBe("Visit completed");
    // The raw summary text and its key=value fragments must NOT appear.
    expect(out.title).not.toContain("outcome=");
    expect(out.subtitle ?? "").not.toContain("outcome=");
    expect(out.detail ?? "").not.toContain("outcome=");
  });

  it("never renders the raw event_type as the title", () => {
    for (const t of ACTIVITY_FEED_EVENT_TYPES) {
      const out = formatActivityEvent(makeItem(t, { meta: {} }));
      expect(out.title).not.toBe(t);
      expect(out.title).not.toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(out.title.length).toBeGreaterThan(0);
    }
  });

  it("visit.completed renders user-facing copy with technician + job number", () => {
    const item = makeItem("visit.completed", {
      entityType: "visit",
      meta: {
        jobId: "j-1",
        jobNumber: "108120",
        jobSummary: "Glass freezer",
        customerName: "King Edward's Arms",
      },
      actor: { id: "u", name: "Nadeem Samaha" },
    });
    const out = formatActivityEvent(item);
    expect(out.title).toBe("Nadeem Samaha completed a visit");
    expect(out.subtitle).toBe("Job #108120 · Glass freezer");
    expect(out.detail).toBe("King Edward's Arms");
  });

  it("visit.started, tech.arrived, visit.on_route follow the same shape", () => {
    const meta = { jobId: "j", jobNumber: "5", jobSummary: "Walkin", customerName: "Acme" };
    const actor = { id: "u", name: "Mikel Elias" };
    expect(formatActivityEvent(makeItem("visit.started",  { meta, actor })).title)
      .toBe("Mikel Elias started a visit");
    expect(formatActivityEvent(makeItem("tech.arrived",   { meta, actor })).title)
      .toBe("Mikel Elias arrived on site");
    expect(formatActivityEvent(makeItem("visit.on_route", { meta, actor })).title)
      .toBe("Mikel Elias marked on route");
  });

  it("invoice.partial_paid renders title + invoice/client subtitle, NO money", () => {
    const item = makeItem("invoice.partial_paid", {
      entityType: "invoice",
      meta: { invoiceNumber: "INV-10013", customerName: "Fady's Hockey", balance: 255, total: 455 },
    });
    const out = formatActivityEvent(item);
    expect(out.title).toBe("Partial payment received");
    expect(out.subtitle).toBe("Invoice #INV-10013 · Fady's Hockey");
    // Permission-gated content: financial values must NEVER appear in
    // the formatter output. The display object has no `amount` field.
    expect((out as Record<string, unknown>).amount).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/\$/);
  });

  it("payment.failed and invoice.paid carry NO dollar amounts", () => {
    const failed = formatActivityEvent(
      makeItem("payment.failed", {
        entityType: "invoice",
        meta: { invoiceNumber: "INV-10014", customerName: "The Manor", amount: 890 },
      }),
    );
    expect(failed.title).toBe("Payment failed");
    expect(JSON.stringify(failed)).not.toMatch(/\$/);

    const paid = formatActivityEvent(
      makeItem("invoice.paid", {
        entityType: "invoice",
        meta: { invoiceNumber: "INV-10012", customerName: "Cards are us", total: 567.5 },
      }),
    );
    expect(paid.title).toBe("Invoice #INV-10012 paid");
    expect(JSON.stringify(paid)).not.toMatch(/\$/);
  });

  it("falls back gracefully when meta has no jobNumber/jobSummary/clientName", () => {
    const out = formatActivityEvent(makeItem("visit.started", { meta: {} }));
    expect(out.title).toBe("Visit started");
    expect(out.subtitle).toBeUndefined();
    expect(out.detail).toBeUndefined();
  });

  it("never produces a title containing JSON or key=value patterns", () => {
    for (const t of ACTIVITY_FEED_EVENT_TYPES) {
      const out = formatActivityEvent(
        makeItem(t, {
          meta: { outcome: "completed", status: "x", holdReason: null, jobId: "uuid" },
          summary: 'JSON-ish: {"foo":"bar"} key=value',
        }),
      );
      expect(out.title).not.toMatch(/[{}=]/);
      // Title must not contain raw uuid-like strings for jobId fallback either.
      expect(out.title).not.toMatch(/uuid/i);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Server route surface (source pins)
// ────────────────────────────────────────────────────────────────────

describe("Activity Feed — server route surface", () => {
  it("mounts /api/activity-feed in routes/index.ts", () => {
    expect(routeIndexSrc).toMatch(/import\s+activityFeedRouter\s+from\s+"\.\/activityFeed"/);
    expect(routeIndexSrc).toMatch(/app\.use\("\/api\/activity-feed",\s*activityFeedRouter\)/);
  });

  it("filters the feed by canonical event_types via inArray on the events table", () => {
    expect(routeSrc).toMatch(/inArray\(events\.eventType,\s*enabled\)/);
    expect(routeSrc).toMatch(/eq\(events\.tenantId,\s*tenantId\)/);
  });

  it("rejects unknown event_type keys on PUT /preferences", () => {
    expect(routeSrc).toMatch(/Unknown activity event type/);
    expect(routeSrc).toMatch(/isCanonicalActivityEventType/);
  });

  it("falls back to canonical defaults when no preference row exists", () => {
    expect(routeSrc).toMatch(/DEFAULT_ENABLED_EVENT_TYPES/);
  });

  it("enriches feed rows with actor name via leftJoin on users", () => {
    expect(routeSrc).toMatch(/leftJoin\(users,/);
    expect(routeSrc).toMatch(/resolveTechnicianName/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Item layout — uses the formatter, not the raw summary
// ────────────────────────────────────────────────────────────────────

describe("Activity Feed — item renderer uses the formatter", () => {
  it("imports formatActivityEvent and renders display.title", () => {
    expect(itemSrc).toMatch(/import\s*\{\s*formatActivityEvent\s*\}/);
    expect(itemSrc).toMatch(/formatActivityEvent\(item\)/);
    expect(itemSrc).toMatch(/display\.title/);
    expect(itemSrc).toMatch(/display\.subtitle/);
    expect(itemSrc).toMatch(/display\.detail/);
  });

  it("does NOT render item.summary (the raw events table column)", () => {
    expect(itemSrc).not.toMatch(/\bitem\.summary\b/);
  });

  it("renders timestamp INSIDE the content column as the final line, not right-aligned", () => {
    // The timestamp testid + classes pin the new layout: it sits inside
    // the content column (preceded by the title/subtitle/detail block)
    // with the same muted typography, NOT in a separate right-side column.
    expect(itemSrc).toMatch(/data-testid="activity-feed-item-timestamp"/);
    // Layout pin: the timestamp <div> is the last element in the
    // content column, after the optional detail block.
    const timestampIdx = itemSrc.indexOf('data-testid="activity-feed-item-timestamp"');
    const detailIdx = itemSrc.indexOf('data-testid="activity-feed-item-detail"');
    const titleIdx = itemSrc.indexOf('data-testid="activity-feed-item-title"');
    expect(timestampIdx).toBeGreaterThan(titleIdx);
    expect(timestampIdx).toBeGreaterThan(detailIdx);
    // The timestamp is NOT wrapped in a `whitespace-nowrap` shrink-0
    // right-column container anymore — that was the old top-right slot.
    expect(itemSrc).not.toMatch(/shrink-0\s+text-xs[^"]*whitespace-nowrap/);
  });

  it("uses canonical compact typography tokens for the row hierarchy", () => {
    // Title: medium-weight via the baked-in `text-row-emphasis` token
    // (15px / fw 500). This is intentionally LIGHTER and smaller than
    // the prior `text-sm font-semibold` so the rail reads like a
    // compact operational log, not a notification card.
    expect(itemSrc).toMatch(/text-row-emphasis/);
    // Detail/timestamp lines: `text-helper` (13px) — smallest token in
    // the canonical Phase E ramp, paired with `text-muted-foreground`.
    expect(itemSrc).toMatch(/text-helper/);

    // Forbid heavier weights and the legacy raw classes for the row.
    expect(itemSrc).not.toMatch(/font-bold/);
    expect(itemSrc).not.toMatch(/font-semibold/);
    // Old prefix/size pairings — explicit exclusions so a future revert
    // gets caught at test time.
    expect(itemSrc).not.toMatch(/text-sm\s+font-semibold/);
    expect(itemSrc).not.toMatch(/\btext-xs\b/);
    expect(itemSrc).not.toMatch(/\btext-sm\b/);
  });

  it("does NOT render an amount badge or any dollar amount", () => {
    // Permission-gated content — financial values must never appear here.
    expect(itemSrc).not.toMatch(/data-testid="activity-feed-amount-badge"/);
    expect(itemSrc).not.toMatch(/display\.amount/);
    // No literal currency template (e.g. "$" followed by a number). Bare
    // `$` is allowed because TS template-literal syntax `${...}` is
    // pervasive in JSX class strings — the real risk is a hardcoded
    // money string sneaking in.
    expect(itemSrc).not.toMatch(/"\$\d/);
    expect(itemSrc).not.toMatch(/\\\$\d/);
  });
});
