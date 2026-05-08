/**
 * Invoice Detail right rail — source pin tests (2026-05-08).
 *
 * Verifies InvoiceDetailPage uses the canonical `<DetailRightRail>` primitive
 * with the spec'd 3-tab layout (Visibility / Notes / Payments).
 *
 * What stays the same:
 *   - <InvoiceDetailShell> is preserved (still consumed by /invoices/new
 *     for the draft builder). Only the saved-invoice page swaps it out.
 *   - LineItemsCard / Composition / etc. remain in the LEFT column.
 *
 * These pins fail if a future refactor:
 *   - drops the canonical `<DetailRightRail>` mount on InvoiceDetailPage
 *   - reintroduces `<InvoiceDetailShell rightRail={...}>` on the saved page
 *     (the new draft `/invoices/new` is still allowed to use it)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const INVOICE_DETAIL = resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx");
const invoiceDetailSrc = readFileSync(INVOICE_DETAIL, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const invoiceDetailCodeOnly = stripComments(invoiceDetailSrc);

describe("InvoiceDetailPage — canonical right rail", () => {
  it("imports the DetailRightRail primitive + DetailRailTab type from the canonical module", () => {
    expect(invoiceDetailSrc).toMatch(
      /import\s*\{[\s\S]*?\bDetailRightRail\b[\s\S]*?\btype\s+DetailRailTab\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("mounts <DetailRightRail tabs={invoiceRailTabs} ...> with the 'invoice-side' testid prefix", () => {
    expect(invoiceDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,400}?tabs=\{invoiceRailTabs\}[\s\S]{0,400}?testIdPrefix="invoice-side"/,
    );
  });

  it("carries the aria-label='Invoice information rail'", () => {
    expect(invoiceDetailSrc).toMatch(/ariaLabel="Invoice information rail"/);
  });

  it("the rail aside is a page-level sibling of the left-column shell (mirrors Job Detail)", () => {
    expect(invoiceDetailSrc).toMatch(
      /<div[\s\S]{0,200}?className="flex h-full flex-col lg:flex-row bg-app-bg"[\s\S]{0,200}?data-testid="invoice-detail-page"/,
    );
    expect(invoiceDetailSrc).toMatch(/data-testid="invoice-detail-left-column-shell"/);
    expect(invoiceDetailSrc).toMatch(/data-testid="invoice-detail-rail-column"/);
    expect(invoiceDetailSrc).toMatch(/invoiceRailTab === null \? 80 : 380/);
    expect(invoiceDetailSrc).toMatch(
      /data-panel-open=\{invoiceRailTab === null \? "false" : "true"\}/,
    );
  });

  it("declares page-local `invoiceRailTab` state for active-tab tracking", () => {
    expect(invoiceDetailSrc).toMatch(
      /const\s*\[\s*invoiceRailTab\s*,\s*setInvoiceRailTab\s*\]\s*=\s*useState/,
    );
    expect(invoiceDetailSrc).toMatch(/useState<InvoiceRailTab\s*\|\s*null>\(/);
  });

  it("the default open tab is Visibility", () => {
    expect(invoiceDetailSrc).toMatch(
      /useState<InvoiceRailTab\s*\|\s*null>\(\s*"visibility"\s*\)/,
    );
  });
});

describe("InvoiceDetailPage — invoiceRailTabs registry", () => {
  it("declares an `invoiceRailTabs` array typed `DetailRailTab[]`", () => {
    expect(invoiceDetailSrc).toMatch(
      /const\s+invoiceRailTabs:\s*DetailRailTab\[\]\s*=\s*\[/,
    );
  });

  it("has exactly THREE tabs (Visibility + Notes + Payments)", () => {
    const arrStart = invoiceDetailSrc.indexOf("const invoiceRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = invoiceDetailSrc.indexOf("];", arrStart);
    expect(arrEnd).toBeGreaterThan(arrStart);
    const arrSlice = invoiceDetailSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(3);
    expect(arrSlice).toMatch(/id:\s*"visibility"/);
    expect(arrSlice).toMatch(/id:\s*"notes"/);
    expect(arrSlice).toMatch(/id:\s*"payments"/);
  });

  it("rail tab order is Visibility, Notes, Payments (per spec)", () => {
    const arrStart = invoiceDetailSrc.indexOf("const invoiceRailTabs:");
    const arrEnd = invoiceDetailSrc.indexOf("];", arrStart);
    const arrSlice = invoiceDetailSrc.slice(arrStart, arrEnd);
    const idOrder: string[] = [];
    const re = /\bid:\s*"(\w+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrSlice)) !== null) idOrder.push(m[1]);
    expect(idOrder).toEqual(["visibility", "notes", "payments"]);
  });

  it("Visibility tab carries Eye icon + stable testId", () => {
    expect(invoiceDetailSrc).toMatch(
      /id:\s*"visibility"[\s\S]{0,400}?label:\s*"Visibility"[\s\S]{0,400}?icon:\s*Eye[\s\S]{0,400}?testId:\s*"invoice-rail-tab-visibility"/,
    );
  });

  it("Notes tab carries StickyNote icon + stable testId", () => {
    expect(invoiceDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,400}?label:\s*"Notes"[\s\S]{0,400}?icon:\s*StickyNote[\s\S]{0,400}?testId:\s*"invoice-rail-tab-notes"/,
    );
  });

  it("Payments tab carries Receipt icon + stable testId", () => {
    expect(invoiceDetailSrc).toMatch(
      /id:\s*"payments"[\s\S]{0,400}?label:\s*"Payments"[\s\S]{0,400}?icon:\s*Receipt[\s\S]{0,400}?testId:\s*"invoice-rail-tab-payments"/,
    );
  });

  it("Visibility tab content slot mounts <ClientVisibilityCardV2>", () => {
    expect(invoiceDetailSrc).toMatch(
      /id:\s*"visibility"[\s\S]{0,3000}?<ClientVisibilityCardV2\b/,
    );
  });

  it("Notes tab content slot mounts <EntityNotesPanel entityType=\"invoice\" entityId={invoiceId}>", () => {
    // 2026-05-08 Tier 4 Notes canonicalization: the prior
    // `<EntityNotesSection embedded hideHeader>` mount is replaced by
    // the canonical `<EntityNotesPanel>`. Panel title + +Add live on
    // the rail tab descriptor (label / action) so EntityNotesPanel
    // doesn't carry chrome props.
    expect(invoiceDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,1600}?<EntityNotesPanel[\s\S]{0,400}?entityType="invoice"[\s\S]{0,400}?entityId=\{invoiceId\}/,
    );
  });

  it("Notes tab carries the canonical +Add `action` slot wired to `notesAddSignal`", () => {
    expect(invoiceDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,1600}?action:\s*\([\s\S]{0,400}?data-testid="button-add-note-rail"/,
    );
    expect(invoiceDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,1600}?openAddNoteSignal=\{notesAddSignal\}/,
    );
  });

  it("Payments tab content slot mounts <PaymentHistoryCard>", () => {
    expect(invoiceDetailSrc).toMatch(
      /id:\s*"payments"[\s\S]{0,1200}?<PaymentHistoryCard\b/,
    );
  });
});

describe("InvoiceDetailPage — saved-page layout no longer uses InvoiceDetailShell", () => {
  it("the saved-page render no longer mounts <InvoiceDetailShell ...> as the root layout", () => {
    // <InvoiceDetailShell> may still be referenced in comments / used by
    // /invoices/new; what matters is the saved page no longer mounts it.
    // Pin: no `<InvoiceDetailShell` JSX tag exists in code (comments
    // referencing the old shell are fine).
    expect(invoiceDetailCodeOnly).not.toMatch(/<InvoiceDetailShell\b/);
  });
});

describe("InvoiceDetailPage — closed-rail behavior delegates to the canonical primitive", () => {
  it("`invoiceRailTab` state is typed nullable (`InvoiceRailTab | null`)", () => {
    expect(invoiceDetailSrc).toMatch(/useState<InvoiceRailTab\s*\|\s*null>\(/);
  });

  it("the rail mount feeds `invoiceRailTab` directly to `activeTabId`", () => {
    expect(invoiceDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,400}?activeTabId=\{invoiceRailTab\}/,
    );
  });

  it("`onActiveTabChange` accepts null + writes page state directly", () => {
    expect(invoiceDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,800}?onActiveTabChange=\{\(id\)\s*=>\s*setInvoiceRailTab\(id\s+as\s+InvoiceRailTab\s*\|\s*null\)\}/,
    );
  });

  it("the page mounts the rail twice (mobile + desktop variants) inside the rail aside", () => {
    const idx = invoiceDetailSrc.indexOf('data-testid="invoice-detail-rail-column"');
    expect(idx).toBeGreaterThan(-1);
    const slice = invoiceDetailSrc.slice(idx, idx + 3000);
    const railMounts = slice.match(/<DetailRightRail\b/g) ?? [];
    expect(railMounts.length).toBe(2);
  });
});
