/**
 * CanonicalDetailHeader — card-only renderer (2026-05-09 architectural refactor)
 *
 * Single canonical header for Job Detail, Quote Detail, and Lead Detail.
 * Purely presentational — NO data fetching, NO mutations, NO local edit state.
 *
 * Architecture (2026-05-09):
 *   All visual decisions belong to CDH. Callers pass typed plain-data
 *   descriptors — no ReactNode escape hatches for status, alerts,
 *   workflow, edit controls, title edit, or description edit. CDH owns
 *   100% of visual output for all structural concerns.
 *
 *   Remaining bounded ReactNode slots:
 *     DetailHeaderItem.value/editNode — entity numbers, date pickers
 *
 *   All pages (Job/Quote/Lead/Invoice + creation pages) use CDH directly.
 *
 * Layout (card — full header card with structured props):
 *   Identity area (left column):
 *     entityLabel / onBack / title (or titleEdit textarea) / subtitle (or subtitleEdit)
 *     status chip / clientName / contactName / addressLines / phone / email
 *
 *   Action area (right column):
 *     editCapability / primaryActions / overflowActions
 *     workflow — typed "quote-owner-assessment" row (canonical Select)
 *     alert    — typed banner (text + tone + icon)
 *     items    — label/value meta pairs
 *
 *   Below-identity chrome:
 *     description section (descriptionEdit descriptor or read-only text) / editControls footer
 *
 * Migration history:
 *   2026-05-01 — initial strip/card dual layout
 *   2026-05-08 — Task 3: typed action arrays; Task 4: card chrome owned by CDH
 *   2026-05-08 — description visibility fix
 *   2026-05-09 — strip removed; all ReactNode escape hatches replaced with typed descriptors
 *   2026-05-09 — editCapability replaces onEdit/editAriaLabel; descriptionEdit replaces
 *                descriptionEditContent; subtitleEdit added for Quote inline title edit
 */

import { Fragment, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Info,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionMenu, type ActionMenuTone } from "@/components/ui/action-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip, type ChipTone } from "@/components/ui/chip";
import { CardShellFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Shared types ──────────────────────────────────────────────────────

export interface DetailHeaderItem {
  /** Stable key — used as React key + appended to data-testid. */
  key: string;
  /** Top label, e.g. "Job #", "Scheduled". */
  label: string;
  /** Read-mode value. Pass `<span>—</span>` for empty. */
  value: ReactNode;
  /**
   * Edit-mode override. Shown in place of `value` when `isEditing=true`.
   *
   * Escape hatch for structured controls (date pickers, number inputs) that CDH
   * cannot own. Callers are responsible for token alignment:
   * - Typography: `text-row` (14px canonical token, not raw `text-sm`)
   * - Compact height: `h-7` (28px — aligns with `size="header-action"` buttons)
   */
  editNode?: ReactNode;
  /** Hide in read mode when true. Edit mode with editNode always shows. */
  hidden?: boolean;
  /** When true, renders value in a block container without text truncation.
   *  Use for multi-line ReactNode values (e.g. service address with two lines). */
  wrapValue?: boolean;
}

/** Structured descriptor for a CTA button in the actions cluster. */
export interface HeaderAction {
  id: string;
  label: string;
  /** Lucide icon component (h-3.5 w-3.5 applied internally). */
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  /** "primary" → green fill; "outline" → outline; "ghost" → ghost; "danger" → red outline */
  variant?: "primary" | "outline" | "ghost" | "danger";
  disabled?: boolean;
  /** When true, action is not rendered. */
  hidden?: boolean;
  testId?: string;
}

/** Structured descriptor for an item in the overflow dropdown.
 *  Rendering is delegated to ActionMenu — no raw DropdownMenuItem JSX at callsites.
 *  Use `tone` for visual emphasis; do not pass className. */
export interface HeaderOverflowItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  separator?: boolean;
  /** Visual tone for the item. "destructive" applies text-destructive. */
  tone?: ActionMenuTone;
  disabled?: boolean;
  hidden?: boolean;
  testId?: string;
}

