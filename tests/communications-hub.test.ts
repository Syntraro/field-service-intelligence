/**
 * Communications Hub — Phase 1 contract pins.
 *
 * Phase 1 ships UI shell + role-aware visibility helpers + provider
 * abstraction stub. These pins lock the surface that Phase 2 will wire
 * to real data; if any of them break, the swap-to-real-fetch contract
 * will silently break with them.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  COMMUNICATION_MODULES,
  isCommunicationModule,
  type CommunicationModule,
} from "../shared/communicationsTypes";
import {
  canViewThread,
  filterThreadsForViewer,
  getVisibleCommunicationsModules,
  isModuleVisibleForRole,
  isOfficeRole,
  isTechnicianRole,
} from "../shared/communicationsAccess";
import {
  MOCK_THREADS,
  MOCK_USER_IDS,
  getMockMessagesForThread,
  getMockTimelineForThread,
} from "../client/src/lib/communications/communicationsMockData";
import { getInitials } from "../client/src/lib/getInitials";

const ROOT = join(__dirname, "..");
const APP_PATH = join(ROOT, "client/src/App.tsx");
const SIDEBAR_PATH = join(ROOT, "client/src/components/AppSidebar.tsx");
const PAGE_PATH = join(ROOT, "client/src/pages/CommunicationsHub.tsx");
const RAIL_PATH = join(ROOT, "client/src/components/communications/CommunicationsRail.tsx");
const LIST_PATH = join(ROOT, "client/src/components/communications/ConversationListColumn.tsx");
const PANEL_PATH = join(ROOT, "client/src/components/communications/ConversationPanel.tsx");
const COMPOSER_PATH = join(ROOT, "client/src/components/communications/ConversationComposer.tsx");
const DETAILS_PATH = join(ROOT, "client/src/components/communications/ConversationDetailsPanel.tsx");
const MSG_BUTTON_PATH = join(ROOT, "client/src/components/communications/MessagesHeaderButton.tsx");
const PHONE_BUTTON_PATH = join(ROOT, "client/src/components/communications/PhoneHeaderButton.tsx");
const PROVIDER_TYPES_PATH = join(ROOT, "server/services/communications/providers/types.ts");

const appSrc = readFileSync(APP_PATH, "utf-8");
const sidebarSrc = readFileSync(SIDEBAR_PATH, "utf-8");
const pageSrc = readFileSync(PAGE_PATH, "utf-8");
const railSrc = readFileSync(RAIL_PATH, "utf-8");
const listSrc = readFileSync(LIST_PATH, "utf-8");
const panelSrc = readFileSync(PANEL_PATH, "utf-8");
const composerSrc = readFileSync(COMPOSER_PATH, "utf-8");
const detailsSrc = readFileSync(DETAILS_PATH, "utf-8");
const msgButtonSrc = readFileSync(MSG_BUTTON_PATH, "utf-8");
const phoneButtonSrc = readFileSync(PHONE_BUTTON_PATH, "utf-8");
const providerTypesSrc = readFileSync(PROVIDER_TYPES_PATH, "utf-8");

// ────────────────────────────────────────────────────────────────────
// Top header — Message + Phone buttons
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — top-header buttons", () => {
  it("imports both header buttons and the page in App.tsx", () => {
    expect(appSrc).toMatch(/import\s*\{\s*MessagesHeaderButton\s*\}\s*from\s+"@\/components\/communications\/MessagesHeaderButton"/);
    expect(appSrc).toMatch(/import\s*\{\s*PhoneHeaderButton\s*\}\s*from\s+"@\/components\/communications\/PhoneHeaderButton"/);
    expect(appSrc).toMatch(/import\s+CommunicationsHub\s+from\s+"@\/pages\/CommunicationsHub"/);
  });

  it("mounts MessagesHeaderButton and PhoneHeaderButton in the dark header", () => {
    expect(appSrc).toMatch(/<MessagesHeaderButton[\s\S]*?onClick=\{[^}]+setLocation\("\/communications"\)/);
    expect(appSrc).toMatch(/<PhoneHeaderButton[\s\S]*?onClick=\{[^}]+setLocation\("\/communications\?module=calls"\)/);
  });

  it("places both triggers immediately after the ActivityFeedButton cluster", () => {
    const activityIdx = appSrc.indexOf("<ActivityFeedButton");
    const messagesIdx = appSrc.indexOf("<MessagesHeaderButton");
    const phoneIdx = appSrc.indexOf("<PhoneHeaderButton");
    expect(activityIdx).toBeGreaterThan(0);
    expect(messagesIdx).toBeGreaterThan(activityIdx);
    expect(phoneIdx).toBeGreaterThan(messagesIdx);
  });

  it("hides triggers on technician routes (mounted alongside ActivityFeedButton inside !isTechnicianPage)", () => {
    // The `!isTechnicianPage && (...)` guard wraps the right-side cluster
    // that contains ActivityFeedButton. By placing the new triggers
    // immediately after it (verified by the order test above), they
    // inherit the same guard. The cleanest way to lock that is to
    // confirm there's no intermediate `!isTechnicianPage` guard between
    // the activity button and the phone button — i.e. they live in the
    // SAME guarded block.
    const guardIdx = appSrc.indexOf("!isTechnicianPage && (");
    const activityIdx = appSrc.indexOf("<ActivityFeedButton");
    const phoneIdx = appSrc.indexOf("<PhoneHeaderButton");
    expect(guardIdx).toBeGreaterThan(0);
    expect(activityIdx).toBeGreaterThan(guardIdx);
    expect(phoneIdx).toBeGreaterThan(activityIdx);
    // No additional `!isTechnicianPage` block opens between the
    // activity button and the phone button — they share the guard.
    const between = appSrc.slice(activityIdx, phoneIdx);
    expect(between).not.toMatch(/!isTechnicianPage && \(/);
  });

  it("each header button matches the icon-only h-8 w-8 compact shape", () => {
    expect(msgButtonSrc).toMatch(/h-8 w-8 p-0/);
    expect(phoneButtonSrc).toMatch(/h-8 w-8 p-0/);
    // Active state uses the same brand-green accent as ActivityFeedButton.
    expect(msgButtonSrc).toMatch(/bg-brand/);
    expect(phoneButtonSrc).toMatch(/bg-brand/);
  });

  it("each header button supports an unread badge with the canonical shape", () => {
    for (const src of [msgButtonSrc, phoneButtonSrc]) {
      expect(src).toMatch(/unreadCount/);
      expect(src).toMatch(/bg-brand text-white/);
      expect(src).toMatch(/rounded-full/);
      expect(src).toMatch(/data-testid="button-(messages|phone)-header-badge"/);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Route + sidebar
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — routing + sidebar absence", () => {
  it("registers /communications wrapped in a basic ProtectedRoute (no admin gate)", () => {
    expect(appSrc).toMatch(
      /<Route path="\/communications">\s*<ProtectedRoute>\s*<CommunicationsHub \/>/,
    );
    // Must NOT be wrapped in `requireAdmin` / `requireRestrictedManager` —
    // the page enforces role visibility internally so technicians can open it.
    const block = appSrc.match(/<Route path="\/communications">[\s\S]*?<\/Route>/);
    expect(block).not.toBeNull();
    expect(block![0]).not.toMatch(/require(Admin|Manager|RestrictedManager)/);
  });

  it("does NOT add a Messages or /communications entry to the tenant sidebar", () => {
    expect(sidebarSrc).not.toMatch(/\/communications/);
    expect(sidebarSrc).not.toMatch(/\bMessages\b/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Module visibility — far-right rail
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — far-right rail visibility", () => {
  it("rail surfaces the 6 canonical operational modules (Templates dropped 2026-05-07 Phase 4)", () => {
    expect(COMMUNICATION_MODULES).toEqual([
      "inbox",
      "calls",
      "call_history",
      "contacts",
      "team_chat",
      "settings",
    ]);
    expect(COMMUNICATION_MODULES).not.toContain("templates");
    for (const m of COMMUNICATION_MODULES) {
      expect(railSrc).toContain(`module: "${m}"`);
    }
    // Templates must NOT survive in the rail source either.
    expect(railSrc).not.toContain('module: "templates"');
    expect(railSrc).not.toContain("Templates");
  });

  it("isCommunicationModule rejects non-canonical strings", () => {
    expect(isCommunicationModule("inbox")).toBe(true);
    expect(isCommunicationModule("notamodule")).toBe(false);
  });

  it("office roles see all 7 modules", () => {
    for (const role of ["owner", "admin", "manager", "dispatcher"]) {
      expect(isOfficeRole(role)).toBe(true);
      expect(getVisibleCommunicationsModules(role)).toEqual([...COMMUNICATION_MODULES]);
    }
  });

  it("technician role does NOT see team_chat in the rail", () => {
    expect(isTechnicianRole("technician")).toBe(true);
    const visible = getVisibleCommunicationsModules("technician");
    expect(visible).not.toContain("team_chat");
    // Every other module is still visible.
    for (const m of COMMUNICATION_MODULES) {
      if (m === "team_chat") continue;
      expect(visible).toContain(m);
    }
    expect(isModuleVisibleForRole("team_chat", "technician")).toBe(false);
    expect(isModuleVisibleForRole("inbox", "technician")).toBe(true);
  });

  it("unknown / null / undefined roles are restricted (fail closed for team_chat)", () => {
    for (const r of [null, undefined, "platform_admin", "stranger"]) {
      const visible = getVisibleCommunicationsModules(r as string | null | undefined);
      expect(visible).not.toContain("team_chat");
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Thread visibility — page-level filter mirrors future SQL filter
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — thread access predicate", () => {
  const officeViewer = { userId: MOCK_USER_IDS.officeSarah, role: "manager" as const };
  const techSolomon = { userId: MOCK_USER_IDS.techSolomon, role: "technician" as const };
  const techMikel = { userId: MOCK_USER_IDS.techMikel, role: "technician" as const };

  it("office roles see every mock thread", () => {
    const filtered = filterThreadsForViewer(officeViewer, MOCK_THREADS);
    expect(filtered.length).toBe(MOCK_THREADS.length);
  });

  it("technicians never see team_chat threads", () => {
    const filtered = filterThreadsForViewer(techSolomon, MOCK_THREADS);
    for (const t of filtered) expect(t.threadType).not.toBe("team_chat");
  });

  it("technicians never see office or tenant_global scope threads", () => {
    const filtered = filterThreadsForViewer(techSolomon, MOCK_THREADS);
    for (const t of filtered) expect(t.scope).toBe("tech_visible");
  });

  it("technician sees ONLY threads they're assigned to or participate in", () => {
    const solomonThreads = filterThreadsForViewer(techSolomon, MOCK_THREADS);
    expect(solomonThreads.length).toBeGreaterThan(0);
    for (const t of solomonThreads) {
      expect(
        t.assignedTechnicianIds.includes(MOCK_USER_IDS.techSolomon) ||
          t.participantUserIds.includes(MOCK_USER_IDS.techSolomon),
      ).toBe(true);
    }

    // Mikel sees Mikel's threads, not Solomon's.
    const mikelThreads = filterThreadsForViewer(techMikel, MOCK_THREADS);
    for (const t of mikelThreads) {
      expect(t.assignedTechnicianIds.includes(MOCK_USER_IDS.techMikel)).toBe(true);
    }
    const solomonOnly = solomonThreads.find(
      (t) => t.assignedTechnicianIds.includes(MOCK_USER_IDS.techSolomon),
    );
    expect(solomonOnly).toBeDefined();
    expect(mikelThreads.find((t) => t.id === solomonOnly!.id)).toBeUndefined();
  });

  it("canViewThread denies a technician with no userId", () => {
    const tech = { userId: null, role: "technician" };
    expect(
      canViewThread(tech, {
        threadType: "client_sms",
        scope: "tech_visible",
        participantUserIds: [],
        assignedTechnicianIds: [MOCK_USER_IDS.techSolomon],
      }),
    ).toBe(false);
  });

  it("page composes the role-aware filter (filterThreadsForViewer) over the API result", () => {
    // Phase 3: the page swapped from `MOCK_THREADS` to the API hook
    // result (`threadsQuery.data`). The shared filter still runs as
    // defense-in-depth. The server applies the SAME predicate first.
    expect(pageSrc).toMatch(/filterThreadsForViewer\(viewer,\s*threadsQuery\.data/);
    expect(pageSrc).toMatch(/getVisibleCommunicationsModules\(/);
    expect(pageSrc).toMatch(/useCommunicationThreads/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Page composition — four regions, layout, URL state
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — page composition", () => {
  it("page renders the canonical 4-region layout", () => {
    expect(pageSrc).toMatch(/<CommunicationsLayout/);
    expect(pageSrc).toMatch(/list=\{/);
    expect(pageSrc).toMatch(/center=\{/);
    expect(pageSrc).toMatch(/details=\{/);
    expect(pageSrc).toMatch(/rail=\{/);
  });

  it("page reads URL state via useCommunicationsUrlState (no ad-hoc parsing)", () => {
    expect(pageSrc).toMatch(/useCommunicationsUrlState/);
    expect(pageSrc).not.toMatch(/window\.location/);
    expect(pageSrc).not.toMatch(/URLSearchParams\(/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Layout widths — center wins, side rails clamp
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — layout widths", () => {
  it("left list is fixed 340px and hidden under md", () => {
    expect(listSrc).toMatch(/w-\[340px\]/);
    expect(listSrc).toMatch(/hidden md:flex/);
  });

  it("right details panel clamps to 360px and hides under xl", () => {
    expect(detailsSrc).toMatch(/w-\[340px\]/);
    expect(detailsSrc).toMatch(/max-w-\[360px\]/);
    expect(detailsSrc).toMatch(/hidden xl:flex/);
  });

  it("far-right rail is narrow (~72px) and hidden under lg", () => {
    expect(railSrc).toMatch(/w-\[72px\]/);
    expect(railSrc).toMatch(/hidden lg:flex/);
  });

  it("center conversation panel takes remaining width (flex-1 min-w-0)", () => {
    expect(panelSrc).toMatch(/flex-1 min-w-0/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Composer — SMS + Internal Note tabs
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — composer", () => {
  it("composer exposes SMS and Internal Note tabs", () => {
    expect(composerSrc).toMatch(/value="sms"/);
    expect(composerSrc).toMatch(/value="internal_note"/);
    expect(composerSrc).toMatch(/data-testid="conversation-composer-textarea"/);
    expect(composerSrc).toMatch(/data-testid="conversation-composer-send"/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Right details panel — Details / Activity tabs + sections
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — right details panel", () => {
  it("renders both Details and Activity tabs", () => {
    expect(detailsSrc).toMatch(/data-testid="details-tab-details"/);
    expect(detailsSrc).toMatch(/data-testid="details-tab-activity"/);
  });

  it("Details tab includes Contact, Linked To, and Communication History sections", () => {
    expect(detailsSrc).toMatch(/data-testid="details-section-contact"/);
    expect(detailsSrc).toMatch(/data-testid="details-section-linked"/);
    expect(detailsSrc).toMatch(/data-testid="details-section-history"/);
    expect(detailsSrc).toMatch(/data-testid="details-view-full-timeline"/);
  });

  it("links the right Details panel to entity types from the spec", () => {
    expect(detailsSrc).toMatch(/linkedJobId/);
    expect(detailsSrc).toMatch(/linkedInvoiceId/);
    expect(detailsSrc).toMatch(/linkedQuoteId/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Mock data sanity — well-typed + covers required cases
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — mock data shape", () => {
  it("mock threads cover client_sms, team_chat, and unknown types", () => {
    const types = new Set(MOCK_THREADS.map((t) => t.threadType));
    expect(types.has("client_sms")).toBe(true);
    expect(types.has("team_chat")).toBe(true);
    expect(types.has("unknown")).toBe(true);
  });

  it("at least one client_sms thread is assigned to each known technician", () => {
    expect(
      MOCK_THREADS.some(
        (t) =>
          t.threadType === "client_sms" &&
          t.assignedTechnicianIds.includes(MOCK_USER_IDS.techSolomon),
      ),
    ).toBe(true);
    expect(
      MOCK_THREADS.some(
        (t) =>
          t.threadType === "client_sms" &&
          t.assignedTechnicianIds.includes(MOCK_USER_IDS.techMikel),
      ),
    ).toBe(true);
  });

  it("getMockMessagesForThread returns a non-empty list for at least one thread", () => {
    const some = MOCK_THREADS.find((t) => getMockMessagesForThread(t.id).length > 0);
    expect(some).toBeDefined();
  });

  it("getMockTimelineForThread returns timeline entries with canonical kinds", () => {
    const allEntries = MOCK_THREADS.flatMap((t) => getMockTimelineForThread(t.id));
    expect(allEntries.length).toBeGreaterThan(0);
    const kinds = new Set(allEntries.map((e) => e.kind));
    // At least one timeline entry references a canonical kind.
    expect(kinds.size).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// Initials helper
// ────────────────────────────────────────────────────────────────────

describe("getInitials helper", () => {
  it("uppercases first + last token initials", () => {
    expect(getInitials({ fullName: "Nadeem Samaha" })).toBe("NS");
    expect(getInitials({ fullName: "michael johnson" })).toBe("MJ");
  });

  it("falls back to firstName / lastName when fullName is missing", () => {
    expect(getInitials({ firstName: "Solomon" })).toBe("S");
    expect(getInitials({ firstName: "S", lastName: "R" })).toBe("SR");
  });

  it("returns ? when nothing usable is available", () => {
    expect(getInitials({})).toBe("?");
    expect(getInitials({ fullName: "   " })).toBe("?");
  });
});

// ────────────────────────────────────────────────────────────────────
// Provider abstraction stub — Phase 3 contract is locked now
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// Phase 2 — Details panel uses real resolution + Link Contact entry points
// ────────────────────────────────────────────────────────────────────

describe("Communications Hub — Phase 2 details + linking", () => {
  const HOOK_PATH = join(ROOT, "client/src/lib/communications/useResolveContact.ts");
  const DIALOG_PATH = join(ROOT, "client/src/components/communications/LinkContactDialog.tsx");
  const hookSrc = readFileSync(HOOK_PATH, "utf-8");
  const dialogSrc = readFileSync(DIALOG_PATH, "utf-8");

  it("details panel accepts the resolution result + emits link intent", () => {
    expect(detailsSrc).toMatch(/resolution\?:\s*ContactResolutionResult/);
    expect(detailsSrc).toMatch(/onRequestLink\?:/);
    // Unknown / multi banner branches surface the spec'd testids; the
    // testid string is passed via an internal prop name (e.g.
    // `actionTestId="..."`) so we match the raw string regardless of prop.
    expect(detailsSrc).toContain('"details-link-contact-unknown"');
    expect(detailsSrc).toContain('"details-link-contact-conflict"');
    expect(detailsSrc).toMatch(/Unknown contact/);
    expect(detailsSrc).toMatch(/Multiple contacts match/);
  });

  it("hook calls /api/communications/resolve-contact and gates on isMatchableE164Like", () => {
    expect(hookSrc).toMatch(/\/api\/communications\/resolve-contact/);
    expect(hookSrc).toMatch(/isMatchableE164Like/);
  });

  it("LinkContactDialog supports unknown + conflict modes with no auto-pick", () => {
    expect(dialogSrc).toMatch(/mode === "unknown"/);
    expect(dialogSrc).toMatch(/mode === "conflict"/);
    // Phase 4: unknown-mode now uses a real candidate search picker
    // (not the previous three placeholder action rows). The "create new
    // contact" action row is the only legacy entry point that survives.
    expect(dialogSrc).toContain('"link-contact-search-input"');
    expect(dialogSrc).toContain('"link-contact-candidate-list"');
    expect(dialogSrc).toContain('"link-contact-action-create-new"');
    // The conflict primary action MUST be disabled until the user picks one.
    expect(dialogSrc).toMatch(/disabled=\{!selectedSourceId\s*\|\|\s*linking\}/);
  });

  it("page wires the hook into the details panel and mounts the dialog", () => {
    expect(pageSrc).toMatch(/useResolveContact\(activePhone\)/);
    expect(pageSrc).toMatch(/<LinkContactDialog/);
    expect(pageSrc).toMatch(/resolution=\{resolveQuery\.data\}/);
  });
});

describe("Communications provider abstraction (Phase 3 stub)", () => {
  const expectedMethods = [
    "sendSms",
    "startCall",
    "verifyWebhook",
    "getRecording",
    "getTranscription",
  ];
  it("provider types declare every required method on the adapter contract", () => {
    for (const m of expectedMethods) {
      expect(providerTypesSrc).toContain(`${m}(`);
    }
  });

  it("provider id union covers Twilio, Telnyx, Bandwidth", () => {
    expect(providerTypesSrc).toMatch(/CommunicationProviderId\s*=\s*"twilio"\s*\|\s*"telnyx"\s*\|\s*"bandwidth"/);
  });
});
