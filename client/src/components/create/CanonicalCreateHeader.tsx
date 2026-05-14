/**
 * CanonicalCreateHeader — card header for unsaved entity creation flows.
 *
 * Purpose-built for create pages (CreateQuotePage, NewInvoicePage, CreateLeadPage).
 * Mirrors CanonicalDetailHeader's card shell but is designed around the create
 * flow: client selection is always Section A (first), followed by title, meta
 * items, and description.
 *
 * DO NOT use on saved-entity detail pages — use CanonicalDetailHeader there.
 * DO NOT modify CanonicalDetailHeader to accommodate create-page concerns.
 *
 * Layout:
 *   Top chrome:  ← back  [entity label h1]  [Status chip]  [Cancel] [Primary action]
 *   Section A:   Client / Location (always first — must be picked before anything else)
 *                afterClientSlot? (template picker, Add jobs, etc.)
 *   Section B:   Title input (left) | Meta items grid (right)
 *   Section C:   Description / Scope of work textarea
 *
 * Pages provide descriptors, data, and handlers only. This component owns
 * all card chrome, spacing, typography, and structural layout.
 */
import type { ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip, type ChipTone } from "@/components/ui/chip";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  getLocationKey,
  getLocationLabel,
  getLocationDescription,
  type LocationOption,
} from "@/lib/entities/locationEntity";

// ── Descriptor types ──────────────────────────────────────────────────────

export interface CreateHeaderMetaItem {
  key: string;
  label: string;
  /** Always rendered — create pages are always in edit mode. */
  node: ReactNode;
}

export interface CreateHeaderPrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  isPending?: boolean;
  testId?: string;
  /** Connects an external hint element to this button via aria-describedby. */
  ariaDescribedBy?: string;
}

export interface CanonicalCreateHeaderProps {
  testId: string;
  /** Page-level H1 — "New Quote", "New Invoice", "New Lead" */
  entityLabel: string;
  /** Status chip */
  status: { label: string; tone: ChipTone };
  /** Back / discard navigation */
  onBack: () => void;

  // ── Section A: Client / Location ──────────────────────────────────────
  clientSearchText: string;
  onClientSearchTextChange: (v: string) => void;
  clientSearchResults: LocationOption[];
  clientSearchLoading: boolean;
  selectedLocation: LocationOption | null;
  onLocationChange: (loc: LocationOption | null) => void;
  /** Called when the user triggers "create new client" — receives current search text. */
  onCreateNewClient: (searchText: string) => void;
  clientCreateLabel?: string;
  clientPlaceholder?: string;
  clientDisabled?: boolean;
  /**
   * Rendered below the client selector when provided.
   * Use for entity-specific controls: template picker (quote), Add jobs (invoice).
   */
  afterClientSlot?: ReactNode;

  // ── Section B: Title / Summary ────────────────────────────────────────
  /** When undefined, Section B title input is not rendered. */
  titleValue?: string;
  onTitleChange?: (v: string) => void;
  titlePlaceholder?: string;
  titleMaxLength?: number;

  /** Meta items — rendered right-aligned alongside the title. Always edit mode. */
  metaItems?: CreateHeaderMetaItem[];

  // ── Section C: Description ────────────────────────────────────────────
  /** When undefined, Section C description textarea is not rendered. */
  descriptionValue?: string;
  onDescriptionChange?: (v: string) => void;
  descriptionPlaceholder?: string;
  descriptionMaxLength?: number;
  /** Section label — defaults to "Scope of work" */
  descriptionLabel?: string;