// ── Typed descriptor types ─────────────────────────────────────────────

/** Status descriptor — CDH renders <StatusChip> internally. */
export interface StatusDescriptor {
  label: string;
  tone: ChipTone;
}

export type AlertTone = "warning" | "info" | "error" | "success";
export type AlertIcon = "alert" | "info" | "check";

/** Alert descriptor — CDH renders icon + text with canonical tone class. */
export interface AlertDescriptor {
  text: string;
  tone: AlertTone;
  icon?: AlertIcon;
  /** data-testid on the alert text span. */
  testId?: string;
}

export interface WorkflowOwnerOption {
  id: string;
  label: string;
}

export type WorkflowAssessmentStatus = "required" | "scheduled" | "completed" | null;

/** Typed workflow descriptor — CDH renders canonical UI for each kind. */
export interface WorkflowDescriptor {
  kind: "quote-owner-assessment";
  ownerUserId: string | null;
  ownerOptions: WorkflowOwnerOption[];
  isOwnerMutating?: boolean;
  assessmentStatus: WorkflowAssessmentStatus;
  isAssessmentMutating?: boolean;
  onOwnerChange: (userId: string | null) => void;
  onMarkAssessmentNeeded: () => void;
  onClearAssessmentNeeded: () => void;
  onScheduleAssessment: () => void;
  onCompleteAssessment: () => void;
  onCancelAssessment: () => void;
}

/** Typed save/cancel footer — CDH owns border-t chrome. Pass undefined in read mode. */
export interface HeaderEditControls {
  onSave: () => void;
  onCancel: () => void;
  isSaving?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  error?: string | null;
  saveTestId?: string;
  cancelTestId?: string;
}

/** Title edit descriptor — CDH renders an auto-focused single-line input. Pass undefined in read mode. */
export interface HeaderTitleEdit {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  maxLength?: number;
}

/** Description edit descriptor — CDH renders textarea internally. Pass undefined in read mode.
 *  Replaces the former descriptionEditContent ReactNode escape hatch. */
/** Canonical label and placeholder for the description field across Job, Quote, and Lead. */
export const DESCRIPTION_LABEL = "Scope of work";
export const DESCRIPTION_PLACEHOLDER = "Describe the scope of work…";

export interface HeaderDescriptionEdit {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  maxLength?: number;
  /** Defaults to DESCRIPTION_PLACEHOLDER when omitted. */
  placeholder?: string;
  testId?: string;
}

/** Edit capability descriptor — drives the pencil button visibility and callback.
 *  enabled: permission/state gate (pencil hidden when false).
 *  onStartEdit: called when the pencil is clicked. */
export interface HeaderEditCapability {
  enabled: boolean;
  ariaLabel?: string;
  onStartEdit?: () => void;
}

// ── Props ─────────────────────────────────────────────────────────────

export interface CanonicalDetailHeaderProps {
  /** Test ID prefix for the outer card and sub-elements. */
  testId?: string;
  /** Page-level edit flag. Swaps items' editNode for value. */
  isEditing?: boolean;
  /**
   * Visual surface variant.
   * "contained" (default) — renders the canonical card chrome
   *   (rounded border, bg-card, shadow-card). Used by Invoice, Quote, Lead.
   * "open" — removes the outer card border/shadow/background so the header
   *   blends with the page background. Internal dividers and padding are
   *   preserved. Used by Job Detail only (2026-05-13 open-surface pass).
   * "workspace" — inert wrapper (overflow-hidden only). No border, no
   *   rounding, no background. Intended for use inside the Job Detail
   *   unified workspace canvas which provides all outer chrome.
   */
  surface?: "contained" | "open" | "workspace";

