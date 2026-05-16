// Canonical workspace type definitions.
// No domain imports. No runtime code.
// All workspace primitives and hooks import types from here.

// ── Filter types ──────────────────────────────────────────────────────────────

/**
 * Open filter bag — intentionally untyped at the workspace layer.
 * Domain workspaces extend via intersection:
 *   type InvoiceWorkspaceFilters = WorkspaceFilters & { dateRange?: ...; status?: ... }
 * Cast at the domain callsite; the cast is explicit — hidden coupling becomes visible.
 */
export type WorkspaceFilters = Record<string, unknown>;

// ── Sort ──────────────────────────────────────────────────────────────────────

export interface WorkspaceSort {
  field: string;
  direction: "asc" | "desc";
}

// ── Rail geometry ─────────────────────────────────────────────────────────────

export interface WorkspaceRailState {
  leftRailCollapsed: boolean;
  rightRailExpanded: boolean;
}

// ── Selection ─────────────────────────────────────────────────────────────────

export interface WorkspaceSelectionState {
  selectedIds: string[];
  activeEntityId: string | null;
}

// ── Full workspace state ──────────────────────────────────────────────────────

export interface WorkspaceState extends WorkspaceRailState, WorkspaceSelectionState {
  activeView: string;
  searchQuery: string;
  filters: WorkspaceFilters;
  sort: WorkspaceSort | null;
}

// ── Action surface ────────────────────────────────────────────────────────────

export interface WorkspaceActions {
  /** Change the active view. Resets searchQuery, filters, sort, and clears selection. */
  setView: (view: string) => void;
  setSelectedIds: (ids: string[], activeId?: string | null) => void;
  clearSelection: () => void;
  setSearchQuery: (q: string) => void;
  setFilter: (key: string, value: unknown) => void;
  clearFilters: () => void;
  setSort: (field: string, direction: "asc" | "desc") => void;
  clearSort: () => void;
  toggleLeftRail: () => void;
}

// ── Controller (state + actions combined) ────────────────────────────────────

export type WorkspaceController = WorkspaceState & WorkspaceActions;

// ── Config passed into useWorkspaceState ─────────────────────────────────────

export interface WorkspaceConfig {
  /** localStorage key prefix. e.g. "syntraro.invoices" → stored as "syntraro.invoices.railCollapsed" */
  lsKey: string;
  validViews: readonly string[];
  defaultView?: string;
  selectionDebounceMs?: number;
  /**
   * Optional navigation callback for domain-controlled URL routing.
   * When provided, setView calls this instead of updating ?view= directly.
   * Use when the domain needs to preserve extra URL params (e.g. tab=invoices).
   */
  onNavigate?: (view: string) => void;
  /**
   * Called synchronously when activeView changes (after search/filters/sort reset).
   * Use to clear domain selection state and collapse the right rail — removes
   * the manual clearing that would otherwise be duplicated across every domain tab.
   */
  onViewChange?: () => void;
}