  // ── Actions ────────────────────────────────────────────────────────────
  primaryAction?: CreateHeaderPrimaryAction;
  onCancel: () => void;
  cancelDisabled?: boolean;
  cancelTestId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function CanonicalCreateHeader({
  testId,
  entityLabel,
  status,
  onBack,
  clientSearchText,
  onClientSearchTextChange,
  clientSearchResults,
  clientSearchLoading,
  selectedLocation,
  onLocationChange,
  onCreateNewClient,
  clientCreateLabel = "Create new client",
  clientPlaceholder = "Search clients...",
  clientDisabled = false,
  afterClientSlot,
  titleValue,
  onTitleChange,
  titlePlaceholder = "",
  titleMaxLength = 500,
  metaItems,
  descriptionValue,
  onDescriptionChange,
  descriptionPlaceholder = "Describe the scope of work…",
  descriptionMaxLength = 600,
  descriptionLabel = "Scope of work",
  primaryAction,
  onCancel,
  cancelDisabled = false,
  cancelTestId,
}: CanonicalCreateHeaderProps) {
  const showTitle = titleValue !== undefined && onTitleChange !== undefined;
  const showMeta = metaItems !== undefined && metaItems.length > 0;
  const showTitleRow = showTitle || showMeta;
  const showDescription = descriptionValue !== undefined && onDescriptionChange !== undefined;

  return (
    <div
      className="rounded-md border bg-card border-card-border shadow-card overflow-hidden"
      data-testid={testId}
    >
      {/* ── Top chrome: back + label + status + actions ───────────────── */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 shrink-0"
            aria-label="Back"
            data-testid={`${testId}-back`}
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
          <h1
            className="m-0 text-title font-semibold leading-tight text-text-primary"
            data-testid={`${testId}-label`}
          >
            {entityLabel}
          </h1>
          <div className="shrink-0" data-testid={`${testId}-status`}>
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={onCancel}
            disabled={cancelDisabled}
            data-testid={cancelTestId ?? `${testId}-cancel`}
          >
            Cancel
          </Button>
          {primaryAction && (
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              data-testid={primaryAction.testId ?? `${testId}-primary`}
              aria-describedby={primaryAction.ariaDescribedBy}
            >
              {primaryAction.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {primaryAction.label}
            </Button>
          )}
        </div>
      </div>

      {/* ── Section A: Client / Location ─────────────────────────────── */}
      <div
        className="border-t border-card-border px-5 py-3"
        data-testid={`${testId}-client-section`}
      >
        <h3 className="m-0 mb-2 text-label uppercase text-text-muted">
          Client / Location
        </h3>
        <CreateOrSelectField<LocationOption>
            label="Client / Location"
            value={selectedLocation}
            onChange={onLocationChange}
            searchResults={clientSearchResults}
            searchLoading={clientSearchLoading}
            searchText={clientSearchText}
            onSearchTextChange={onClientSearchTextChange}
            getKey={getLocationKey}
            getLabel={getLocationLabel}
            getDescription={getLocationDescription}
            createLabel={clientCreateLabel}
            onCreateNew={onCreateNewClient}
            placeholder={clientPlaceholder}
            disabled={clientDisabled}
            compact
          />
        {afterClientSlot && (
          <div className="mt-3" data-testid={`${testId}-after-client`}>
            {afterClientSlot}
          </div>
        )}
      </div>

      {/* ── Section B: Title + Meta items ────────────────────────────── */}
      {showTitleRow && (
        <div
          className="border-t border-card-border px-5 py-3 flex items-start justify-between gap-6"
          data-testid={`${testId}-title-section`}
        >
          {showTitle && (
            <div className="flex-1 min-w-0">
              <h3 className="m-0 mb-1.5 text-label uppercase text-text-muted">Title</h3>
              <input
                type="text"
                value={titleValue}
                onChange={(e) => onTitleChange!(e.target.value)}
                placeholder={titlePlaceholder}
                maxLength={titleMaxLength}
                className="w-full text-sm text-text-primary bg-white border border-border-default rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand"
                data-testid={`${testId}-title-input`}
              />
            </div>
          )}
          {showMeta && (
            <div
              className="shrink-0 flex items-start gap-x-6 gap-y-3 flex-wrap justify-end"
              data-testid={`${testId}-meta-items`}
            >
              {metaItems!.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-col items-end min-w-0"
                  data-testid={`${testId}-meta-${item.key}`}
                >
                  <span className="text-label uppercase text-text-muted">{item.label}</span>
                  <span className="mt-1">{item.node}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Section C: Description ────────────────────────────────────── */}
      {showDescription && (
        <div
          className="border-t border-card-border px-5 py-3"
          data-testid={`${testId}-description-section`}
        >
          <h3 className="m-0 mb-1.5 text-label uppercase text-text-muted">
            {descriptionLabel}
          </h3>
          <textarea
            value={descriptionValue}
            onChange={(e) => onDescriptionChange!(e.target.value)}
            placeholder={descriptionPlaceholder}
            maxLength={descriptionMaxLength}
            className="min-h-[88px] w-full text-body text-slate-900 bg-white border border-border-default rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand resize-none"
            data-testid={`${testId}-description-input`}
          />
        </div>
      )}
    </div>
  );
}