  // ── Title ────────────────────────────────────────────────────────
  /** Primary title string (shown in <h1> or as titleEdit textarea fallback). */
  title: string;
  /** When set, wraps the <h1> title in a wouter <Link>. Used by Job Detail
   *  to navigate to the client page (replaces the body-row clientName link). */
  titleHref?: string;
  /** Small-caps entity badge rendered above title ("LEAD", "QUOTE"). */
  entityLabel?: string;
  /** Renders a back-arrow button. */
  onBack?: () => void;
  /** Secondary line below title. Shown as a muted <p> in read mode, or a single-line input when subtitleEdit is defined. */
  subtitle?: string;
  /** When defined, CDH renders an auto-focused textarea instead of <h1>.
   *  Pass `undefined` in read mode. */
  titleEdit?: HeaderTitleEdit;
  /** When defined, CDH renders an input in place of the subtitle text.
   *  Used by Quote to allow inline editing of quote.title (the subtitle). */
  subtitleEdit?: HeaderTitleEdit;

  // ── Status ───────────────────────────────────────────────────────
  /** Status descriptor — CDH renders <StatusChip tone={status.tone}>. */
  status?: StatusDescriptor;

  // ── Client identity ──────────────────────────────────────────────
  clientName?: string;
  /** When set, clientName renders as a wouter <Link>. */
  clientHref?: string;
  /** Secondary contact name line (User icon). */
  contactName?: string;

  // ── Address ──────────────────────────────────────────────────────
  /** Physical address lines. MapPin on first; indent on subsequent. */
  addressLines?: string[];
  /** Optional label above address block. */
  addressLabel?: string;
  phone?: string;
  email?: string;

  // ── Actions ──────────────────────────────────────────────────────
  /** Edit capability descriptor — controls pencil button visibility and callback.
   *  enabled: false hides the pencil (permission gate).
   *  onStartEdit: called when pencil is clicked. */
  editCapability?: HeaderEditCapability;
  primaryActions?: HeaderAction[];
  overflowActions?: HeaderOverflowItem[];

  // ── Typed workflow (replaces workflowSlot ReactNode) ─────────────
  workflow?: WorkflowDescriptor;

  // ── Typed alert (replaces headerAlert ReactNode) ──────────────────
  alert?: AlertDescriptor;

  // ── Metadata chips ────────────────────────────────────────────────
  /** Optional chip/badge row rendered below the title/subtitle block.
   *  Use for lightweight categorical metadata (e.g. Type, Priority).
   *  Accepts any ReactNode — typically an array of <Chip> elements.
   *  Reusable across Jobs, Leads, Quotes, Invoices. */
  metadataChips?: ReactNode;

  // ── Meta items ───────────────────────────────────────────────────
  items: DetailHeaderItem[];
  /** Number of columns for the metadata grid. Defaults to 2. Pass 3 for entities with
   *  5+ items, or 4 for a full-width segmented operational strip (e.g. Job Detail). */
  itemsColumns?: 2 | 3 | 4;

  // ── Description ──────────────────────────────────────────────────
  /** Read-mode description text. */
  description?: string | null;
  descriptionLabel?: string;
  /** Typed description edit descriptor — CDH renders textarea internally.
   *  Pass only when editing is active; omit in read mode so section hides when empty.
   *  placeholder defaults to DESCRIPTION_PLACEHOLDER when omitted. */
  descriptionEdit?: HeaderDescriptionEdit;

  // ── Edit controls (replaces editFooter ReactNode) ─────────────────
  /** Typed save/cancel footer. CDH renders border-t chrome + buttons.
   *  Pass `undefined` in read mode. */
  editControls?: HeaderEditControls;

