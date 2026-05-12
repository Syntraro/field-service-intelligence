/**
 * Shell Phase 1 canonicalization guard (2026-05-11).
 *
 * Enforces that the six shell-chrome files use canonical shell tokens and
 * do not regress to hardcoded dark-chrome classes. Mirrors the pattern of
 * chip-canonical.test.ts and form-canonical-drift.test.ts — reads source
 * files, strips comments, and asserts class-level contracts.
 *
 * Negative pins (must NOT appear after stripping comments):
 *   - bg-slate-800 / bg-slate-700 used as shell control surfaces
 *   - border-slate-700 used as shell control borders
 *   - text-slate-100 used as shell control foreground
 *   - text-slate-400 used as shell muted text
 *   - text-slate-300 used as shell notice muted text
 *   - text-white/70, text-white/50 as inline opacity patterns
 *   - bg-white/[0.08], bg-white/[0.16] as inline overlay patterns
 *   - border-white/10 as inline divider patterns
 *   - hardcoded hex shell colors: #C2E974, #9CA3AF, #111827
 *   - hardcoded brand hex bypass: border-l-[#76B054], border-[#76B054]
 *   - hardcoded brand ring bypass: ring-[rgba(118,176,84,0.25)]
 *
 * Positive pins (canonical tokens MUST be present):
 *   - shell-control-bg used in control buttons
 *   - shell-nav-text used in nav items
 *   - shell-search-bg used in search input
 *   - shell-notice-bg used in notice banner
 *
 * Out-of-scope guards (confirmed not introduced by this phase):
 *   - No `.light` class theming
 *   - No localStorage theme persistence in shell files
 *   - No `appearance` or `themePreference` user DB fields
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Helpers ───────────────────────────────────────────────────────────────

function read(rel: string) {
  return readFileSync(resolve(__dirname, rel), "utf-8");
}

/** Strip block and line comments so pin strings don't match documentation. */
function stripComments(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ── Shell file sources ────────────────────────────────────────────────────

const appSrc        = stripComments(read("../client/src/App.tsx"));
const sidebarSrc    = stripComments(read("../client/src/components/AppSidebar.tsx"));
const searchSrc     = stripComments(read("../client/src/components/UniversalSearch.tsx"));
const activitySrc   = stripComments(read("../client/src/components/activity-feed/ActivityFeedButton.tsx"));
const messagesSrc   = stripComments(read("../client/src/components/communications/MessagesHeaderButton.tsx"));
const noticeSrc     = stripComments(read("../client/src/components/GlobalNotice.tsx"));

const allShellSrcs: [string, string][] = [
  ["App.tsx",                    appSrc],
  ["AppSidebar.tsx",             sidebarSrc],
  ["UniversalSearch.tsx",        searchSrc],
  ["ActivityFeedButton.tsx",     activitySrc],
  ["MessagesHeaderButton.tsx",   messagesSrc],
  ["GlobalNotice.tsx",           noticeSrc],
];

// ── 1. Hardcoded dark-chrome class removal ────────────────────────────────

describe("Shell Phase 1 — no hardcoded dark-chrome classes in shell controls", () => {
  it("App.tsx: no bg-slate-800 shell control surface", () => {
    // bg-brand/text-white on the create button is intentional — guard the
    // slate variant only.
    expect(appSrc).not.toMatch(/bg-slate-800/);
  });

  it("App.tsx: no bg-slate-700 hover surface", () => {
    expect(appSrc).not.toMatch(/bg-slate-700/);
  });

  it("App.tsx: no border-slate-700 control border", () => {
    expect(appSrc).not.toMatch(/border-slate-700/);
  });

  it("App.tsx: no text-slate-100 control foreground", () => {
    expect(appSrc).not.toMatch(/text-slate-100/);
  });

  it("App.tsx: no text-slate-400 muted text", () => {
    expect(appSrc).not.toMatch(/text-slate-400/);
  });

  it("App.tsx: no hover:bg-white/10 ghost overlay", () => {
    expect(appSrc).not.toMatch(/hover:bg-white\/10/);
  });

  it("AppSidebar.tsx: no style={{ borderRight:'none' }} JSX inline override (Phase 2C)", () => {
    // Read raw source — stripComments drops this file's JSX due to /tech/* glob patterns
    // in line comments. Guard the JSX inline style pattern specifically (not the stale comment).
    const rawSidebarSrc = read("../client/src/components/AppSidebar.tsx");
    expect(rawSidebarSrc).not.toMatch(/style=\{\{[^}]*borderRight[^}]*none/);
  });

  it("AppSidebar.tsx: no text-white/70 nav item text", () => {
    expect(sidebarSrc).not.toMatch(/text-white\/70/);
  });

  it("AppSidebar.tsx: no text-white/50 icon opacity pattern", () => {
    expect(sidebarSrc).not.toMatch(/text-white\/50/);
  });

  it("AppSidebar.tsx: no bg-white/[0.08] hover overlay", () => {
    expect(sidebarSrc).not.toMatch(/bg-white\/\[0\.08\]/);
  });

  it("AppSidebar.tsx: no bg-white/[0.16] active overlay", () => {
    expect(sidebarSrc).not.toMatch(/bg-white\/\[0\.16\]/);
  });

  it("AppSidebar.tsx: no border-white/10 divider", () => {
    expect(sidebarSrc).not.toMatch(/border-white\/10/);
  });

  it("AppSidebar.tsx: no hardcoded icon-active hex #C2E974", () => {
    expect(sidebarSrc).not.toMatch(/#C2E974/i);
  });

  it("AppSidebar.tsx: no hardcoded nav-active-border hex #76B054 via border-l", () => {
    expect(sidebarSrc).not.toMatch(/border-l-\[#76B054\]/i);
  });

  it("UniversalSearch.tsx: no hardcoded placeholder hex #9CA3AF", () => {
    expect(searchSrc).not.toMatch(/#9CA3AF/i);
  });

  it("UniversalSearch.tsx: no hardcoded foreground hex #111827", () => {
    expect(searchSrc).not.toMatch(/#111827/i);
  });

  it("UniversalSearch.tsx: no hardcoded focus-border hex #76B054", () => {
    expect(searchSrc).not.toMatch(/border-\[#76B054\]/i);
  });

  it("UniversalSearch.tsx: no hardcoded focus-ring rgba bypass", () => {
    expect(searchSrc).not.toMatch(/ring-\[rgba\(118,176,84/);
  });

  it("UniversalSearch.tsx: no bg-white/90 input surface overlay", () => {
    expect(searchSrc).not.toMatch(/bg-white\/90/);
  });

  it("UniversalSearch.tsx: no border-white/20 input border overlay", () => {
    expect(searchSrc).not.toMatch(/border-white\/20/);
  });

  it("ActivityFeedButton.tsx: no bg-slate-800 resting state", () => {
    expect(activitySrc).not.toMatch(/bg-slate-800/);
  });

  it("ActivityFeedButton.tsx: no border-slate-700 resting border", () => {
    expect(activitySrc).not.toMatch(/border-slate-700/);
  });

  it("ActivityFeedButton.tsx: no text-slate-100 resting foreground", () => {
    expect(activitySrc).not.toMatch(/text-slate-100/);
  });

  it("MessagesHeaderButton.tsx: no bg-slate-800 resting state", () => {
    expect(messagesSrc).not.toMatch(/bg-slate-800/);
  });

  it("MessagesHeaderButton.tsx: no border-slate-700 resting border", () => {
    expect(messagesSrc).not.toMatch(/border-slate-700/);
  });

  it("MessagesHeaderButton.tsx: no text-slate-100 resting foreground", () => {
    expect(messagesSrc).not.toMatch(/text-slate-100/);
  });

  it("GlobalNotice.tsx: no bg-slate-800 notice surface", () => {
    expect(noticeSrc).not.toMatch(/bg-slate-800/);
  });

  it("GlobalNotice.tsx: no bg-slate-700 dismiss hover surface", () => {
    expect(noticeSrc).not.toMatch(/bg-slate-700/);
  });

  it("GlobalNotice.tsx: no text-slate-100 notice foreground", () => {
    expect(noticeSrc).not.toMatch(/text-slate-100/);
  });

  it("GlobalNotice.tsx: no text-slate-300 notice muted", () => {
    expect(noticeSrc).not.toMatch(/text-slate-300/);
  });

  it("GlobalNotice.tsx: no non-semantic severity dot colors (bg-sky-400, bg-amber-400, bg-rose-400/500)", () => {
    expect(noticeSrc).not.toMatch(/bg-sky-400/);
    expect(noticeSrc).not.toMatch(/bg-amber-400/);
    expect(noticeSrc).not.toMatch(/bg-rose-400/);
    expect(noticeSrc).not.toMatch(/bg-rose-500/);
  });

  it("GlobalNotice.tsx: no non-semantic severity border colors (border-sky-500, border-amber-500, border-rose-500)", () => {
    expect(noticeSrc).not.toMatch(/border-sky-500/);
    expect(noticeSrc).not.toMatch(/border-amber-500/);
    expect(noticeSrc).not.toMatch(/border-rose-500/);
  });
});

// ── 2. Canonical token usage ──────────────────────────────────────────────

describe("Shell Phase 1 — canonical shell tokens are present", () => {
  it("App.tsx: uses shell-control-bg for Tasks button", () => {
    expect(appSrc).toMatch(/bg-shell-control-bg/);
  });

  it("App.tsx: uses shell-control-border for Tasks button border", () => {
    expect(appSrc).toMatch(/border-shell-control-border/);
  });

  it("App.tsx: uses shell-control-foreground for Tasks button text", () => {
    expect(appSrc).toMatch(/text-shell-control-foreground/);
  });

  it("App.tsx: uses shell-divider for header border", () => {
    expect(appSrc).toMatch(/border-shell-divider/);
  });

  it("App.tsx: uses shell-nav-icon for muted text", () => {
    expect(appSrc).toMatch(/text-shell-nav-icon/);
  });

  it("App.tsx: uses shell-nav-hover-text for company name and hover states", () => {
    expect(appSrc).toMatch(/text-shell-nav-hover-text/);
  });

  it("AppSidebar.tsx: uses shell-nav-text for nav item text", () => {
    expect(sidebarSrc).toMatch(/text-shell-nav-text/);
  });

  it("AppSidebar.tsx: uses shell-nav-hover-bg for nav hover background", () => {
    expect(sidebarSrc).toMatch(/bg-shell-nav-hover-bg/);
  });

  it("AppSidebar.tsx: uses shell-nav-active-bg for active nav background", () => {
    expect(sidebarSrc).toMatch(/bg-shell-nav-active-bg/);
  });

  it("AppSidebar.tsx: uses shell-nav-active-border for active left border", () => {
    expect(sidebarSrc).toMatch(/border-l-shell-nav-active-border/);
  });

  it("AppSidebar.tsx: uses shell-nav-icon-active for active nav icon", () => {
    expect(sidebarSrc).toMatch(/text-shell-nav-icon-active/);
  });

  it("AppSidebar.tsx: uses shell-divider for section dividers", () => {
    expect(sidebarSrc).toMatch(/border-shell-divider/);
  });

  it("UniversalSearch.tsx: uses shell-search-bg for input background", () => {
    expect(searchSrc).toMatch(/bg-shell-search-bg/);
  });

  it("UniversalSearch.tsx: uses shell-search-border for input border", () => {
    expect(searchSrc).toMatch(/border-shell-search-border/);
  });

  it("UniversalSearch.tsx: uses shell-search-foreground for input text", () => {
    expect(searchSrc).toMatch(/text-shell-search-foreground/);
  });

  it("UniversalSearch.tsx: uses shell-search-placeholder for placeholder and icon", () => {
    expect(searchSrc).toMatch(/text-shell-search-placeholder/);
  });

  it("UniversalSearch.tsx: uses brand token for focus ring (not hardcoded rgba)", () => {
    expect(searchSrc).toMatch(/ring-brand/);
  });

  it("ActivityFeedButton.tsx: uses shell-control-bg for resting state", () => {
    expect(activitySrc).toMatch(/bg-shell-control-bg/);
  });

  it("ActivityFeedButton.tsx: uses shell-control-border for resting border", () => {
    expect(activitySrc).toMatch(/border-shell-control-border/);
  });

  it("MessagesHeaderButton.tsx: uses shell-control-bg for resting state", () => {
    expect(messagesSrc).toMatch(/bg-shell-control-bg/);
  });

  it("MessagesHeaderButton.tsx: uses shell-control-border for resting border", () => {
    expect(messagesSrc).toMatch(/border-shell-control-border/);
  });

  it("GlobalNotice.tsx: uses shell-notice-bg for surface", () => {
    expect(noticeSrc).toMatch(/bg-shell-notice-bg/);
  });

  it("GlobalNotice.tsx: uses shell-notice-foreground for text", () => {
    expect(noticeSrc).toMatch(/text-shell-notice-foreground/);
  });

  it("GlobalNotice.tsx: uses shell-notice-muted for dismiss icon", () => {
    expect(noticeSrc).toMatch(/text-shell-notice-muted/);
  });

  it("GlobalNotice.tsx: uses semantic bg-info / bg-warning / bg-danger for severity dots", () => {
    expect(noticeSrc).toMatch(/bg-info/);
    expect(noticeSrc).toMatch(/bg-warning/);
    expect(noticeSrc).toMatch(/bg-danger/);
  });

  it("AppSidebar.tsx: uses border-sidebar-border for sidebar edge color (Phase 2C)", () => {
    // Read raw source — stripComments drops JSX in this file due to /tech/* glob patterns
    // in line comments creating unbalanced /* tokens that the regex greedily consumes.
    const rawSidebarSrc = read("../client/src/components/AppSidebar.tsx");
    expect(rawSidebarSrc).toMatch(/border-sidebar-border/);
  });
});

// ── 3. Phase boundary guards — nothing out of scope was introduced ────────

describe("Shell Phase 1 — phase boundary: no light-mode, no theme persistence", () => {
  // App.tsx is excluded here: Phase 3 adds legitimate "light"/"dark" string values
  // for the appearance toggle and useTheme import. Use nonOrchestrationShellSrcs to
  // guard the remaining shell consumer files.
  it.each(nonOrchestrationShellSrcs)("%s: no .light class theming introduced", (_, src) => {
    expect(src).not.toMatch(/["'\s]light["'\s]/);
    expect(src).not.toMatch(/class.*\.light/);
  });

  it.each(nonOrchestrationShellSrcs)("%s: no localStorage theme/appearance key introduced", (_, src) => {
    expect(src).not.toMatch(/localStorage.*theme/i);
    expect(src).not.toMatch(/localStorage.*appearance/i);
    expect(src).not.toMatch(/localStorage.*colorScheme/i);
  });

  it.each(allShellSrcs)("%s: no dark: Tailwind prefix in shell files (shell is token-driven)", (_, src) => {
    expect(src).not.toMatch(/\bdark:/);
  });
});

// ── 4. Token definitions exist in index.css ───────────────────────────────

describe("Shell Phase 1 — token definitions exist in index.css", () => {
  const cssSrc = read("../client/src/index.css");

  const REQUIRED_TOKENS = [
    "--shell-control-bg",
    "--shell-control-foreground",
    "--shell-control-border",
    "--shell-control-hover-bg",
    "--shell-divider",
    "--shell-nav-text",
    "--shell-nav-hover-text",
    "--shell-nav-hover-bg",
    "--shell-nav-active-bg",
    "--shell-nav-active-text",
    "--shell-nav-active-border",
    "--shell-nav-icon",
    "--shell-nav-icon-active",
    "--shell-search-bg",
    "--shell-search-border",
    "--shell-search-foreground",
    "--shell-search-placeholder",
    "--shell-notice-bg",
    "--shell-notice-foreground",
    "--shell-notice-muted",
    "--shell-notice-hover-bg",
  ];

  it.each(REQUIRED_TOKENS)("index.css defines %s", (token) => {
    expect(cssSrc).toMatch(new RegExp(`${token}:`));
  });
});

// ── 5. Tailwind utilities are wired ──────────────────────────────────────

describe("Shell Phase 1 — Tailwind utilities wired in tailwind.config.ts", () => {
  const twSrc = read("../tailwind.config.ts");

  it("tailwind.config.ts references shell-control-bg", () => {
    expect(twSrc).toMatch(/shell-control/);
  });

  it("tailwind.config.ts references shell-nav", () => {
    expect(twSrc).toMatch(/shell-nav/);
  });

  it("tailwind.config.ts references shell-search", () => {
    expect(twSrc).toMatch(/shell-search/);
  });

  it("tailwind.config.ts references shell-notice", () => {
    expect(twSrc).toMatch(/shell-notice/);
  });

  it("tailwind.config.ts references shell-divider", () => {
    expect(twSrc).toMatch(/shell-divider/);
  });
});

// ── 6. Light block exists and overrides every shell token ─────────────────
//
// Verifies the Phase 2 .light block is present in index.css and provides
// complete coverage of all 21 --shell-* tokens plus the chrome surface tokens
// (--header-bg, --sidebar, --sidebar-foreground, --sidebar-border).

describe("Shell Phase 2 — .light block exists and overrides all shell tokens", () => {
  const cssSrc = read("../client/src/index.css");

  // Capture the .light { ... } block (non-greedy, stops at first closing brace)
  const lightBlockMatch = cssSrc.match(/\.light\s*\{([^}]*)\}/);
  const lightBlock = lightBlockMatch?.[1] ?? "";

  it("index.css contains a .light { } block", () => {
    expect(cssSrc).toMatch(/\.light\s*\{/);
  });

  it(".light block overrides --header-bg (chrome surface)", () => {
    expect(lightBlock).toMatch(/--header-bg:/);
  });

  it(".light block overrides --sidebar (shadcn Sidebar primitive token)", () => {
    expect(lightBlock).toMatch(/--sidebar:/);
  });

  it(".light block overrides --sidebar-foreground", () => {
    expect(lightBlock).toMatch(/--sidebar-foreground:/);
  });

  it(".light block overrides --sidebar-border", () => {
    expect(lightBlock).toMatch(/--sidebar-border:/);
  });

  const LIGHT_SHELL_OVERRIDES = [
    "--shell-control-bg",
    "--shell-control-foreground",
    "--shell-control-border",
    "--shell-control-hover-bg",
    "--shell-divider",
    "--shell-nav-text",
    "--shell-nav-hover-text",
    "--shell-nav-hover-bg",
    "--shell-nav-active-bg",
    "--shell-nav-active-text",
    "--shell-nav-active-border",
    "--shell-nav-icon",
    "--shell-nav-icon-active",
    "--shell-search-bg",
    "--shell-search-border",
    "--shell-search-foreground",
    "--shell-search-placeholder",
    "--shell-notice-bg",
    "--shell-notice-foreground",
    "--shell-notice-muted",
    "--shell-notice-hover-bg",
  ];

  it.each(LIGHT_SHELL_OVERRIDES)(".light block overrides %s", (token) => {
    expect(lightBlock).toMatch(new RegExp(`${token.replace("--", "--")}:`));
  });
});

// ── 7. Phase 2/3 boundary guards ─────────────────────────────────────────
//
// Phase 2: strictly CSS token overrides — no ThemeProvider, no isDark/isLight
// conditionals, no dark: prefixes.
// Phase 3: useTheme is authorized ONLY in App.tsx (the orchestration layer).
// All other shell consumer files remain theme-infrastructure-free.

// Shell files other than App.tsx — must never use theme infrastructure.
const nonOrchestrationShellSrcs: [string, string][] = allShellSrcs.filter(
  ([name]) => name !== "App.tsx"
);

describe("Shell Phase 2/3 — no theme infrastructure in non-orchestration shell files", () => {
  it("App.tsx: no ThemeProvider import or usage (not the right pattern)", () => {
    expect(appSrc).not.toMatch(/ThemeProvider/);
  });

  it("App.tsx: imports useTheme from @/hooks/useTheme (Phase 3 authorized location)", () => {
    expect(appSrc).toMatch(/useTheme/);
  });

  it.each(nonOrchestrationShellSrcs)("%s: no isDark / isLight conditional theme pattern", (_, src) => {
    expect(src).not.toMatch(/\bisDark\s*\?/);
    expect(src).not.toMatch(/\bisLight\s*\?/);
  });

  it.each(nonOrchestrationShellSrcs)("%s: no useTheme hook (authorized in App.tsx only)", (_, src) => {
    expect(src).not.toMatch(/useTheme\s*\(/);
  });

  it.each(allShellSrcs)("%s: no dark: Tailwind prefix (shell is token-driven)", (_, src) => {
    expect(src).not.toMatch(/\bdark:/);
  });
});

// ── 8. Phase 3C — light shell final polish rules ──────────────────────────

describe("Shell Phase 3C — light-mode polish rules wired in index.css", () => {
  const cssSrc = read("../client/src/index.css");
  const cssNoComments = cssSrc.replace(/\/\*[\s\S]*?\*\//g, "");

  it("index.css has full-opacity nav text override for .light inactive menu buttons", () => {
    expect(cssSrc).toMatch(/\.light\s+\[data-sidebar="menu-button"\]/);
  });

  it("index.css has full-opacity nav icon override for .light inactive menu button SVGs", () => {
    expect(cssSrc).toMatch(/\.light\s+\[data-sidebar="menu-button"\][^{]+svg/);
  });

  it("index.css has search border override targeting universal-search-input testid", () => {
    expect(cssSrc).toMatch(/\.light\s+\[data-testid="universal-search-input"\]/);
  });

  it("index.css removes rounded corner on .light main.bg-app-bg", () => {
    expect(cssSrc).toMatch(/\.light\s+main\.bg-app-bg/);
  });

  it("index.css: no filter: invert or hue-rotate reintroduced (logo uses dedicated asset)", () => {
    expect(cssNoComments).not.toMatch(/filter[^;]*invert/);
    expect(cssNoComments).not.toMatch(/hue-rotate/);
  });
});
