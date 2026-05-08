/**
 * Pipeline card redesign + actionable pipeline modes (2026-05-06 RALPH).
 *
 * Locks the contract that:
 *   • The Pipeline card retired its 4-up KPI grid (Leads / Quotes sent /
 *     Conversion / Follow-up Due) and the bottom stale-leads row in
 *     favor of four actionable rows that each open the SHARED
 *     <DashboardActionModal>.
 *   • Each row routes through the existing `openActionModal(mode)`
 *     handler — same modal the Operational Alerts and Needs Attention
 *     rows use. No new modal component is introduced.
 *   • The four new modes (`pipeline_leads_followup`,
 *     `pipeline_quotes_not_sent`, `pipeline_quotes_awaiting_response`,
 *     `pipeline_stale_opportunities`) are wired in `MODE_CONFIG` with
 *     the right title + source list.
 *   • Each modal source hits the canonical /api/leads or /api/quotes
 *     list endpoint with the bucket / status filters their route layers
 *     accept. No new dashboard endpoint, no parallel aggregation.
 *   • Closed / lost / converted records are excluded by the underlying
 *     SQL — both at the dashboard count level and at the modal feed
 *     level.
 *   • Needs Attention and Operational Alerts contracts are unchanged
 *     by this refactor.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(__dirname, "..");
const MODAL_PATH = resolve(ROOT, "client/src/components/DashboardActionModal.tsx");
const DASHBOARD_PATH = resolve(ROOT, "client/src/pages/FinancialDashboard.tsx");
const STORAGE_PATH = resolve(ROOT, "server/storage/dashboard.ts");
const LEADS_ROUTE_PATH = resolve(ROOT, "server/routes/leads.ts");
const QUOTES_ROUTE_PATH = resolve(ROOT, "server/routes/quotes.ts");
const LEADS_STORAGE_PATH = resolve(ROOT, "server/storage/leads.ts");
const QUOTES_STORAGE_PATH = resolve(ROOT, "server/storage/quotes.ts");
const ALERTS_CARD_PATH = resolve(ROOT, "client/src/components/dashboard/OperationalAlertsCard.tsx");

const modalSrc = readFileSync(MODAL_PATH, "utf-8");
const dashSrc = readFileSync(DASHBOARD_PATH, "utf-8");
const storeSrc = readFileSync(STORAGE_PATH, "utf-8");
const leadsRouteSrc = readFileSync(LEADS_ROUTE_PATH, "utf-8");
const quotesRouteSrc = readFileSync(QUOTES_ROUTE_PATH, "utf-8");
const leadsStorageSrc = readFileSync(LEADS_STORAGE_PATH, "utf-8");
const quotesStorageSrc = readFileSync(QUOTES_STORAGE_PATH, "utf-8");
const alertsSrc = readFileSync(ALERTS_CARD_PATH, "utf-8");

// ─── Pipeline card redesign ─────────────────────────────────────────

describe("PipelineSnapshotCard — actionable rows replace KPI grid", () => {
  it("removes the four legacy KPI labels", () => {
    const cardBlock = dashSrc.match(/function PipelineSnapshotCard\([\s\S]+?\nfunction\s/);
    expect(cardBlock).toBeTruthy();
    const block = cardBlock![0];
    // The brief calls out three labels by name: Leads / Quotes sent /
    // Conversion. The legacy "Follow-up Due" cell is also gone.
    expect(block).not.toMatch(/label="Leads"/);
    expect(block).not.toMatch(/label="Quotes sent"/);
    expect(block).not.toMatch(/label="Conversion"/);
    expect(block).not.toMatch(/label="Follow-up Due"/);
    // The PipelineKpiCell helper itself was deleted.
    expect(dashSrc).not.toMatch(/function PipelineKpiCell\(/);
  });

  it("renders four actionable rows, in declared order", () => {
    const cardBlock = dashSrc.match(/function PipelineSnapshotCard\([\s\S]+?\nfunction\s/);
    expect(cardBlock).toBeTruthy();
    const block = cardBlock![0];
    // Each row carries a stable key + label + mode binding.
    const keys = ["leads-followup", "quotes-not-sent", "quotes-awaiting-response", "stale-opportunities"];
    for (const k of keys) {
      expect(block).toMatch(new RegExp(`key:\\s*"${k}"`));
    }
    // Row labels render the user-facing copy.
    expect(block).toMatch(/Leads needing follow-up/);
    expect(block).toMatch(/Quotes not sent/);
    expect(block).toMatch(/Quotes awaiting response/);
    expect(block).toMatch(/Stale opportunities/);
  });

  it("each row binds to the matching DashboardActionMode", () => {
    const cardBlock = dashSrc.match(/function PipelineSnapshotCard\([\s\S]+?\nfunction\s/);
    expect(cardBlock).toBeTruthy();
    const block = cardBlock![0];
    expect(block).toMatch(/mode:\s*"pipeline_leads_followup"\s+as\s+const/);
    expect(block).toMatch(/mode:\s*"pipeline_quotes_not_sent"\s+as\s+const/);
    expect(block).toMatch(/mode:\s*"pipeline_quotes_awaiting_response"\s+as\s+const/);
    expect(block).toMatch(/mode:\s*"pipeline_stale_opportunities"\s+as\s+const/);
  });

  it("each row's click handler calls onOpenActionModal with the row's mode", () => {
    const cardBlock = dashSrc.match(/function PipelineSnapshotCard\([\s\S]+?\nfunction\s/);
    expect(cardBlock).toBeTruthy();
    expect(cardBlock![0]).toMatch(/onView=\{\(\)\s*=>\s*onOpenActionModal\(r\.mode\)\}/);
  });

  it("does not render any per-row View buttons in the card body", () => {
    const cardBlock = dashSrc.match(/function PipelineSnapshotCard\([\s\S]+?\nfunction\s/);
    expect(cardBlock).toBeTruthy();
    const block = cardBlock![0];
    // No literal "View" button label and no `*-view` testid suffix —
    // the row itself is the click target now.
    expect(block).not.toMatch(/>\s*View\s*</);
    expect(block).not.toMatch(/-view"/);
  });

  it("renders the empty-state copy when no rows are actionable", () => {
    expect(dashSrc).toMatch(/No pipeline actions need attention\./);
    expect(dashSrc).toMatch(/data-testid="pipeline-empty"/);
  });

  it("counts/values come from the new actionable bucket fields, not the legacy ones", () => {
    const cardBlock = dashSrc.match(/function PipelineSnapshotCard\([\s\S]+?\nfunction\s/);
    expect(cardBlock).toBeTruthy();
    const block = cardBlock![0];
    expect(block).toMatch(/leadsFollowUpCount/);
    expect(block).toMatch(/quotesNotSentCount/);
    expect(block).toMatch(/quotesAwaitingResponseCount/);
    expect(block).toMatch(/staleOpportunitiesCount/);
    // Legacy fields no longer drive the card body.
    expect(block).not.toMatch(/p\?\.leadsCount/);
    expect(block).not.toMatch(/p\?\.quotesSentCount/);
    expect(block).not.toMatch(/p\?\.staleLeadsCount/);
    expect(block).not.toMatch(/conversionRateMonth/);
  });

  it("typography avoids text-[10px] / text-[11px] inside the card", () => {
    const cardBlock = dashSrc.match(/function PipelineSnapshotCard\([\s\S]+?\nfunction\s/);
    expect(cardBlock).toBeTruthy();
    // Strip comments first — doc commentary legitimately mentions the
    // prior `text-[10px]` / `text-[11px]` classes for context.
    const codeOnly = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(codeOnly(cardBlock![0])).not.toMatch(/text-\[10px\]/);
    expect(codeOnly(cardBlock![0])).not.toMatch(/text-\[11px\]/);
    // PipelineActionRow uses dashboard tokens — text-sm / text-xs.
    // The naive `^}/m` regex stops at the destructured-params close
    // brace, so anchor on the next top-level `function` declaration.
    const rowStart = dashSrc.indexOf("function PipelineActionRow(");
    expect(rowStart).toBeGreaterThan(-1);
    const rowRest = dashSrc.slice(rowStart + 1);
    const nextFnIdx = rowRest.search(/\nfunction\s+\w+\s*\(/);
    const rowBlock = dashSrc.slice(
      rowStart,
      rowStart + 1 + (nextFnIdx > 0 ? nextFnIdx : rowRest.length),
    );
    expect(codeOnly(rowBlock)).not.toMatch(/text-\[10px\]/);
    expect(codeOnly(rowBlock)).not.toMatch(/text-\[11px\]/);
    expect(rowBlock).toMatch(/text-sm/);
    expect(rowBlock).toMatch(/text-xs/);
  });

  it("mounts <PipelineSnapshotCard> with onOpenActionModal threaded through", () => {
    expect(dashSrc).toMatch(
      /<PipelineSnapshotCard\b[\s\S]+?onOpenActionModal=\{openActionModal\}/,
    );
    // The legacy onViewAll / onViewLeads / onViewQuotes props are gone.
    expect(dashSrc).not.toMatch(/onViewLeads=\{[^}]+\}/);
    expect(dashSrc).not.toMatch(/onViewQuotes=\{[^}]+\}/);
  });
});

// ─── PipelineActionRow compact layout (2026-05-06 RALPH polish) ─────

describe("PipelineActionRow — compact single-line row", () => {
  function rowBlockSrc(): string {
    const rowStart = dashSrc.indexOf("function PipelineActionRow(");
    expect(rowStart).toBeGreaterThan(-1);
    const rest = dashSrc.slice(rowStart + 1);
    const nextFnIdx = rest.search(/\nfunction\s+\w+\s*\(/);
    return dashSrc.slice(
      rowStart,
      rowStart + 1 + (nextFnIdx > 0 ? nextFnIdx : rest.length),
    );
  }

  it("the row element is a <button> bound to onView (whole-row click)", () => {
    const rowBlock = rowBlockSrc();
    expect(rowBlock).toMatch(/<button\b/);
    expect(rowBlock).toMatch(/onClick=\{onView\}/);
    // Empty bucket → button is disabled. Native <button> + `disabled`
    // gives us tabIndex / Enter / Space + a free muted state without
    // hand-rolling role/tabIndex/keydown.
    expect(rowBlock).toMatch(/disabled=\{!hasItems\}/);
  });

  it("renders no inner View button or `-view` testid", () => {
    const rowBlock = rowBlockSrc();
    expect(rowBlock).not.toMatch(/>\s*View\s*</);
    expect(rowBlock).not.toMatch(/-view"/);
  });

  it("count renders to the right of the label", () => {
    const rowBlock = rowBlockSrc();
    const labelIdx = rowBlock.indexOf("{label}");
    const countIdx = rowBlock.indexOf("{count}");
    expect(labelIdx).toBeGreaterThan(-1);
    expect(countIdx).toBeGreaterThan(-1);
    expect(labelIdx).toBeLessThan(countIdx);
    // Count carries the Operational-Alerts numeric style.
    expect(rowBlock).toMatch(/text-sm font-semibold tabular-nums/);
    // Label is the flex-1 element pushing the count to the right edge.
    expect(rowBlock).toMatch(/flex-1 text-xs font-medium truncate/);
  });

  it("density matches Operational Alerts (px-3 py-1.5 gap-2, single-line)", () => {
    const rowBlock = rowBlockSrc();
    expect(rowBlock).toMatch(/px-3 py-1\.5/);
    expect(rowBlock).toMatch(/gap-2/);
    // Two-line affordances from the previous shape are gone.
    expect(rowBlock).not.toMatch(/flex-wrap/);
    expect(rowBlock).not.toMatch(/items-baseline/);
    // No currency rendering inside the row — value is intentionally
    // omitted from the compact card per the brief.
    expect(rowBlock).not.toMatch(/formatCurrency/);
  });

  it("hover + focus styling is visible on active rows", () => {
    const rowBlock = rowBlockSrc();
    expect(rowBlock).toMatch(/hover:bg-\[#F0F5F0\]/);
    expect(rowBlock).toMatch(/focus-visible:/);
  });

  it("zero-count rows mute but still render label + count", () => {
    const rowBlock = rowBlockSrc();
    expect(rowBlock).toMatch(/hasItems\s*\?\s*"text-slate-700"\s*:\s*"text-slate-400"/);
    expect(rowBlock).toMatch(/hasItems\s*\?\s*"text-\[#111827\]"\s*:\s*"text-slate-400"/);
  });
});

// ─── Mode union + MODE_CONFIG ───────────────────────────────────────

describe("DashboardActionMode — Pipeline modes added to the union", () => {
  it("declares the four pipeline modes alongside the existing ones", () => {
    const block = modalSrc.match(/export type DashboardActionMode\s*=\s*([\s\S]+?);/);
    expect(block).toBeTruthy();
    const text = block![1];
    expect(text).toMatch(/"pipeline_leads_followup"/);
    expect(text).toMatch(/"pipeline_quotes_not_sent"/);
    expect(text).toMatch(/"pipeline_quotes_awaiting_response"/);
    expect(text).toMatch(/"pipeline_stale_opportunities"/);
    // Existing modes survive — sanity pin so we don't regress others.
    expect(text).toMatch(/"requires_attention"/);
    expect(text).toMatch(/"invoices_not_sent"/);
  });
});

describe("MODE_CONFIG — pipeline modes route to canonical sources", () => {
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  }
  function modeBlock(mode: string): string {
    const m = modalSrc.match(new RegExp(`${mode}:\\s*\\{[\\s\\S]+?\\},`, "m"));
    expect(m, `MODE_CONFIG.${mode} must exist`).toBeTruthy();
    return stripComments(m![0]);
  }

  it("pipeline_leads_followup uses the leads_followup source", () => {
    const block = modeBlock("pipeline_leads_followup");
    expect(block).toMatch(/title:\s*"Leads Needing Follow-Up"/);
    expect(block).toMatch(/sources:\s*\["leads_followup"\]/);
  });

  it("pipeline_quotes_not_sent uses the quotes_draft source", () => {
    const block = modeBlock("pipeline_quotes_not_sent");
    expect(block).toMatch(/title:\s*"Quotes Not Sent"/);
    expect(block).toMatch(/sources:\s*\["quotes_draft"\]/);
  });

  it("pipeline_quotes_awaiting_response uses the quotes_sent_open source", () => {
    const block = modeBlock("pipeline_quotes_awaiting_response");
    expect(block).toMatch(/title:\s*"Quotes Awaiting Response"/);
    expect(block).toMatch(/sources:\s*\["quotes_sent_open"\]/);
  });

  it("pipeline_stale_opportunities composes [stale_leads, stale_quotes]", () => {
    const block = modeBlock("pipeline_stale_opportunities");
    expect(block).toMatch(/title:\s*"Stale Opportunities"/);
    expect(block).toMatch(/sources:\s*\["stale_leads",\s*"stale_quotes"\]/);
  });

  it("source URL params point at the canonical list endpoints", () => {
    expect(modalSrc).toMatch(/leads_followup:\s*"bucket=followup"/);
    expect(modalSrc).toMatch(/quotes_draft:\s*"status=draft&limit=50"/);
    expect(modalSrc).toMatch(/quotes_sent_open:\s*"status=sent&limit=50"/);
    expect(modalSrc).toMatch(/stale_leads:\s*"bucket=stale&staleDays=14"/);
    expect(modalSrc).toMatch(/stale_quotes:\s*"bucket=stale&staleDays=14&limit=50"/);
    // sourceUrl routes lead sources to /api/leads and quote sources to
    // /api/quotes/list — no parallel dashboard endpoint added.
    expect(modalSrc).toMatch(/`\/api\/leads\?\$\{SOURCE_PARAMS\[source\]\}`/);
    expect(modalSrc).toMatch(/`\/api\/quotes\/list\?\$\{SOURCE_PARAMS\[source\]\}`/);
  });
});

// ─── Modal renders the right rows + actions ─────────────────────────

describe("DashboardActionModal — Pipeline lead / quote row rendering", () => {
  it("lead row carries title, status, value, last-activity date + Open Lead action", () => {
    const rowBlock = modalSrc.match(/function renderLeadRow\([\s\S]+?^\s{2}\}/m);
    expect(rowBlock).toBeTruthy();
    const block = rowBlock![0];
    expect(block).toMatch(/lead\.title/);
    expect(block).toMatch(/formatLeadStatusLabel/);
    expect(block).toMatch(/lead\.estimatedValue/);
    expect(block).toMatch(/lead\.updatedAt\s*\?\?\s*lead\.createdAt/);
    expect(block).toMatch(/Open Lead/);
    expect(block).toMatch(/setLocation\(`\/leads\/\$\{lead\.id\}`\)/);
  });

  it("quote row carries quote#, customer, amount, status, date + Open Quote action", () => {
    const rowBlock = modalSrc.match(/function renderQuoteRow\([\s\S]+?^\s{2}\}/m);
    expect(rowBlock).toBeTruthy();
    const block = rowBlock![0];
    expect(block).toMatch(/quote\.quoteNumber/);
    expect(block).toMatch(/quote\.customerCompany/);
    expect(block).toMatch(/quote\.total/);
    expect(block).toMatch(/quote\.status/);
    expect(block).toMatch(/Open Quote/);
    expect(block).toMatch(/setLocation\(`\/quotes\/\$\{quote\.id\}`\)/);
  });

  it("draft quotes get a Send Quote action that mounts <SendCommunicationModal>", () => {
    const rowBlock = modalSrc.match(/function renderQuoteRow\([\s\S]+?^\s{2}\}/m);
    expect(rowBlock).toBeTruthy();
    expect(rowBlock![0]).toMatch(/setSendQuoteId\(quote\.id\)/);
    expect(rowBlock![0]).toMatch(/Send Quote/);
    // Send-quote sub-modal is rendered as a sibling under the
    // OperationalActionModal — same canonical send shell.
    expect(modalSrc).toMatch(
      /<SendCommunicationModal\b[\s\S]+?entityType="quote"/,
    );
    expect(modalSrc).toMatch(/entityId=\{sendQuoteId\}/);
  });

  it("does NOT show Send Quote on awaiting-response or stale rows", () => {
    const rowBlock = modalSrc.match(/function renderQuoteRow\([\s\S]+?^\s{2}\}/m);
    expect(rowBlock).toBeTruthy();
    // Send button is gated on `isDraft` — defined as source === "quotes_draft".
    expect(rowBlock![0]).toMatch(/const isDraft = source === "quotes_draft"/);
    expect(rowBlock![0]).toMatch(/\{isDraft && \(/);
  });

  it("modal empty-state copy matches the brief for each pipeline mode", () => {
    expect(modalSrc).toMatch(/No leads waiting on follow-up\./);
    expect(modalSrc).toMatch(/No draft quotes to send\./);
    expect(modalSrc).toMatch(/No quotes awaiting customer response\./);
    expect(modalSrc).toMatch(/No stale leads or quotes\./);
  });

  it("stale_opportunities renders both lead AND quote sections with section headers", () => {
    // Section headers are gated on `config.sources.length > 1` — true
    // only for stale_opportunities (composes stale_leads + stale_quotes).
    expect(modalSrc).toMatch(/SOURCE_SECTION_LABEL\.unsent_invoices/);
    expect(modalSrc).toMatch(/stale_leads:\s*"Stale Leads"/);
    expect(modalSrc).toMatch(/stale_quotes:\s*"Stale Quotes"/);
  });
});

// ─── Backend: canonical aggregate + endpoint passthrough ───────────

describe("Backend — actionable buckets extend getPipelineSnapshot (no new endpoint)", () => {
  it("FinancialSummary.pipelineSnapshot declares the four actionable bucket fields", () => {
    expect(storeSrc).toMatch(/leadsFollowUpCount:\s*number/);
    expect(storeSrc).toMatch(/leadsFollowUpValue:\s*number/);
    expect(storeSrc).toMatch(/quotesNotSentCount:\s*number/);
    expect(storeSrc).toMatch(/quotesAwaitingResponseCount:\s*number/);
    expect(storeSrc).toMatch(/staleOpportunitiesCount:\s*number/);
    expect(storeSrc).toMatch(/staleOpportunitiesValue:\s*number/);
  });

  it("getPipelineSnapshot SQL excludes lost / quoted / won / converted by definition", () => {
    const fnBlock = storeSrc.match(/async function getPipelineSnapshot[\s\S]+?^\}/m);
    expect(fnBlock).toBeTruthy();
    const sql = fnBlock![0];
    // leads_followup CTE — only early-pipeline statuses survive.
    expect(sql).toMatch(/leads_followup AS \([\s\S]+?status IN \('new', 'contacted', 'needs_review'\)/);
    // quotes_not_sent CTE — draft only.
    expect(sql).toMatch(/quotes_not_sent AS \([\s\S]+?status = 'draft'/);
    // quotes_awaiting CTE — sent only.
    expect(sql).toMatch(/quotes_awaiting AS \([\s\S]+?status = 'sent'/);
    // stale_opps CTE — open quotes are draft/sent only; lost/quoted/won
    // for leads excluded by status set.
    expect(sql).toMatch(/stale_opps AS \([\s\S]+?status IN \('new', 'contacted', 'needs_review'\)/);
    expect(sql).toMatch(/stale_opps AS \([\s\S]+?status IN \('draft', 'sent'\)/);
    // Stale threshold is 14 days (matches the dashboard brief default).
    expect(sql).toMatch(/INTERVAL '14 days'/);
  });

  it("no NEW HTTP route added — extends existing endpoints with bucket passthroughs", () => {
    const dashRoutesSrc = readFileSync(resolve(ROOT, "server/routes/dashboard.ts"), "utf-8");
    const routes = dashRoutesSrc.match(/router\.(get|post)\("[^"]+"/g) ?? [];
    const expected = new Set([
      `router.get("/financial"`,
      `router.get("/workflow"`,
      `router.get("/capacity"`,
      `router.get("/needs-attention"`,
      `router.get("/pm-due-instances"`,
      `router.get("/today-summary"`,
    ]);
    for (const r of routes) {
      expect(expected, `unexpected new dashboard route: ${r}`).toContain(r);
    }
  });

  it("/api/leads accepts bucket=followup|stale + staleDays passthrough", () => {
    expect(leadsRouteSrc).toMatch(/req\.query\.bucket/);
    expect(leadsRouteSrc).toMatch(/bucket === "followup" \|\| bucket === "stale"/);
    expect(leadsRouteSrc).toMatch(/leadRepository\.listPipelineBucket\(companyId, bucket, staleDays\)/);
  });

  it("/api/quotes/list accepts bucket=stale + staleDays passthrough", () => {
    expect(quotesRouteSrc).toMatch(/req\.query\.bucket/);
    expect(quotesRouteSrc).toMatch(/bucket === "stale"/);
    expect(quotesRouteSrc).toMatch(/quoteRepository\.getStalePipelineQuotes/);
  });

  it("listPipelineBucket repo method excludes closed/lost/converted leads by definition", () => {
    expect(leadsStorageSrc).toMatch(/async listPipelineBucket\(/);
    // Only the open early-pipeline statuses can match.
    expect(leadsStorageSrc).toMatch(/openStatuses\s*=\s*\["new",\s*"contacted",\s*"needs_review"\]/);
    // isActive guard preserves soft-delete behavior.
    expect(leadsStorageSrc).toMatch(/eq\(leads\.isActive,\s*true\)/);
  });

  it("getStalePipelineQuotes excludes approved/declined/converted quotes by definition", () => {
    expect(quotesStorageSrc).toMatch(/async getStalePipelineQuotes\(/);
    expect(quotesStorageSrc).toMatch(/status} IN \('draft', 'sent'\)/);
    // 14-day default threshold + COALESCE(updated_at, created_at) anchor.
    expect(quotesStorageSrc).toMatch(/staleDays:\s*number\s*=\s*14/);
    expect(quotesStorageSrc).toMatch(/COALESCE\(\$\{quotes\.updatedAt\},\s*\$\{quotes\.createdAt\}\)/);
  });
});

// ─── /api/quotes/list lenient pagination (Pipeline modal feed normalization) ──

describe("/api/quotes/list — lenient pagination (Pipeline modal feed normalization)", () => {
  it("uses parsePaginationLenient so dashboard modal feeds without offset/cursor succeed", () => {
    // Mirrors the /api/invoices/list fix shipped earlier today. The
    // dashboard <DashboardActionModal> Pipeline sources hit
    // /api/quotes/list with `?status=...&limit=50` (or
    // `?bucket=stale&staleDays=14&limit=50`) — no offset, no cursor.
    // Strict parsePagination returns 400 on that shape; lenient parsing
    // defaults offset=0 so the route reaches `quoteRepository.getQuotes`
    // / `getStalePipelineQuotes`.
    expect(quotesRouteSrc).toMatch(
      /import\s*\{[^}]*parsePaginationLenient[^}]*\}\s*from\s*"\.\.\/utils\/pagination"/,
    );
    // Anchor the /list block from its declaration up to (but not
    // including) the next `router.<verb>` declaration. The naive
    // `[\s\S]+?\}\)\);` regex stops at the first `}));`, which here is
    // the inner `res.json(paginated(...))` — that cuts off before the
    // bucket-stale branch and the trailing `quoteRepository.getQuotes`
    // call. Anchoring on the next route is unambiguous.
    const listBlockMatch = quotesRouteSrc.match(
      /router\.get\("\/list",[\s\S]+?(?=\nrouter\.\w)/,
    );
    expect(listBlockMatch, "/list route handler must exist").toBeTruthy();
    const listBlock = listBlockMatch![0];
    expect(listBlock).toMatch(/parsePaginationLenient\(req\.query\)/);
    // Strict parser is no longer reachable from the /list handler — we
    // pin its absence here; if a future change re-introduces it the
    // bug regresses to "Failed to load." Strict parsePagination must
    // also be gone from the file's import surface.
    expect(listBlock).not.toMatch(/parsePagination\(req\.query\)/);
    expect(quotesRouteSrc).not.toMatch(
      /import\s*\{[^}]*\bparsePagination\b(?![Ll])/,
    );
    // Existing Pipeline filtering semantics still flow through.
    expect(listBlock).toMatch(/bucket === "stale"/);
    expect(listBlock).toMatch(/quoteRepository\.getStalePipelineQuotes/);
    expect(listBlock).toMatch(/quoteRepository\.getQuotes/);
  });

  it("the four Pipeline modal query shapes parse cleanly through the lenient parser", async () => {
    const { parsePaginationLenient } = await import(
      "../server/utils/pagination"
    );

    // Pipeline mode → modal source → exact query shape sent by
    // <DashboardActionModal> (see SOURCE_PARAMS in the modal). All four
    // omit offset/cursor, which is the failure shape the route fix
    // targets.
    const cases: Array<{ mode: string; query: Record<string, string> }> = [
      // pipeline_quotes_not_sent → quotes_draft
      { mode: "pipeline_quotes_not_sent", query: { status: "draft", limit: "50" } },
      // pipeline_quotes_awaiting_response → quotes_sent_open
      { mode: "pipeline_quotes_awaiting_response", query: { status: "sent", limit: "50" } },
      // pipeline_stale_opportunities (quote half) → stale_quotes
      { mode: "pipeline_stale_opportunities", query: { bucket: "stale", staleDays: "14", limit: "50" } },
      // pipeline_leads_followup hits /api/leads (no parsePagination
      // there) — included as a smoke check that lenient still parses
      // its limit-only shape if the route ever consolidates.
      { mode: "pipeline_leads_followup", query: { bucket: "followup", limit: "50" } },
    ];

    for (const { mode, query } of cases) {
      const result = parsePaginationLenient(query);
      // No throw, defaults applied where needed.
      expect(result.params.limit, `${mode} limit`).toBe(50);
      expect(result.params.offset, `${mode} offset defaulted to 0`).toBe(0);
      expect(result.params.cursor, `${mode} cursor`).toBeUndefined();
      expect(result.explicit, `${mode} explicit (limit was passed)`).toBe(true);
    }
  });

  it("explicit-pagination callers (offset / cursor) still behave unchanged", async () => {
    const { parsePaginationLenient } = await import(
      "../server/utils/pagination"
    );

    // `client/src/pages/Quotes.tsx` sends `?offset=0&limit=200`.
    const explicitOffset = parsePaginationLenient({ offset: "0", limit: "200" });
    expect(explicitOffset.params.offset).toBe(0);
    expect(explicitOffset.params.limit).toBe(200);
    expect(explicitOffset.explicit).toBe(true);

    // Cursor pagination still works when callers opt in.
    const explicitCursor = parsePaginationLenient({ cursor: "abc123", limit: "25" });
    expect(explicitCursor.params.cursor).toBe("abc123");
    expect(explicitCursor.params.offset).toBeUndefined();
    expect(explicitCursor.params.limit).toBe(25);
    expect(explicitCursor.explicit).toBe(true);

    // No-pagination callers (e.g. ClientDetailPage's
    // `?customerCompanyId=...&limit=200`) get offset=0 defaulted, which
    // is also the case the dashboard modal relied on.
    const implicit = parsePaginationLenient({ customerCompanyId: "uuid", limit: "200" });
    expect(implicit.params.offset).toBe(0);
    expect(implicit.params.limit).toBe(200);
  });
});

// ─── No new modal component + Needs Attention / Operational Alerts unchanged ──

describe("Reuse contract — no new modal component, sibling cards untouched", () => {
  function collectSrcFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === "dist" || name === "build") continue;
        collectSrcFiles(full, acc);
      } else if (/\.(tsx?|jsx?)$/.test(name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("no new pipeline modal component file landed in client/src", () => {
    const files = collectSrcFiles(resolve(ROOT, "client/src"));
    const offenders = files.filter((f) =>
      /PipelineLeadsModal|PipelineQuotesModal|StaleOpportunitiesModal|PipelineActionModal/.test(f),
    );
    expect(offenders).toEqual([]);
  });

  it("Pipeline modes route through the shared <OperationalActionModal>", () => {
    // The modal source still mounts only the shared chrome — no new
    // pattern wrapper introduced.
    expect(modalSrc).toMatch(/<OperationalActionModal\b/);
    expect(modalSrc).not.toMatch(/<PipelineActionModal\b/);
    expect(modalSrc).not.toMatch(/<StaleOpportunitiesModal\b/);
  });

  it("Needs Attention card has been retired and the row absorbed into Operational Alerts (2026-05-07)", () => {
    // The standalone NeedsAttentionCard was removed. Its single
    // "Invoices not sent" row moved to the bottom of OperationalAlertsCard.
    // The page no longer declares NeedsAttentionCard / its props /
    // its mount. The label literal moved with it.
    expect(dashSrc).not.toMatch(/function NeedsAttentionCard\(/);
    expect(dashSrc).not.toMatch(/<NeedsAttentionCard\b/);
    // The row config now lives in OperationalAlertsCard.
    expect(alertsSrc).toMatch(
      /invoices_not_sent:\s*\{[\s\S]+?label:\s*"Invoices not sent"[\s\S]+?mode:\s*"invoices_not_sent"/,
    );
  });

  it("Operational Alerts row → mode mapping covers the four legacy modes + invoices_not_sent", () => {
    // Pin the row mode bindings — refactor must not have leaked
    // into this card. The 2026-05-07 consolidation added
    // invoices_not_sent at the bottom of the canonical row order.
    expect(alertsSrc).toMatch(/ready_to_invoice:\s*\{[\s\S]+?mode:\s*"ready_to_invoice"/);
    expect(alertsSrc).toMatch(/past_due:\s*\{[\s\S]+?mode:\s*"past_due"/);
    expect(alertsSrc).toMatch(/unscheduled:\s*\{[\s\S]+?mode:\s*"unscheduled"/);
    expect(alertsSrc).toMatch(/requires_attention:\s*\{[\s\S]+?mode:\s*"requires_attention"/);
    expect(alertsSrc).toMatch(/invoices_not_sent:\s*\{[\s\S]+?mode:\s*"invoices_not_sent"/);
  });
});
