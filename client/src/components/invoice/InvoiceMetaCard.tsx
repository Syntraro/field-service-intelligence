/**
 * InvoiceMetaCard — identity + meta + job-description card for both
 * the live `/invoices/:id` editor and the draft `/invoices/new`
 * builder.
 *
 * 2026-05-02 — extracted from `InvoiceDetailPage.tsx`. The component
 * body is byte-equivalent to the in-page version (Phase 5 added the
 * required `mode` prop; Phase 6 adopted the card on `NewInvoicePage`).
 * Shared helpers / types / class constants live in
 * `./invoiceMetaCommon` so this file and the live page can both
 * import them without a circular dependency.
 *
 * No mutations are performed inside this component in either mode —
 * every commit fires through parent-supplied callbacks
 * (`onSave` / `onDraftChange` / `onReferenceDraftChange` /
 * `onChangeJobDescriptionDraft`). The `mode` prop only changes which
 * affordances render.
 */
import { type ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { CardShellFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { AddressBlock } from "@/components/common/AddressBlock";
import {
  META_LABEL_CLASS,
  formatDateOnlyDisplay,
  type StructuredAddress,
  type ReferenceFieldDTO,
} from "./invoiceMetaCommon";

/** Identity + meta card — the dominant card at the top of the invoice
 *  workspace. Mirrors the canonical Studio reference: a chrome strip with
 *  the status pill (left) and action cluster (right), then a 2-col body
 *  with the customer / addresses on the left and a vertical key-value list
 *  on the right. The chrome's actions are passed in by the caller so the
 *  page keeps its handler scope. */
export function InvoiceMetaCard({
  // 2026-05-02 (Audit #2 invoice-flow Phase 5): `mode` is REQUIRED. Live
  // mode keeps the canonical edit-pencil → PATCH lifecycle untouched.
  // Draft mode (used by the future `/invoices/new` builder) suppresses
  // the chrome action cluster + the inline Save/Cancel footer — those
  // are tied to the live edit-commit cycle. Draft mode emits every edit
  // through the existing `onDraftChange` / `onChangeJobDescriptionDraft`
  // / `onReferenceDraftChange` callbacks so the parent can store them
  // in its own draft state without going through any mutation. The
  // card itself NEVER calls a mutation in either mode — every commit
  // fires through the parent-supplied callbacks; this prop only
  // changes which affordances render.
  mode,
  // Body data
  customerName, customerCompanyId, summary, billLine1, billLine2,
  serviceAddress, locationName,
  invoiceNumber, issueDate, dueDate, isPastDue, paymentTermsDays,
  jobNumber, jobId,
  // Chrome — `status` removed 2026-04-29: the status pill moved to the new
  // top action bar above this card; this card's chrome is now just the
  // edit-pencil affordance.
  headerActions,
  // 2026-04-28 — header inline edit
  isEditing, draft, onDraftChange, onSave, onCancel, isSaving,
  // 2026-04-28 — reference fields driven by canonical /api/reference-fields
  referenceFields, referenceDraft, onReferenceDraftChange,
  // 2026-04-29 (header cleanup pass): Job Description shares the meta
  // card's edit lifecycle. The card no longer accepts independent
  // "is editing description" / "save description" / "cancel description"
  // props — clicking the single header pencil opens edit mode for the
  // meta rows AND the description; the single Save/Cancel pair below
  // the description commits or discards both. The parent only has to
  // pass the description value, the live draft, and a draft setter.
  jobDescription, jobDescriptionDraft, onChangeJobDescriptionDraft,
  // 2026-05-03: optional slot that REPLACES the customer-identity
  // column's H1 + Billing Address + Service Address content. The
  // column wrapper (`px-5 pt-3 pb-4 pr-12 md:border-r`) and every
  // OTHER part of the card (right-column rows, job-description block,
  // chrome action cluster, footer) render unchanged.
  // Used by the new-invoice draft builder to host the
  // CreateOrSelectField inside the canonical card chrome BEFORE a
  // location is picked. Live callers leave it undefined and get the
  // canonical H1+addresses block.
  customerIdentitySlot,
}: {
  /** 2026-05-02 (Phase 5): "live" preserves the existing PATCH-driven
   *  edit lifecycle on `InvoiceDetailPage`. "draft" is for the future
   *  client-side `/invoices/new` builder — the parent owns the entire
   *  invoice draft and must pass `isEditing={true}` plus a non-null
   *  `draft` for the whole session; the card hides the chrome action
   *  cluster and the inline Save/Cancel footer because there is no
   *  edit-commit cycle (the page-level "Save Invoice" button submits
   *  the atomic POST). REQUIRED — no default. */
  mode: "live" | "draft";
  customerName: string;
  /** Optional canonical client id. When present, the H1 customer name
   *  becomes a link to `/clients/:id`; otherwise plain text. */
  customerCompanyId: string | null;
  /** 2026-05-03: persisted canonical short invoice title. Read-mode
   *  value of the new Summary row in the right column. Optional /
   *  null when the invoice has no summary set. */
  summary?: string | null;
  billLine1: string | null;
  billLine2: string | null;
  serviceAddress: StructuredAddress | null | undefined;
  /**
   * 2026-05-06 RALPH: now nullable. Callers MUST run the canonical
   * `resolveServiceLocationName(rawLocation, customerName)` helper and
   * pass its result. When the helper returns null (no real distinct
   * location name), the AddressBlock invoice variant suppresses the
   * row entirely instead of showing the prior dash placeholder.
   */
  locationName: string | null;
  invoiceNumber: string | null | undefined;
  issueDate: string | Date | null | undefined;
  dueDate: string | Date | null | undefined;
  isPastDue: boolean;
  paymentTermsDays: number | null | undefined;
  jobNumber: string | null | undefined;
  jobId: string | null;
  headerActions: ReactNode;
  isEditing: boolean;
  // 2026-05-03: `summary` is the canonical short invoice title. Surfaces
  // in the page-level header. Editable in this card; flows back via
  // `onDraftChange({ summary })`. Optional in legacy callers — when
  // omitted from the draft type, the input simply isn't rendered.
  draft: { invoiceNumber: string; issueDate: string; dueDate: string; paymentTermsDays: string; summary?: string } | null;
  onDraftChange: (patch: Partial<{ invoiceNumber: string; issueDate: string; dueDate: string; paymentTermsDays: string; summary: string }>) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  referenceFields: ReferenceFieldDTO[];
  referenceDraft: Record<string, string>;
  onReferenceDraftChange: (definitionId: string, value: string) => void;
  jobDescription: string;
  jobDescriptionDraft: string;
  onChangeJobDescriptionDraft: (value: string) => void;
  /** 2026-05-03: when supplied, replaces the H1+addresses content of
   *  the customer-identity column. The column wrapper is preserved so
   *  the rest of the card lays out identically. Live callers omit
   *  this and get the canonical H1+addresses rendering. */
  customerIdentitySlot?: ReactNode;
}) {
  const dash = <span className="text-slate-400">—</span>;
  // 2026-05-01 root-cause date fix: route through the shared canonical
  // extractor so read display and edit picker show the same calendar
  // day regardless of TZ. See `formatDateOnlyDisplay` / `extractDateOnly`
  // in `./invoiceMetaCommon` for the rationale.
  const fmtDate = (d: string | Date | null | undefined) => {
    const out = formatDateOnlyDisplay(d, "");
    return out ? out : dash;
  };
  const serviceCity = [serviceAddress?.city, serviceAddress?.province, serviceAddress?.postalCode].filter(Boolean).join(", ");
  const editing = isEditing && draft != null;

  // Compact edit-mode input — matches the read-mode value typography
  // so swapping in/out of edit mode does not shift row height.
  // 2026-04-29 (header cleanup pass): dropped the `font-mono` mixin
  // so values render in the page's standard sans typography instead
  // of monospace; the trailing decorative icons on Job # / Issued /
  // Due / Terms were also removed in this pass.
  // 2026-05-01 Typography Phase C: read-mode value migrated from
  // `text-xs` (15.2px, legacy) to canonical `text-row` (15/22). This
  // input mirror moves with it.
  const inputClass = "h-7 w-32 px-2 py-0 text-right text-row";

  return (
    <div className="relative overflow-hidden rounded-lg border border-card-border bg-card shadow-card" data-testid="card-invoice-meta">
      {/* 2026-04-29: Status pill moved to the top action bar above this
          card. The chrome row remains because the inline meta-card edit
          pencil (a section-scoped affordance, distinct from the lifecycle
          actions) lives here. */}
      {/* 2026-05-01 vertical-alignment fix: pencil floated absolutely
          so it no longer occupies its own row above the customer name.
          The body now opens with `pt-3` on the left column, putting
          the customer name H1 on the same top line as the pencil
          (both ~12px from the top edge of the card). The previous
          standalone pencil row (`px-5 pt-3 pb-2`) cost ~52px of
          vertical space before the H1; that band is gone. */}
      {/* 2026-05-02 (Phase 5): chrome action cluster (edit pencil +
          any lifecycle actions the parent injects via `headerActions`)
          is suppressed in draft mode — there is no saved invoice to
          edit/send/void, and the card is always editable so the
          pencil affordance is unnecessary. The wrapper itself is gated
          (not just the children) so we don't render an empty
          absolutely-positioned div in draft mode.
          2026-05-03: draft callers may now opt INTO the chrome slot by
          passing a non-null `headerActions` (e.g. the new-invoice
          builder's "Change client" / "Change jobs" affordances).
          Falsy `headerActions` in draft still suppresses the wrapper —
          empty-div regression remains avoided. Live behavior is
          unchanged: the wrapper always renders in live mode and the
          existing pencil + lifecycle cluster flows through as before. */}
      {(mode === "live" || headerActions != null) && (
        <div className="absolute right-5 top-3 z-10 flex items-center gap-2">
          {headerActions}
        </div>
      )}

      {/* Body — 2-col: identity / addresses on the left, meta list on the right.
          `pr-12` on the left column reserves clearance for the
          absolute-positioned pencil so the H1 can't run under it. */}
      <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr]">
        <div className="px-5 pt-3 pb-4 pr-12 md:border-r border-card-border">
          {customerIdentitySlot != null ? (
            // 2026-05-03: external content replaces the canonical
            // customer-identity block. Used by /invoices/new pre-
            // location to host the CreateOrSelectField in the same
            // visual position as the H1+addresses live block.
            customerIdentitySlot
          ) : (
            <>
              {/* 2026-04-28 — H1 mb tightened (was mb-4) so the address block
                  sits closer to the customer name. Font size kept at 3xl. */}
              {/* 2026-04-29: Customer name links to its canonical client detail
                  page (`/clients/:id`) when the company id is known. Falls back to
                  plain text when the id is missing (e.g. legacy invoices without
                  a customerCompany row). The visual treatment keeps the existing
                  text style — link affordance is only the cursor + hover
                  underline. */}
              {/* 2026-05-01 Typography Phase C: `text-3xl font-bold tracking-tight text-slate-900`
                  migrated to canonical `text-page-title` (30/36/700 in
                  tailwind.config.ts; matches the legacy text-3xl visual
                  size at the project's 19px html root). `tracking-tight`
                  kept since the token doesn't bundle letter-spacing. */}
              <h1 className="m-0 mb-2 text-page-title tracking-tight text-text-primary" data-testid="meta-customer-name">
                {customerCompanyId ? (
                  <Link
                    href={`/clients/${customerCompanyId}`}
                    className="hover:underline"
                    data-testid="link-customer-name"
                  >
                    {customerName || dash}
                  </Link>
                ) : (
                  customerName || dash
                )}
              </h1>

              {/* 2026-05-01 Typography Phase C — `text-xs` migrated to
                  canonical tokens. Body lines use `text-row`; the location
                  name (the row's primary identifier) uses `text-row-emphasis`
                  which bundles weight 500. Color migrated from raw
                  `text-slate-700/900` to `text-text-secondary/text-text-primary`
                  for color-token alignment. */}
              <div>
                <div className={`${META_LABEL_CLASS} mb-0.5`}>Billing Address</div>
                <div className="text-row text-text-secondary">{billLine1 || dash}</div>
                {billLine2 && <div className="text-row text-text-secondary">{billLine2}</div>}
              </div>

              <div className="my-2 border-t border-card-border" />

              <AddressBlock
                variant="invoice"
                label="Service Address"
                locationName={locationName}
                street={serviceAddress?.street ?? null}
                cityLine={serviceCity || null}
                testId="meta-service-location-name"
              />
            </>
          )}
        </div>

        {/* Vertical field list with hairline row dividers.
            2026-05-01 (canonical detail header dedup, follow-up):
            Invoice # / Due / Job # rows REMOVED entirely — they live
            in the canonical top header for both read AND edit modes.
            The top header's `editNode` slots dispatch the same
            `metaDraft` state and `onDraftChange` callbacks as the
            inputs that used to render here, so the unified Save in
            the lower card's footer continues to persist every header
            field in one round-trip. Issued / Terms / reference fields
            stay because they're not in the canonical header.
            2026-05-02: `md:pt-11` (44px = exact bottom of the absolute
            pencil at top-3 + h-8) reserves vertical space at the TOP
            of the right column so Issued / Terms / Reference rows
            start at or below the pencil's bottom edge. The MetaRow's
            own `py-2` adds another 8px of clearance so text never
            touches the pencil. The left column is intentionally NOT
            padded — its `pr-12` already keeps the H1 clear of the
            pencil without pushing the customer name down. Padding
            only applies at md+ where the 2-column grid lays out the
            pencil-overlap shape; on mobile the pencil overlays the
            top of the (single-column) body and column padding is
            unnecessary. */}
        <div className="md:pl-0 md:pt-11">
          {/* 2026-05-03: canonical Summary row. Editable single-line
              input in edit mode; plain text (or em-dash) in read mode.
              Surfaces the value that drives the page-level header
              title. Wider than the date/terms inputs because the title
              tends to be longer than a date. */}
          <MetaRow
            label="Summary"
            value={
              editing ? (
                <Input
                  type="text"
                  value={draft!.summary ?? ""}
                  onChange={(e) => onDraftChange({ summary: e.target.value })}
                  maxLength={255}
                  placeholder="e.g. Spring AC tune-up"
                  className={`${inputClass} w-56`}
                  data-testid="input-meta-summary"
                />
              ) : (
                summary && summary.trim() ? summary : dash
              )
            }
          />
          <MetaRow
            label="Issued"
            value={
              editing ? (
                <CanonicalDatePicker
                  value={draft!.issueDate}
                  onChange={(next) => onDraftChange({ issueDate: next ?? "" })}
                  // 2026-05-01 Phase C: text-xs → text-row, matching
                  // the read-mode value typography of this row.
                  className="h-8 text-row"
                  data-testid="input-meta-issue-date"
                />
              ) : (
                fmtDate(issueDate)
              )
            }
          />
          {/* 2026-04-28: Terms is now the last fixed row. PO # was removed
              (no canonical storage and never linked). The "Reference"
              placeholder was replaced by the canonical reference-fields
              rows below — read mode shows only populated fields, edit mode
              shows every configured (active) definition. */}
          {(() => {
            const visibleRefs = editing
              ? referenceFields.filter((f) => f.active || f.textValue)
              : referenceFields.filter((f) => !!f.textValue);
            const termsIsLast = !editing && visibleRefs.length === 0;
            return (
              <>
                <MetaRow
                  label="Terms"
                  value={
                    editing ? (
                      // 2026-05-01: type="number" → type="text" +
                      // inputMode="numeric" so the browser does not
                      // render up/down spinner arrows. Same digit-only
                      // validation enforced via onChange filter.
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={draft!.paymentTermsDays}
                        onChange={(e) => onDraftChange({ paymentTermsDays: e.target.value.replace(/[^0-9]/g, "") })}
                        className={`${inputClass} w-20`}
                        placeholder="30"
                        data-testid="input-meta-payment-terms"
                      />
                    ) : (
                      paymentTermsDays != null ? `Net ${paymentTermsDays}` : dash
                    )
                  }
                  last={termsIsLast}
                />
                {visibleRefs.map((f, idx) => {
                  const isLast = idx === visibleRefs.length - 1;
                  return (
                    <MetaRow
                      key={f.definitionId}
                      label={f.label}
                      value={
                        editing ? (
                          <Input
                            value={referenceDraft[f.definitionId] ?? ""}
                            onChange={(e) => onReferenceDraftChange(f.definitionId, e.target.value)}
                            disabled={!f.active || isSaving}
                            className={inputClass}
                            placeholder={`Enter ${f.label.toLowerCase()}…`}
                            data-testid={`input-meta-ref-${f.key}`}
                          />
                        ) : (
                          f.textValue
                        )
                      }
                      last={!editing && isLast}
                      testId={`meta-ref-${f.key}`}
                    />
                  );
                })}
              </>
            );
          })()}
        </div>
      </div>

      {/*
        Job Description — 2026-04-29 (header cleanup pass): now shares
        the meta card's edit lifecycle. The section's own pencil +
        Save/Cancel pair were removed; the single header pencil opens
        edit for both meta rows AND the description, and the unified
        Save/Cancel pair below this section commits or discards both.

        Three render states:
          • Empty + not editing: label only ("Job description (optional)").
            No placeholder text, no pencil — entry point is the header
            pencil at the top of this card.
          • Populated + not editing: label + description text below it.
          • Editing: label + textarea. Save / Cancel sit in the unified
            footer further down.
      */}
      {/*
        Outer wrapper carries the horizontal inset (px-5) and the
        compact mt-2 / pb-4 vertical rhythm so the description sits
        snugly under the body grid above. The inner wrapper carries
        the border — because its parent has px-5, the divider is
        inset to the content column instead of running card-edge to
        card-edge. Mirrors the Billing → Service Address inset
        divider pattern further up the card (`my-2 border-t
        border-card-border`). The `data-testid` stays on the outer
        wrapper so existing test selectors keep working.

        2026-04-29 (refinement): the entire section — wrapper,
        divider, label, body — collapses to nothing when the
        description is empty AND the header is not editing. Avoids
        a label + divider with no payload underneath, which read as
        visual noise on invoices that simply never used the
        description field. While editing, the section always renders
        so the user has a place to type.
      */}
      {(editing || jobDescription.trim().length > 0) && (
        <div
          className="mt-2 px-5 pb-4"
          data-testid="card-invoice-description"
        >
          <div className="border-t border-card-border pt-2">
            {/* 2026-05-01 Typography Phase C: label was
                `text-xs uppercase tracking-wide text-slate-500` —
                migrated to canonical `text-label` (which bundles
                size 13/16, weight 500, tracking 0.04em, and via
                `@layer components` in client/src/index.css the
                uppercase transform). Color migrated to
                `text-text-muted`. The explicit `uppercase` is
                redundant with the @layer rule but kept for
                code-search clarity. */}
            <h3 className="m-0 text-label uppercase text-text-muted">
              Job description (optional)
            </h3>
            {editing ? (
              <Textarea
                value={jobDescriptionDraft}
                maxLength={600}
                onChange={(e) => onChangeJobDescriptionDraft(e.target.value)}
                placeholder="Describe the work performed for this invoice. This appears above the line items on the client's PDF."
                // 2026-05-01: `text-sm text-slate-900` → `text-body text-text-primary`.
                // `text-body` (15/22) is canonical for form / textarea content.
                className="mt-2 min-h-[88px] text-body text-text-primary"
                data-testid="textarea-invoice-description"
              />
            ) : (
              <p
                // 2026-05-01: `text-[13px] leading-5 text-slate-900`
                // → `text-row text-text-primary`. The token bundles
                // size + line-height (15/22), so `leading-5` is
                // dropped. Visual delta is a 2px size bump (13→15)
                // matching the bumped token; the rest of the meta
                // card moves with it.
                className="m-0 mt-2 whitespace-pre-wrap text-row text-text-primary"
                data-testid="text-invoice-description"
              >
                {jobDescription}
              </p>
            )}
          </div>
        </div>
      )}

      {/*
        Unified Save / Cancel — saves the entire header card edit state
        (meta rows + reference fields + job description) in one shot.
        Outline Cancel + primary (green) Save per the cleanup spec, so
        the action pair reads as primary affordances rather than blending
        into the surrounding card chrome.

        2026-05-02 (Phase 5): hidden in draft mode. The draft surface has
        no edit-commit cycle inside this card — every keystroke already
        propagates to the parent's draft state via onDraftChange /
        onChangeJobDescriptionDraft / onReferenceDraftChange. The page-
        level "Save Invoice" button (Phase 6) submits the atomic POST.
      */}
      {editing && mode === "live" && (
        <CardShellFooter className="px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isSaving}
            data-testid="button-meta-cancel"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={isSaving}
            data-testid="button-meta-save"
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </CardShellFooter>
      )}
    </div>
  );
}

/** A single label/value row in the meta card's right column.
 *  2026-04-29 (header cleanup pass): dropped the `mono` and `icon`
 *  props. Values now render in the page's standard sans typography
 *  (no `font-mono`); the trailing decorative icon slot was removed
 *  because Job # / Issued / Due / Terms no longer carry icons. The
 *  `accent` flag is preserved for the past-due Due-date variant.
 *  Kept `export`-less because no caller outside this file constructs
 *  a MetaRow today.
 */
function MetaRow({
  label, value, accent, last, testId,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
  last?: boolean;
  testId?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-5 py-1.5 ${last ? "" : "border-b border-stone-100"}`}>
      {/* 2026-05-01 Typography Phase C — label was `text-xs text-slate-500`
          → `text-caption text-text-muted`; value was `text-xs text-slate-900`
          → `text-row text-text-primary`. Past-due accent keeps weight 600
          + danger color via `font-semibold text-rose-600`. */}
      <span className="text-caption text-text-muted">{label}</span>
      <span
        className={`text-right ${accent ? "text-row font-semibold text-rose-600" : "text-row text-text-primary"}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}
