/**
 * Job Detail — canonical detail header (2026-05-07 unified card,
 * 2026-05-08 CanonicalDetailHeader migration).
 *
 * 2026-05-07: the standalone `<CanonicalDetailHeader>` strip + the
 * separate `card-job-context` CardShell were merged into ONE unified
 * primary detail card.
 *
 * 2026-05-08: the merged card's 2-column content layout was extracted
 * into `CanonicalDetailHeader layout="card"`. The outer CardShell,
 * description section, and edit footer remain as page-level elements
 * (CardShell siblings, not inside the canonical component). The title,
 * status badge, client link, address, actions, and meta items are
 * passed as props.
 *
 * This file pins:
 *   - CanonicalDetailHeader IS imported and used with layout="card"
 *   - CardShell still owns the card chrome + description + footer
 *   - Title H1 / textarea, StatusPill, client link, AddressBlock are
 *     correctly passed as props (still present in source)
 *   - The three meta items (job-number, scheduled, invoice-number) are
 *     passed with the canonical keys and EntityNumber variants
 *   - Action testids remain present in the actions prop expression
 *   - Exactly one CanonicalDetailHeader with testId="job-detail-header"
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const JOB_DETAIL = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
const jobDetailSrc = readFileSync(JOB_DETAIL, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const codeOnly = stripComments(jobDetailSrc);

// ── 1. CanonicalDetailHeader IS now imported and used ──────────────

describe("JobDetailPage — uses CanonicalDetailHeader for card content layout", () => {
  it("imports CanonicalDetailHeader from @/components/detail/CanonicalDetailHeader", () => {
    // 2026-05-08: migrated from inline CardShell content to canonical component.
    expect(codeOnly).toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("renders <CanonicalDetailHeader layout=\"card\" …> JSX", () => {
    expect(codeOnly).toMatch(/<CanonicalDetailHeader\b/);
    expect(codeOnly).toMatch(/layout="card"/);
  });

  it("passes testId=\"job-detail-header\" to CanonicalDetailHeader", () => {
    expect(codeOnly).toMatch(/testId="job-detail-header"/);
  });
});

// ── 2. CardShell still wraps the canonical header + siblings ────────

describe("JobDetailPage — CardShell chrome is preserved", () => {
  it("the `card-job-context` CardShell is present (outer card chrome owner)", () => {
    expect(jobDetailSrc).toMatch(/<CardShell\s+data-testid="card-job-context">/);
  });

  it("CanonicalDetailHeader with testId='job-detail-header' is a CardShell child", () => {
    const cardShellMatch = jobDetailSrc.match(
      /<CardShell\s+data-testid="card-job-context">([\s\S]*?)<\/CardShell>/,
    );
    expect(cardShellMatch).not.toBeNull();
    // The testId prop on CanonicalDetailHeader is how the testid reaches the DOM
    expect(cardShellMatch![1]).toMatch(/testId="job-detail-header"/);
  });

  it("there is exactly ONE CardShell with `card-job-context` testid", () => {
    const matches = jobDetailSrc.match(/data-testid="card-job-context"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("there is exactly ONE CanonicalDetailHeader with testId='job-detail-header' (no duplicate)", () => {
    const matches = jobDetailSrc.match(/testId="job-detail-header"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ── 3. Title, status, client, address passed as props ───────────────

describe("JobDetailPage — identity props on CanonicalDetailHeader", () => {
  it("renders the job summary H1 with text-page-title typography (in title prop)", () => {
    // The H1 is in the `title={...}` prop expression — still in source.
    expect(jobDetailSrc).toMatch(
      /<h1[^>]*className="[^"]*\btext-page-title\b[^"]*\bfont-semibold\b[^"]*"[^>]*data-testid="job-detail-header-title"/,
    );
  });

  it("renders the editable summary textarea with text-page-title typography (in title prop)", () => {
    expect(jobDetailSrc).toMatch(
      /<textarea[\s\S]*?className="[^"]*\btext-page-title\b[^"]*\bfont-semibold\b[^"]*"[\s\S]*?data-testid="input-job-summary-header"/,
    );
  });

  it("renders StatusPill in the statusBadge prop (header-status-pill testid present)", () => {
    expect(jobDetailSrc).toMatch(
      /<StatusPill[\s\S]*?data-testid="header-status-pill"/,
    );
  });

  it("renders the client/location name link in clientSlot with text-section-title typography", () => {
    expect(jobDetailSrc).toMatch(
      /className="[^"]*\btext-section-title\b[^"]*"[\s\S]*?data-testid="link-client-context"/,
    );
  });

  it("renders AddressBlock with RAW location name in addressSlot (resolveServiceLocationName used)", () => {
    expect(jobDetailSrc).toMatch(
      /<AddressBlock[\s\S]+?variant="job"[\s\S]+?label="Service Address"[\s\S]+?locationName=\{resolveServiceLocationName\(job\.location\?\.location,\s*clientName\)\}/,
    );
  });
});

// ── 4. Meta items passed with correct keys and variants ─────────────

describe("JobDetailPage — meta items passed to CanonicalDetailHeader", () => {
  it("passes key='job-number' with EntityNumber primary variant", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']job-number["']/);
    expect(jobDetailSrc).toMatch(
      /<EntityNumber\s+variant="primary"[\s\S]*?data-testid="header-job-number-pill"/,
    );
    expect(jobDetailSrc).toMatch(/data-testid="input-job-number"/);
  });

  it("passes key='scheduled' with nextVisit?.scheduledStart check", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']scheduled["']/);
    expect(jobDetailSrc).toMatch(/nextVisit\?\.scheduledStart/);
  });

  it("passes key='invoice-number' with EntityNumber linked and missing variants", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']invoice-number["']/);
    expect(jobDetailSrc).toMatch(
      /<EntityNumber\s+variant="linked"[\s\S]*?data-testid="header-invoice-link"/,
    );
    expect(jobDetailSrc).toMatch(/<EntityNumber\s+variant="missing"\s*\/>/);
  });
});

// ── 5. Actions cluster is inside the actions prop ───────────────────

describe("JobDetailPage — action buttons in actions prop", () => {
  it("renders the edit pencil (button-edit-job-card)", () => {
    expect(jobDetailSrc).toMatch(/data-testid="button-edit-job-card"/);
  });

  it("does NOT render the Add Equipment combo button (moved to the Equipment rail tab)", () => {
    expect(jobDetailSrc).not.toMatch(/data-testid="button-add-equipment-header"/);
    expect(jobDetailSrc).toMatch(/data-testid="button-add-equipment-rail"/);
  });

  it("renders the More-actions overflow menu (button-more-actions) in actions prop", () => {
    // The actions prop expression in source contains button-more-actions
    expect(jobDetailSrc).toMatch(/data-testid="button-more-actions"/);
  });

  it("renders all status-driven primary CTAs in actions prop", () => {
    expect(jobDetailSrc).toMatch(/data-testid="button-schedule-visit-action"/);
    expect(jobDetailSrc).toMatch(/data-testid="button-invoice-action"/);
    expect(jobDetailSrc).toMatch(/data-testid="button-restore-job"/);
  });
});

// ── 6. Description + edit footer remain as CardShell siblings ───────

describe("JobDetailPage — description + edit footer remain inside the CardShell", () => {
  it("the description section and edit footer are CardShell children (siblings of CanonicalDetailHeader)", () => {
    const cardShellMatch = jobDetailSrc.match(
      /<CardShell\s+data-testid="card-job-context">([\s\S]*?)<\/CardShell>/,
    );
    expect(cardShellMatch).not.toBeNull();
    const cardShellBody = cardShellMatch![1];
    expect(cardShellBody).toMatch(/data-testid="job-description-section"/);
    expect(cardShellBody).toMatch(/data-testid="job-header-edit-footer"/);
    expect(cardShellBody).toMatch(/data-testid="button-header-save"/);
    expect(cardShellBody).toMatch(/data-testid="button-header-cancel"/);
  });

  it("there is exactly ONE `job-description-section` testid (no duplicate)", () => {
    const matches = jobDetailSrc.match(/data-testid="job-description-section"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
