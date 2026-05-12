/**
 * Rail meta typography canonicalization guard (2026-05-12).
 *
 * Pins that migrated files use `<RailContentCardMeta>` for empty-state
 * helper text, loading states, and secondary metadata rows — and no
 * longer emit raw `text-xs text-muted-foreground` in those positions.
 *
 * Intentional exceptions (not covered):
 *   - Count badges inline in collapsible headings (e.g. "Status Timeline (3)")
 *     — these are inline within a heading span, not standalone meta text.
 *   - WeekTimeline / TimelineRail / DispatchTimeline — compact scheduling
 *     grid/dispatch surfaces with intentional density constraints.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const jobStatusTimelineSrc = readFileSync(
  resolve(ROOT, "client/src/components/job/JobStatusTimeline.tsx"),
  "utf-8",
);
const invoiceTimelineCardSrc = readFileSync(
  resolve(ROOT, "client/src/components/invoice/InvoiceTimelineCard.tsx"),
  "utf-8",
);
const schedulingHistorySrc = readFileSync(
  resolve(ROOT, "client/src/components/job/SchedulingHistory.tsx"),
  "utf-8",
);
const activityCardSrc = readFileSync(
  resolve(ROOT, "client/src/components/activity/ActivityCard.tsx"),
  "utf-8",
);
const conversationDetailsPanelSrc = readFileSync(
  resolve(ROOT, "client/src/components/communications/ConversationDetailsPanel.tsx"),
  "utf-8",
);
const equipmentCatalogItemsSrc = readFileSync(
  resolve(ROOT, "client/src/components/EquipmentCatalogItemsSection.tsx"),
  "utf-8",
);
const clientDetailPageSrc = readFileSync(
  resolve(ROOT, "client/src/pages/ClientDetailPage.tsx"),
  "utf-8",
);

// ── JobStatusTimeline ─────────────────────────────────────────────────

describe("JobStatusTimeline — meta canonicalization", () => {
  it("imports RailContentCardMeta", () => {
    expect(jobStatusTimelineSrc).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCardMeta\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("uses RailContentCardMeta for the empty-state message", () => {
    expect(jobStatusTimelineSrc).toMatch(
      /<RailContentCardMeta[^>]*>No status changes recorded yet\.<\/RailContentCardMeta>/,
    );
  });

  it("does NOT use raw text-xs text-muted-foreground for the empty-state paragraph", () => {
    // The count badge `<span className="text-xs text-muted-foreground font-normal">` is
    // an intentional exception (inline in heading). The empty-state `<p>` must be gone.
    expect(jobStatusTimelineSrc).not.toMatch(
      /<p\s[^>]*text-xs[^>]*text-muted-foreground[^>]*>No status changes/,
    );
  });
});

// ── InvoiceTimelineCard ───────────────────────────────────────────────

describe("InvoiceTimelineCard — meta canonicalization", () => {
  it("imports RailContentCardMeta", () => {
    expect(invoiceTimelineCardSrc).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCardMeta\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("uses RailContentCardMeta for the loading state", () => {
    expect(invoiceTimelineCardSrc).toMatch(
      /<RailContentCardMeta[^>]*>[\s\S]*?Loading/,
    );
  });

  it("uses RailContentCardMeta for the empty-state message", () => {
    expect(invoiceTimelineCardSrc).toMatch(
      /<RailContentCardMeta[^>]*>[\s\S]*?No activity yet\./,
    );
  });

  it("does NOT use raw text-xs text-muted-foreground for loading or empty states", () => {
    expect(invoiceTimelineCardSrc).not.toMatch(
      /<p\s[^>]*text-xs[^>]*text-muted-foreground[^>]*>[\s\S]{0,80}?Loading/,
    );
    expect(invoiceTimelineCardSrc).not.toMatch(
      /<p\s[^>]*text-xs[^>]*text-muted-foreground[^>]*>[\s\S]{0,80}?No activity/,
    );
  });
});

// ── SchedulingHistory ─────────────────────────────────────────────────

describe("SchedulingHistory — meta canonicalization", () => {
  it("imports RailContentCardMeta", () => {
    expect(schedulingHistorySrc).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCardMeta\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("uses RailContentCardMeta for the error state", () => {
    expect(schedulingHistorySrc).toMatch(
      /<RailContentCardMeta[^>]*>Failed to load history<\/RailContentCardMeta>/,
    );
  });

  it("uses RailContentCardMeta for the empty-state message", () => {
    expect(schedulingHistorySrc).toMatch(
      /<RailContentCardMeta[^>]*>No scheduling changes recorded<\/RailContentCardMeta>/,
    );
  });

  it("uses RailContentCardMeta for the per-entry secondary metadata row", () => {
    expect(schedulingHistorySrc).toMatch(
      /<RailContentCardMeta[^>]*className="flex items-center gap-2 flex-wrap[^"]*"/,
    );
  });

  it("does NOT use raw text-xs text-muted-foreground for error/empty/meta rows", () => {
    expect(schedulingHistorySrc).not.toMatch(
      /<p\s[^>]*text-xs[^>]*text-muted-foreground[^>]*>Failed to load/,
    );
    expect(schedulingHistorySrc).not.toMatch(
      /<p\s[^>]*text-xs[^>]*text-muted-foreground[^>]*>No scheduling/,
    );
    expect(schedulingHistorySrc).not.toMatch(
      /<div\s[^>]*text-xs[^>]*text-muted-foreground[^>]*flex-wrap/,
    );
  });
});

// ── ActivityCard ──────────────────────────────────────────────────────

describe("ActivityCard — meta canonicalization", () => {
  it("imports RailContentCardMeta", () => {
    expect(activityCardSrc).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCardMeta\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("uses RailContentCardMeta for the loading state", () => {
    expect(activityCardSrc).toMatch(
      /<RailContentCardMeta[^>]*>[\s\S]*?Loading/,
    );
  });

  it("uses RailContentCardMeta for the empty-state message", () => {
    expect(activityCardSrc).toMatch(
      /<RailContentCardMeta[^>]*>[\s\S]*?No activity yet\./,
    );
  });

  it("does NOT use raw text-xs text-muted-foreground for loading or empty states", () => {
    expect(activityCardSrc).not.toMatch(
      /<div\s[^>]*text-xs[^>]*text-muted-foreground[^>]*>[\s\S]{0,80}?Loading/,
    );
    expect(activityCardSrc).not.toMatch(
      /<div\s[^>]*text-xs[^>]*text-muted-foreground[^>]*>[\s\S]{0,80}?No activity yet/,
    );
  });

  it("uses RailContentCardMeta for the error state", () => {
    expect(activityCardSrc).toMatch(
      /<RailContentCardMeta[^>]*>[\s\S]*?Could not load activity\./,
    );
  });

  it("does NOT use a raw div with text-xs text-destructive for the error state", () => {
    expect(activityCardSrc).not.toMatch(
      /<div\s[^>]*text-xs[^>]*text-destructive[^>]*>[\s\S]{0,80}?Could not load/,
    );
  });
});

// ── ConversationDetailsPanel ──────────────────────────────────────────

describe("ConversationDetailsPanel — meta canonicalization", () => {
  it("imports RailContentCardMeta", () => {
    expect(conversationDetailsPanelSrc).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCardMeta\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("uses RailContentCardMeta for the communication history empty state", () => {
    expect(conversationDetailsPanelSrc).toMatch(
      /<RailContentCardMeta[^>]*>[\s\S]*?No history yet\./,
    );
  });

  it("does NOT use a raw div with text-helper text-muted-foreground for the history empty state", () => {
    expect(conversationDetailsPanelSrc).not.toMatch(
      /<div\s[^>]*text-helper[^>]*text-muted-foreground[^>]*>[\s\S]{0,40}?No history yet/,
    );
  });
});

// ── EquipmentCatalogItemsSection ──────────────────────────────────────

describe("EquipmentCatalogItemsSection — meta canonicalization", () => {
  it("imports RailContentCardMeta", () => {
    expect(equipmentCatalogItemsSrc).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCardMeta\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("uses RailContentCardMeta for the empty-state message", () => {
    expect(equipmentCatalogItemsSrc).toMatch(
      /<RailContentCardMeta[^>]*>[\s\S]*?No catalog items associated yet\./,
    );
  });

  it("does NOT use a raw p with text-xs text-muted-foreground for the empty state", () => {
    expect(equipmentCatalogItemsSrc).not.toMatch(
      /<p\s[^>]*text-xs[^>]*text-muted-foreground[^>]*>[\s\S]{0,50}?No catalog items/,
    );
  });
});

// ── ClientDetailPage contacts panel ──────────────────────────────────

describe("ClientDetailPage contacts panel — meta canonicalization", () => {
  it("imports RailContentCardMeta", () => {
    expect(clientDetailPageSrc).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCardMeta\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("uses RailContentCardMeta for the contacts empty state", () => {
    expect(clientDetailPageSrc).toMatch(
      /<RailContentCardMeta[^>]*>[\s\S]*?No contacts yet\./,
    );
  });

  it("does NOT use a raw p with text-xs text-muted-foreground for the contacts empty state", () => {
    expect(clientDetailPageSrc).not.toMatch(
      /<p\s[^>]*text-xs[^>]*text-muted-foreground[^>]*>[\s\S]{0,30}?No contacts yet/,
    );
  });
});
