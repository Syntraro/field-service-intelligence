/**
 * Job Detail — canonical detail header source-pin tests.
 *
 * Covers the approved layout direction (2026-05-10):
 *   - No breadcrumb entity label ("Jobs") above the title
 *   - No back-arrow button
 *   - Large job summary/title as H1; status chip beside it
 *   - Right-side actions: Edit (editCapability), More (overflowActions), Schedule Visit (primaryActions)
 *   - Left column: client name + service address + phone/email block
 *   - Right column metadata grid: Job # | Type | Priority | Scheduled | Invoice #
 *   - Job # in the metadata grid — not in the title/top context row
 *   - No assigned-to field in the header
 *   - Missing optional fields (jobType, priority) guarded safely
 *   - CanonicalDetailHeader owns all chrome — no CardShell wrapper
 *   - Exactly one CDH mount; all structural props use typed descriptors
 *
 * Previous versions (2026-05-07 unified card → 2026-05-08 Task 3/4 →
 * 2026-05-09 strip removed, ReactNode escape hatches replaced):
 *   All historical prop names (layout=, statusChip=, onEdit=,
 *   descriptionEditContent=, editFooter=) have been removed from CDH's
 *   public API. Tests below pin the current API only.
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

// ── 1. CanonicalDetailHeader IS imported and used ──────────────────

describe("JobDetailPage — uses CanonicalDetailHeader for card content layout", () => {
  it("imports CanonicalDetailHeader from @/components/detail/CanonicalDetailHeader", () => {
    expect(codeOnly).toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("imports HeaderAction and HeaderOverflowItem types", () => {
    expect(codeOnly).toMatch(/\bHeaderAction\b/);
    expect(codeOnly).toMatch(/\bHeaderOverflowItem\b/);
  });

  it("renders <CanonicalDetailHeader …> (card-only — no layout prop needed)", () => {
    // CDH became card-only on 2026-05-09; layout prop was removed.
    expect(codeOnly).toMatch(/<CanonicalDetailHeader\b/);
    expect(codeOnly).not.toMatch(/layout="strip"/);
  });

  it("passes testId=\"job-detail-header\" to CanonicalDetailHeader", () => {
    expect(codeOnly).toMatch(/testId="job-detail-header"/);
  });
});

// ── 2. CanonicalDetailHeader owns the card chrome — no CardShell wrapper ──

describe("JobDetailPage — CanonicalDetailHeader owns the card chrome", () => {
  it("does NOT use a CardShell to wrap the job header", () => {
    expect(codeOnly).not.toMatch(/<CardShell\s+data-testid="card-job-context"/);
    expect(codeOnly).not.toMatch(/data-testid="card-job-context"/);
  });

  it("CardShell is still imported (used for other cards on the page)", () => {
    expect(codeOnly).toMatch(/\bCardShell\b/);
  });

  it("there is exactly ONE CanonicalDetailHeader with testId='job-detail-header'", () => {
    const matches = jobDetailSrc.match(/testId="job-detail-header"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("there is exactly ONE CanonicalDetailHeader mount", () => {
    const matches = codeOnly.match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ── 3. Approved layout direction — no breadcrumb, no back arrow ────

describe("JobDetailPage — approved layout: no breadcrumb label, no back arrow", () => {
  it("does NOT pass entityLabel prop (no breadcrumb 'Jobs' label above the title)", () => {
    // entityLabel renders a small-caps badge ("LEAD", "QUOTE") above the H1.
    // The job header must not show this — it is a one-off label, not a navigation aid.
    const headerMount = jobDetailSrc.slice(
      jobDetailSrc.indexOf('<CanonicalDetailHeader'),
      jobDetailSrc.indexOf('/>', jobDetailSrc.indexOf('<CanonicalDetailHeader') + 20) + 2,
    );
    // Search from the CDH open tag to the closing />
    const mountEnd = jobDetailSrc.indexOf("/>", jobDetailSrc.lastIndexOf("editControls=")) + 2;
    const mountSrc = jobDetailSrc.slice(
      jobDetailSrc.indexOf("<CanonicalDetailHeader"),
      mountEnd,
    );
    expect(mountSrc).not.toMatch(/\bentityLabel=/);
  });

  it("does NOT pass onBack prop (no back-arrow button in job header)", () => {
    const mountEnd = jobDetailSrc.indexOf("/>", jobDetailSrc.lastIndexOf("editControls=")) + 2;
    const mountSrc = jobDetailSrc.slice(
      jobDetailSrc.indexOf("<CanonicalDetailHeader"),
      mountEnd,
    );
    expect(mountSrc).not.toMatch(/\bonBack=/);
  });
});

// ── 4. Title, status, client, address — structured props ───────────

describe("JobDetailPage — identity props on CanonicalDetailHeader", () => {
  it("passes title as a string expression (job.summary || clientName || 'Job')", () => {
    expect(codeOnly).toMatch(/title=\{job\.summary/);
  });

  it("passes titleEdit descriptor for inline title editing (CDH renders the input internally)", () => {
    // titleEdit is a typed descriptor; CDH renders <input type="text"> internally.
    // The textarea is NOT inlined in the page source — pass only the descriptor.
    expect(codeOnly).toMatch(/titleEdit=\{/);
    expect(codeOnly).toMatch(/editingHeader/); // conditional guard
  });

  it("passes status descriptor with label and tone (CDH renders StatusChip internally)", () => {
    // Current API: status={ label, tone } — NOT statusChip= or statusBadge=.
    expect(codeOnly).toMatch(/status=\{/);
    expect(codeOnly).not.toMatch(/statusChip=\{/);
    expect(codeOnly).not.toMatch(/statusBadge=\{/);
    // StatusDescriptor uses a tone from statusToChipTone
    expect(jobDetailSrc).toMatch(/statusToChipTone\(/);
  });

  it("passes clientName= string prop (not clientSlot= ReactNode)", () => {
    expect(codeOnly).toMatch(/clientName=\{clientName\s*\?\?\s*undefined\}/);
    expect(codeOnly).not.toMatch(/clientSlot=/);
  });

  it("passes clientHref= for the location link", () => {
    expect(codeOnly).toMatch(/clientHref=/);
    expect(jobDetailSrc).toMatch(/\/clients\//);
  });

  it("passes addressLines= array with resolveServiceLocationName (not addressSlot= or AddressBlock)", () => {
    expect(codeOnly).toMatch(/addressLines=/);
    expect(jobDetailSrc).toMatch(/resolveServiceLocationName/);
    expect(codeOnly).not.toMatch(/addressSlot=/);
    expect(codeOnly).not.toMatch(/<AddressBlock/);
  });

  it("passes addressLabel=\"Service Address\"", () => {
    expect(codeOnly).toMatch(/addressLabel="Service Address"/);
  });
});

// ── 5. Metadata grid — correct items, no Job # above the title ─────

describe("JobDetailPage — metadata grid items (right column)", () => {
  it("Job # is in the items grid with key='job-number', NOT above the title", () => {
    // key='job-number' confirms placement inside the items[] array.
    expect(jobDetailSrc).toMatch(/key:\s*["']job-number["']/);
    // title prop is a string expression — it must not contain jobNumber concatenation.
    const titleProp = jobDetailSrc.match(/title=\{([^}]+)\}/)?.[1] ?? "";
    expect(titleProp).not.toMatch(/jobNumber/);
  });

  it("Job # renders as EntityNumber variant='primary' pill", () => {
    expect(jobDetailSrc).toMatch(
      /<EntityNumber\s+variant="primary"[\s\S]*?data-testid="header-job-number-pill"/,
    );
  });

  it("Job # has an editNode for numeric input in edit mode", () => {
    expect(jobDetailSrc).toMatch(/data-testid="input-job-number"/);
  });

  it("key='job-type' item present in items grid", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']job-type["']/);
  });

  it("job-type value capitalizes the raw enum string (no raw 'maintenance' or 'repair' exposed)", () => {
    // The display formatter must capitalize; raw enum values must not be passed as-is.
    const itemsIdx = jobDetailSrc.indexOf('key: "job-type"');
    const itemsSlice = jobDetailSrc.slice(itemsIdx, itemsIdx + 300);
    expect(itemsSlice).toMatch(/toUpperCase\(\)/);
  });

  it("key='priority' item present in items grid", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']priority["']/);
  });

  it("priority value capitalizes the raw enum string", () => {
    const itemsIdx = jobDetailSrc.indexOf('key: "priority"');
    const itemsSlice = jobDetailSrc.slice(itemsIdx, itemsIdx + 350);
    expect(itemsSlice).toMatch(/toUpperCase\(\)/);
  });

  it("key='scheduled' still present with nextVisit?.scheduledStart guard", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']scheduled["']/);
    expect(jobDetailSrc).toMatch(/nextVisit\?\.scheduledStart/);
  });

  it("key='invoice-number' still present with EntityNumber linked and missing variants", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']invoice-number["']/);
    expect(jobDetailSrc).toMatch(
      /<EntityNumber\s+variant="linked"[\s\S]*?data-testid="header-invoice-link"/,
    );
    expect(jobDetailSrc).toMatch(/<EntityNumber\s+variant="missing"\s*\/>/);
  });

  it("items array contains FIVE items (Job # + Type + Priority + Scheduled + Invoice #)", () => {
    const mountStart = jobDetailSrc.indexOf('<CanonicalDetailHeader');
    const mountEnd = jobDetailSrc.indexOf("/>", jobDetailSrc.lastIndexOf("editControls=")) + 2;
    const mountSrc = jobDetailSrc.slice(mountStart, mountEnd);
    const keyMatches = mountSrc.match(/\bkey:\s*["'][^"']+["']/g) ?? [];
    expect(keyMatches.length).toBe(5);
  });
});

// ── 6. No assigned-to field in the header ─────────────────────────

describe("JobDetailPage — no assigned-to field in header", () => {
  it("items grid does not include an assigned-to or technician assignment item", () => {
    const mountStart = jobDetailSrc.indexOf('<CanonicalDetailHeader');
    const mountEnd = jobDetailSrc.indexOf("/>", jobDetailSrc.lastIndexOf("editControls=")) + 2;
    const mountSrc = jobDetailSrc.slice(mountStart, mountEnd);
    // No assigned/technician key in the items array
    expect(mountSrc).not.toMatch(/key:\s*["']assigned/i);
    expect(mountSrc).not.toMatch(/key:\s*["']technician/i);
    expect(mountSrc).not.toMatch(/label:\s*["']Assigned/);
    expect(mountSrc).not.toMatch(/label:\s*["']Technician/);
  });
});

// ── 7. Actions via structured props ───────────────────────────────

describe("JobDetailPage — action buttons via structured props", () => {
  it("uses editCapability={{ enabled, onStartEdit }} for the pencil button", () => {
    // 2026-05-09: onEdit= prop was renamed to editCapability= descriptor.
    expect(codeOnly).toMatch(/editCapability=\{/);
    expect(jobDetailSrc).toMatch(/onStartEdit:\s*enterHeaderEdit/);
    expect(codeOnly).not.toMatch(/data-testid="button-edit-job-card"/);
  });

  it("passes primaryActions={[…]} typed array (not actions={<>…</>} ReactNode slot)", () => {
    expect(codeOnly).toMatch(/primaryActions=\{/);
    expect(codeOnly).not.toMatch(/actions=\{<>/);
  });

  it("passes overflowActions={[…]} typed array", () => {
    expect(codeOnly).toMatch(/overflowActions=\{/);
    expect(codeOnly).not.toMatch(/data-testid="button-more-actions"/);
  });

  it("does NOT render Add Equipment button in the header (moved to Equipment rail tab)", () => {
    expect(jobDetailSrc).not.toMatch(/data-testid="button-add-equipment-header"/);
    expect(jobDetailSrc).toMatch(/data-testid="button-add-equipment-rail"/);
  });

  it("Schedule Visit is a primaryAction with testId 'button-schedule-visit-action'", () => {
    expect(jobDetailSrc).toMatch(/testId:\s*["']button-schedule-visit-action["']/);
  });

  it("Invoice and Restore Job are status-gated primaryActions", () => {
    expect(jobDetailSrc).toMatch(/testId:\s*["']button-invoice-action["']/);
    expect(jobDetailSrc).toMatch(/testId:\s*["']button-restore-job["']/);
  });

  it("overflow items use testId: (not data-testid=) in the overflowActions array", () => {
    expect(jobDetailSrc).toMatch(/testId:\s*["']menu-complete-job["']/);
    expect(jobDetailSrc).toMatch(/testId:\s*["']menu-delete-job["']/);
  });
});

// ── 8. Description + edit controls are CDH typed props ─────────────

describe("JobDetailPage — description + editControls as CDH typed props", () => {
  it("passes description={job.description ?? null} as a string prop", () => {
    expect(codeOnly).toMatch(/description=\{job\.description\s*\?\?\s*null\}/);
  });

  it("passes descriptionEdit descriptor for edit mode (CDH renders textarea internally)", () => {
    // 2026-05-09: descriptionEditContent= ReactNode slot replaced with descriptionEdit= descriptor.
    // CDH renders the textarea internally using testId from the descriptor.
    expect(codeOnly).toMatch(/descriptionEdit=\{/);
    expect(codeOnly).not.toMatch(/descriptionEditContent=\{/);
    expect(jobDetailSrc).toMatch(/testId:\s*["']textarea-job-description["']/);
  });

  it("does NOT render a job-description-section testid (CDH generates job-detail-header-description)", () => {
    expect(codeOnly).not.toMatch(/data-testid="job-description-section"/);
  });

  it("passes editControls descriptor for save/cancel footer (CDH owns border-t chrome)", () => {
    // 2026-05-09: editFooter= ReactNode slot replaced with editControls= typed descriptor.
    // saveTestId/cancelTestId are descriptor properties; CDH applies them as data-testid internally.
    expect(codeOnly).toMatch(/editControls=\{/);
    expect(codeOnly).not.toMatch(/editFooter=\{/);
    expect(jobDetailSrc).toMatch(/saveTestId:\s*["']button-header-save["']/);
    expect(jobDetailSrc).toMatch(/cancelTestId:\s*["']button-header-cancel["']/);
  });
});

// ── 9. CDH layout structure — two-section header (2026-05-10) ──────

const CDH_SRC = (() => {
  const { readFileSync } = require("fs");
  const { resolve } = require("path");
  return readFileSync(resolve(__dirname, "../client/src/components/detail/CanonicalDetailHeader.tsx"), "utf-8");
})();

describe("CanonicalDetailHeader — approved two-section layout", () => {
  it("identity section splits into TOP ROW (title+actions) and BODY ROW (client+metadata)", () => {
    expect(CDH_SRC).toMatch(/TOP ROW/);
    expect(CDH_SRC).toMatch(/BODY ROW/);
  });

  it("client block rendered in a data-testid=\"{testId}-client-block\" container", () => {
    expect(CDH_SRC).toMatch(/data-testid=\{`\$\{testId\}-client-block`\}/);
  });

  it("client block has fixed ~40% width (w-2/5) so metadata is not crushed right", () => {
    expect(CDH_SRC).toMatch(/w-2\/5 shrink-0/);
  });

  it("metadata grid container uses flex-1 to take remaining width (not shrink-0)", () => {
    const itemsIdx = CDH_SRC.indexOf('data-testid={`${testId}-items`}');
    // flex-1 must appear near (before) the data-testid
    const slice = CDH_SRC.slice(Math.max(0, itemsIdx - 300), itemsIdx + 20);
    expect(slice).toMatch(/flex-1 min-w-0 grid/);
    expect(slice).not.toMatch(/shrink-0 grid/);
  });

  it("metadata grid supports itemsColumns prop — grid-cols-3 class applied when prop is 3", () => {
    expect(CDH_SRC).toMatch(/itemsColumns === 3.*grid-cols-3/s);
  });

  it("metadata grid items use items-start alignment (left-aligned labels)", () => {
    expect(CDH_SRC).toMatch(/flex flex-col items-start min-w-0/);
  });

  it("body row has border-t border-card-border separator from top row", () => {
    const bodyIdx = CDH_SRC.indexOf("BODY ROW");
    const bodySlice = CDH_SRC.slice(bodyIdx, bodyIdx + 400);
    expect(bodySlice).toMatch(/border-t border-card-border/);
  });

  it("metadata grid has border-l border-card-border separator when client block is present", () => {
    expect(CDH_SRC).toMatch(/border-l border-card-border pl-6/);
  });

  it("workflow renders in top-right area alongside actions (not below metadata grid)", () => {
    const rightDivIdx = CDH_SRC.indexOf('data-testid={`${testId}-right`}');
    const bodyRowIdx = CDH_SRC.indexOf("BODY ROW");
    expect(rightDivIdx).toBeGreaterThan(-1);
    expect(rightDivIdx).toBeLessThan(bodyRowIdx);
  });
});

describe("JobDetailPage — Schedule Visit action style", () => {
  it("Schedule Visit primaryAction carries variant: \"primary\" (renders as green button)", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*["']schedule-visit["'][\s\S]{0,200}?variant:\s*["']primary["']/,
    );
  });

  it("passes itemsColumns={3} to CanonicalDetailHeader (3-column metadata grid on desktop)", () => {
    expect(jobDetailSrc).toMatch(/itemsColumns=\{3\}/);
  });
});