  // ── Layout variant ───────────────────────────────────────────────
  /** When true, wraps the client/address block, metadata grid, and description
   *  section inside a subtle inset card below the top header row.
   *  Used by Job Detail to achieve the two-surface nested layout.
   *  Default false — all other callers (Invoice, Lead) use the flat layout. */
  innerCard?: boolean;
  /** When true, always renders the description section even when `description`
   *  is null/empty and `descriptionEdit` is undefined. Shows the placeholder text.
   *  Use instead of `innerCard` when the flat layout is preferred but the
   *  Scope of Work section should always be structurally visible. */
  alwaysShowDescription?: boolean;
}

// ── Alert tone → CSS class map ─────────────────────────────────────────

// 2026-05-09 Phase 3.1: replaced hardcoded palette classes with semantic tokens.
// 2026-05-09 Phase 3.1 fix: warning uses text-warning-foreground (dark amber, ~4.88:1 WCAG AA)
//   not text-warning (--warning amber fill = 2.18:1, inaccessible as text on white bg).
// text-info    = --info    (blue-600, passes WCAG AA on light bg).
// text-success = --success (emerald-600, passes WCAG AA on light bg).
const ALERT_TONE_CLASS: Record<AlertTone, string> = {
  warning: "text-warning-foreground",
  info:    "text-info",
  error:   "text-destructive",
  success: "text-success",
};

// ── Card-mode render helpers ───────────────────────────────────────────

