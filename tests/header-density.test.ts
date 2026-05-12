/**
 * Header density + ordering source-pin tests (2026-05-12).
 *
 * Pins the class contracts and DOM ordering for the top-shell header after
 * the visual density audit:
 *   - Outer header uses gap-2 (tighter than gap-3)
 *   - Logo link uses gap-2 (tighter than gap-4)
 *   - GlobalNotice capped at max-w-[360px] (not 520px)
 *   - More menu button explicitly h-8 w-8 (matches all other utility controls)
 *   - Tasks button icon-only h-8 w-8 p-0 (consistent with Activity/Messages)
 *   - Create button lifted out of the utility cluster, anchored to search
 *   - Utility cluster uses gap-1.5
 *
 * Uses source-file reading (same pattern as chip-canonical.test.ts)
 * because the vitest config runs node-environment tests only, not JSX
 * renders.
 *
 * These pins fail if a future edit:
 *   - widens header gap back to gap-3+
 *   - widens logo link gap back to gap-4+
 *   - removes the GlobalNotice max-w cap or exceeds 360px
 *   - removes h-8 w-8 from the more menu or Tasks buttons
 *   - moves the Create button back inside the utility cluster div
 *   - widens the utility cluster gap back to gap-2+
 *   - removes the Tasks icon (ClipboardList) or its aria-label
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const APP_PATH = resolve(__dirname, "../client/src/App.tsx");
const NOTICE_PATH = resolve(__dirname, "../client/src/components/GlobalNotice.tsx");
const src = readFileSync(APP_PATH, "utf-8");
const noticeSrc = readFileSync(NOTICE_PATH, "utf-8");

describe("header shell — outer density", () => {
  it("header outer flex uses gap-2", () => {
    expect(src).toContain(
      'className="flex items-center gap-2 px-3 h-16 shrink-0 z-20 bg-header-bg border-b border-white/[0.06]"',
    );
  });

  it("logo link uses gap-2 (not gap-4)", () => {
    expect(src).toContain(
      'className="flex items-center gap-2 shrink-0 cursor-pointer no-underline"',
    );
    expect(src).not.toContain("gap-4 shrink-0 cursor-pointer");
  });

  it("more menu button has explicit h-8 w-8 to match other utility controls", () => {
    // size="icon" defaults to h-9 w-9 in button.tsx — must be overridden for height parity.
    expect(src).toContain(
      'data-testid="button-more-menu" className="h-8 w-8 text-slate-400',
    );
  });
});

describe("GlobalNotice — max-width cap", () => {
  it("notice is capped at max-w-[360px] (not 520px)", () => {
    expect(noticeSrc).toContain("max-w-[360px]");
    expect(noticeSrc).not.toContain("max-w-[520px]");
  });
});

describe("header create button — anchored to search (not utility cluster)", () => {
  it("Create button (button-create-header) appears before the utility cluster div", () => {
    const createIdx = src.indexOf('data-testid="button-create-header"');
    const clusterIdx = src.indexOf('className="flex items-center gap-1.5 shrink-0"');
    expect(createIdx).toBeGreaterThan(-1);
    expect(clusterIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeLessThan(clusterIdx);
  });

  it("Create button appears after UniversalSearch in source order", () => {
    const searchIdx = src.indexOf("<UniversalSearch");
    const createIdx = src.indexOf('data-testid="button-create-header"');
    expect(searchIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(searchIdx);
  });

  it("Create button is NOT inside the utility cluster div", () => {
    const clusterStart = src.indexOf('className="flex items-center gap-1.5 shrink-0"');
    const createIdx = src.indexOf('data-testid="button-create-header"');
    expect(createIdx).toBeLessThan(clusterStart);
  });
});

describe("header utility cluster — density contract", () => {
  it("utility cluster uses gap-1.5", () => {
    expect(src).toContain('className="flex items-center gap-1.5 shrink-0"');
  });

  it("Tasks button is icon-only h-8 w-8 p-0 (matches Activity and Messages buttons)", () => {
    expect(src).toContain(
      '"relative h-8 w-8 p-0 inline-flex items-center justify-center bg-slate-800/60 border-slate-700',
    );
  });

  it("Tasks ClipboardList icon remains present", () => {
    expect(src).toContain('<ClipboardList className="h-4 w-4" />');
  });

  it("Tasks button retains an accessible aria-label", () => {
    expect(src).toContain('data-testid="button-tasks-header"');
    expect(src).toContain("aria-label={`Tasks");
  });

  it("Tasks badge is absolute-positioned at top-right (not in flex flow)", () => {
    // Badge must use absolute -top-1 -right-1 so it does not push the button wider.
    expect(src).toContain(
      '"absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-brand text-white border border-header-bg h-4 min-w-4 px-1 text-helper"',
    );
  });

  it("Tasks badge renders only when activeTaskCount > 0", () => {
    // Conditional render guard must be present.
    expect(src).toContain("activeTaskCount > 0 &&");
    expect(src).toContain('data-testid="badge-tasks-count"');
  });
});

describe("header utility cluster — ordering", () => {
  it("activity appears before messages in source order", () => {
    const actIdx = src.indexOf("<ActivityFeedButton");
    const msgIdx = src.indexOf("<MessagesHeaderButton");
    expect(actIdx).toBeLessThan(msgIdx);
  });

  it("messages appears before tasks in source order", () => {
    const msgIdx = src.indexOf("<MessagesHeaderButton");
    const tasksIdx = src.indexOf('data-testid="button-tasks-header"');
    expect(msgIdx).toBeLessThan(tasksIdx);
  });

  it("tasks appears before help in source order", () => {
    const tasksIdx = src.indexOf('data-testid="button-tasks-header"');
    const helpIdx = src.indexOf('data-testid="button-help-header"');
    expect(tasksIdx).toBeLessThan(helpIdx);
  });

  it("help appears before more-menu in source order", () => {
    const helpIdx = src.indexOf('data-testid="button-help-header"');
    const moreIdx = src.indexOf('data-testid="button-more-menu"');
    expect(helpIdx).toBeLessThan(moreIdx);
  });
});