function renderHeaderAction(action: HeaderAction) {
  if (action.hidden) return null;
  const Icon = action.icon;
  const iconEl = Icon ? <Icon className="h-3.5 w-3.5" /> : null;
  if (action.variant === "primary") {
    return (
      <Button
        size="header-action"
        className="bg-green-600 hover:bg-green-700 text-white gap-1"
        onClick={action.onClick}
        disabled={action.disabled}
        data-testid={action.testId}
      >
        {iconEl}{action.label}
      </Button>
    );
  }
  if (action.variant === "danger") {
    return (
      <Button
        variant="outline"
        size="header-action"
        className="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={action.onClick}
        disabled={action.disabled}
        data-testid={action.testId}
      >
        {iconEl}{action.label}
      </Button>
    );
  }
  if (action.variant === "ghost") {
    return (
      <Button
        variant="ghost"
        size="header-action"
        className="gap-1"
        onClick={action.onClick}
        disabled={action.disabled}
        data-testid={action.testId}
      >
        {iconEl}{action.label}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="header-action"
      className="gap-1"
      onClick={action.onClick}
      disabled={action.disabled}
      data-testid={action.testId}
    >
      {iconEl}{action.label}
    </Button>
  );
}

function renderWorkflow(workflow: WorkflowDescriptor, testId: string) {
  if (workflow.kind !== "quote-owner-assessment") return null;
  return (
    <div
      className="flex items-center gap-1.5 flex-wrap justify-end"
      data-testid={`${testId}-workflow`}
    >
      <label className="flex items-center gap-1 text-helper text-muted-foreground">
        <span>Owner</span>
        <Select
          value={workflow.ownerUserId ?? "unassigned"}
          onValueChange={(v) => workflow.onOwnerChange(v === "unassigned" ? null : v)}
          disabled={workflow.isOwnerMutating}
        >
          <SelectTrigger
            className="h-7 text-helper px-2 max-w-[140px]"
            data-testid="quote-header-owner-select"
          >
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {workflow.ownerOptions.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <span
        className="text-helper text-muted-foreground"
        data-testid="quote-header-assessment-label"
      >
        Assessment
      </span>

      {!workflow.assessmentStatus && (
        <Button
          variant="outline"
          size="header-action"
          className="gap-1"
          onClick={workflow.onMarkAssessmentNeeded}
          disabled={workflow.isAssessmentMutating}
          data-testid="quote-header-assessment-mark-needed"
        >
          Mark needed
        </Button>
      )}

      {workflow.assessmentStatus === "required" && (
        <>
          <StatusChip tone="warning" data-testid="quote-header-assessment-needed-chip">
            Needed
          </StatusChip>
          <Button
            variant="outline"
            size="header-action"
            className="gap-1"
            onClick={workflow.onScheduleAssessment}
            disabled={workflow.isAssessmentMutating}
            data-testid="quote-header-assessment-schedule"
          >
            Schedule
          </Button>
          <Button
            variant="ghost"
            size="header-action"
            className="gap-1 text-muted-foreground"
            onClick={workflow.onClearAssessmentNeeded}
            disabled={workflow.isAssessmentMutating}
            data-testid="quote-header-assessment-clear"
          >
            Clear
          </Button>
        </>
      )}

      {workflow.assessmentStatus === "scheduled" && (
        <>
          <StatusChip tone="info" data-testid="quote-header-assessment-scheduled-chip">
            Scheduled
          </StatusChip>
          <Button
            variant="outline"
            size="header-action"
            className="gap-1"
            onClick={workflow.onCompleteAssessment}
            disabled={workflow.isAssessmentMutating}
            data-testid="quote-header-assessment-complete"
          >
            Complete
          </Button>
          <Button
            variant="ghost"
            size="header-action"
            className="gap-1 text-muted-foreground"
            onClick={workflow.onCancelAssessment}
            disabled={workflow.isAssessmentMutating}
            data-testid="quote-header-assessment-cancel"
          >
            Cancel
          </Button>
        </>
      )}

      {workflow.assessmentStatus === "completed" && (
        <StatusChip tone="success" data-testid="quote-header-assessment-completed-chip">
          Completed
        </StatusChip>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────

export function CanonicalDetailHeader({
  testId = "detail-header",
  isEditing = false,
  surface = "contained",
  title,
  titleHref,
  entityLabel,
  onBack,
  subtitle,
  titleEdit,
  subtitleEdit,
  status,
  clientName,
  clientHref,
  contactName,
  addressLines,
  addressLabel,
  phone,
  email,
  editCapability,
  primaryActions,
  overflowActions,
  workflow,
  alert,
  metadataChips,
  items,
  itemsColumns = 2,
  description,
  descriptionLabel,
  descriptionEdit,
  editControls,
  innerCard = false,
  alwaysShowDescription = false,
}: CanonicalDetailHeaderProps) {
  // Visible meta items (filter hidden in read mode; always show editNode in edit mode)
  const visibleItems = items.filter(
    (it) => !it.hidden || (isEditing && it.editNode !== undefined),
  );

  // Visible actions (filter hidden)
  const visiblePrimary = primaryActions?.filter((a) => !a.hidden) ?? [];
  const visibleOverflow = overflowActions?.filter((a) => !a.hidden) ?? [];

  const hasDescription = description != null && description.trim().length > 0;

  // Description section: show when content exists, edit mode is active,
  // innerCard=true, OR alwaysShowDescription=true.
  const showDescription = hasDescription || descriptionEdit !== undefined || innerCard || alwaysShowDescription;

  // Render description content area (CDH owns all chrome)
  let descriptionContent: ReactNode;
  if (descriptionEdit !== undefined) {
    descriptionContent = (
      <textarea
        value={descriptionEdit.value}
        onChange={(e) => descriptionEdit.onChange(e.target.value)}
        onKeyDown={descriptionEdit.onKeyDown}
        maxLength={descriptionEdit.maxLength ?? 600}
        placeholder={descriptionEdit.placeholder ?? DESCRIPTION_PLACEHOLDER}
        className="mt-2 min-h-[88px] w-full text-body text-slate-900 bg-white border border-border-default rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand resize-none"
        data-testid={descriptionEdit.testId}
      />
    );
  } else {
    descriptionContent = (
      <p className={cn("text-row whitespace-pre-line", hasDescription ? "text-text-primary" : "text-text-disabled")}>
        {hasDescription ? description : "Scope of work."}
      </p>
    );
  }

  const hasActionsCluster =
    (editCapability?.enabled ?? false) ||
    visiblePrimary.length > 0 ||
    visibleOverflow.length > 0;

  const hasClientBlock = !!(
    clientName || (addressLines && addressLines.length > 0) || phone || email
  );
  const hasBodyRow = hasClientBlock || visibleItems.length > 0;

  // Extracted so the same JSX is shared between the flat body row and the
  // inner-card body row — avoids duplicating ~80 lines of client/metadata markup.
  const bodyRowContent = (
    <>
      {/* Client block — left column, fixed ~40% width */}
      {hasClientBlock && (
        <div
          className={cn(
            "w-2/5 shrink-0 min-w-0 space-y-2",
            visibleItems.length > 0 && "pr-6",
          )}
          data-testid={`${testId}-client-block`}
        >
          {clientName && (
            <div className="space-y-0.5">
              {clientHref ? (
                <Link href={clientHref}>
                  <span
                    className="text-header text-text-primary hover:text-brand transition-colors cursor-pointer truncate block"
                    data-testid={`${testId}-client`}
                  >
                    {clientName}
                  </span>
                </Link>
              ) : (
                <span
                  className="text-header text-text-primary truncate block"
                  data-testid={`${testId}-client`}
                >
                  {clientName}
                </span>
              )}
              {contactName && (
                <p className="text-helper text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3 text-slate-400 shrink-0" />
                  {contactName}
                </p>
              )}
            </div>
          )}
          {((addressLines && addressLines.length > 0) || phone || email) && (
            <div className="space-y-0.5 text-list-body text-muted-foreground">
              {addressLabel && (
                <p className="text-label uppercase text-muted-foreground">
                  {addressLabel}
                </p>
              )}
              {addressLines?.map((line, i) => (
                <p key={i} className="flex items-center gap-1">
                  {i === 0
                    ? <MapPin className="h-3 w-3 shrink-0" />
                    : <span className="w-3 shrink-0" />}
                  {line}
                </p>
              ))}
              {phone && (
                <p className="flex items-center gap-1">
                  <Phone className="h-3 w-3 shrink-0" />
                  {phone}
                </p>
              )}
              {email && (
                <p className="flex items-center gap-1">
                  <Mail className="h-3 w-3 shrink-0" />
                  <a href={`mailto:${email}`} className="hover:text-brand truncate">
                    {email}
                  </a>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Metadata grid — right column, flex-1 so it takes remaining ~60% */}
      {visibleItems.length > 0 && (
        <div
          className={cn(
            "flex-1 min-w-0 grid gap-x-6 gap-y-3",
            itemsColumns === 4 ? "grid-cols-4" : itemsColumns === 3 ? "grid-cols-3" : "grid-cols-2",
            hasClientBlock && "border-l border-card-border pl-6",
          )}
          data-testid={`${testId}-items`}
        >
          {visibleItems.map((it) => {
            const renderEdit = isEditing && it.editNode !== undefined;
            return (
              <div
                key={it.key}
                className="flex flex-col items-start min-w-0"
                data-testid={`${testId}-item-${it.key}`}
              >
                <span className="text-label uppercase text-text-muted">
                  {it.label}
                </span>
                <div className={cn("mt-1 text-row font-medium text-text-primary leading-tight min-w-0", !it.wrapValue && "truncate")}>
                  {renderEdit ? it.editNode : it.value}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  // Description header + body — shared between flat and inner-card description sections.
  const descriptionSection = showDescription ? (
    <>
      <h3 className="m-0 mb-1.5 text-label uppercase text-text-muted">
        {descriptionLabel ?? DESCRIPTION_LABEL}
      </h3>
      {descriptionContent}
    </>
  ) : null;

  return (
    <div
      className={cn(
        "overflow-hidden",
        surface === "workspace"
          ? ""
          : surface === "open"
          ? "rounded-md bg-white border border-slate-200"
          : "rounded-md border bg-card border-card-border shadow-card",
      )}
      data-testid={testId}
    >
      {/* ── Alert (expiry warnings, info banners) ────────────────── */}
      {alert && (
        <div
          className="px-5 pt-3 pb-0 flex justify-end"
          data-testid={`${testId}-alert`}
        >
          <span
            className={cn("flex items-center gap-1 text-helper", ALERT_TONE_CLASS[alert.tone])}
            data-testid={alert.testId ?? `${testId}-alert-text`}
          >
            {alert.icon === "alert" && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            {alert.icon === "info" && <Info className="h-3.5 w-3.5 shrink-0" />}
            {alert.icon === "check" && <Check className="h-3.5 w-3.5 shrink-0" />}
            {alert.text}
          </span>
        </div>
      )}

      {/* ── Identity section ───────────────────────────────────────── */}
      {/* pb-4 applies when: no body row (flat), OR innerCard mode (inner card
          handles its own bottom padding but identity section provides the gap). */}
      <div className={cn("px-5 pt-4", (innerCard || !hasBodyRow) && "pb-4")}>

        {/* TOP ROW: title + status (left) | actions + workflow (right) */}
        <div className="flex items-start justify-between gap-4">

          {/* LEFT: optional entityLabel/back → title H1 + status */}
          <div className="flex-1 min-w-0">
            {(onBack || entityLabel) && (
              <div className="flex items-center gap-2 mb-1">
                {onBack && (
                  <button
                    onClick={onBack}
                    className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                    aria-label="Back"
                    data-testid={`${testId}-back`}
                  >
                    <ArrowLeft className="h-3 w-3" />
                  </button>
                )}
                {entityLabel && (
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {entityLabel}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-start gap-3 flex-wrap">
              <div className="min-w-0">
                {titleEdit !== undefined ? (
                  <input
                    type="text"
                    value={titleEdit.value}
                    onChange={(e) => titleEdit.onChange(e.target.value)}
                    onKeyDown={titleEdit.onKeyDown}
                    maxLength={titleEdit.maxLength ?? 500}
                    placeholder={titleEdit.placeholder ?? ""}
                    autoFocus
                    className="w-full max-w-[520px] text-title font-semibold leading-tight text-text-primary bg-white border border-border-default rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand"
                    data-testid={`${testId}-title-input`}
                  />
                ) : titleHref ? (
                  <Link href={titleHref}>
                    <h1
                      className="m-0 text-title font-semibold leading-tight text-text-primary hover:text-brand transition-colors cursor-pointer break-words min-w-0"
                      data-testid={`${testId}-title`}
                    >
                      {title}
                    </h1>
                  </Link>
                ) : (
                  <h1
                    className="m-0 text-title font-semibold leading-tight text-text-primary break-words min-w-0"
                    data-testid={`${testId}-title`}
                  >
                    {title}
                  </h1>
                )}
                {subtitleEdit !== undefined ? (
                  <input
                    type="text"
                    value={subtitleEdit.value}
                    onChange={(e) => subtitleEdit.onChange(e.target.value)}
                    onKeyDown={subtitleEdit.onKeyDown}
                    maxLength={subtitleEdit.maxLength ?? 200}
                    placeholder={subtitleEdit.placeholder ?? ""}
                    autoFocus
                    className="w-full max-w-[520px] text-helper text-muted-foreground bg-white border border-border-default rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand"
                    data-testid={`${testId}-subtitle-input`}
                  />
                ) : subtitle ? (
                  <p className="text-helper text-muted-foreground mt-0.5 truncate">
                    {subtitle}
                  </p>
                ) : null}
              </div>
              {status && (
                <div className="shrink-0 mt-1" data-testid={`${testId}-status`}>
                  <StatusChip tone={status.tone}>{status.label}</StatusChip>
                </div>
              )}
            </div>
            {metadataChips && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2" data-testid={`${testId}-metadata-chips`}>
                {metadataChips}
              </div>
            )}
          </div>

          {/* RIGHT: actions cluster + workflow */}
          {(hasActionsCluster || workflow) && (
            <div
              className="shrink-0 flex flex-col items-end gap-2"
              data-testid={`${testId}-right`}
            >
              {hasActionsCluster && (
                <div
                  className="flex items-center gap-1.5 flex-wrap justify-end"
                  data-testid={`${testId}-actions`}
                >
                  {editCapability?.enabled && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={editCapability.onStartEdit}
                      className="shrink-0 text-text-disabled hover:text-text-primary hover:bg-surface-subtle"
                      aria-label={editCapability.ariaLabel ?? "Edit"}
                      data-testid={`${testId}-edit`}
                      disabled={isEditing}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {visiblePrimary.map((action) => (
                    <Fragment key={action.id}>
                      {renderHeaderAction(action)}
                    </Fragment>
                  ))}
                  {visibleOverflow.length > 0 && (
                    <ActionMenu
                      items={visibleOverflow.map((item) => ({
                        id: item.id,
                        label: item.label,
                        icon: item.icon,
                        tone: item.tone,
                        disabled: item.disabled,
                        hidden: item.hidden,
                        separator: item.separator,
                        onSelect: item.onClick,
                        testId: item.testId,
                      }))}
                      trigger={
                        <Button
                          variant="outline"
                          size="icon"
                          className="border-border-default text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
                          data-testid={`${testId}-overflow`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      }
                      align="end"
                      contentClassName="w-52"
                    />
                  )}
                </div>
              )}
              {workflow && renderWorkflow(workflow, testId)}
            </div>
          )}
        </div>

        {/* ── FLAT layout: body row inline (unchanged default) ─────── */}
        {!innerCard && hasBodyRow && (
          <div
            className={cn(
              "flex mt-3 pt-3 pb-4 border-t border-card-border",
              !hasClientBlock && "justify-end",
            )}
          >
            {bodyRowContent}
          </div>
        )}

        {/* ── INNER CARD layout: body + description in one inset card ── */}
        {innerCard && (hasBodyRow || showDescription) && (
          <div className="mt-3 rounded-md bg-inset-surface border border-card-border overflow-hidden">
            {hasBodyRow && (
              <div
                className={cn(
                  "flex px-4 pt-4 pb-4",
                  !hasClientBlock && "justify-end",
                )}
              >
                {bodyRowContent}
              </div>
            )}
            {showDescription && (
              <div
                className={cn("px-4 py-3", hasBodyRow && "border-t border-slate-100")}
                data-testid={`${testId}-description`}
              >
                {descriptionSection}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Description section — flat layout only (outside identity section) ── */}
      {!innerCard && showDescription && (
        <div
          className="border-t border-card-border px-5 py-3"
          data-testid={`${testId}-description`}
        >
          {descriptionSection}
        </div>
      )}

      {/* ── Edit controls footer — CDH owns border-t chrome ─────────── */}
      {editControls && (
        <CardShellFooter
          className="px-5 py-3"
          data-testid={`${testId}-footer`}
        >
          {editControls.error && (
            <span
              className="mr-auto text-xs text-destructive truncate"
              data-testid={`${testId}-footer-error`}
            >
              {editControls.error}
            </span>
          )}
          {/* size="sm" (32px) is intentional — commit controls are heavier than header-action (28px) */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={editControls.onCancel}
            disabled={editControls.isSaving}
            data-testid={editControls.cancelTestId ?? `${testId}-footer-cancel`}
          >
            {editControls.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={editControls.onSave}
            disabled={editControls.isSaving}
            data-testid={editControls.saveTestId ?? `${testId}-footer-save`}
          >
            {editControls.isSaving ? "Saving…" : (editControls.saveLabel ?? "Save")}
          </Button>
        </CardShellFooter>
      )}
    </div>
  );
}
