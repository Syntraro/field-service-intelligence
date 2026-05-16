// Single source of truth for all workspace layout constants.
// All workspace primitives import from here — no inline magic numbers permitted.

// ── Rail widths (px) ──────────────────────────────────────────────────────────

export const LEFT_RAIL_COLLAPSED_W  = 36;
export const LEFT_RAIL_EXPANDED_W   = 232;
export const RIGHT_RAIL_COLLAPSED_W = 48;
export const RIGHT_RAIL_EXPANDED_W  = 300;

// ── Transitions ───────────────────────────────────────────────────────────────

export const LEFT_RAIL_TRANSITION   = "width 200ms ease-out";
export const RIGHT_RAIL_TRANSITION  = "width 180ms ease-out";

// ── Toolbar ───────────────────────────────────────────────────────────────────

export const TOOLBAR_H              = 52;   // px — used as style={{ height: TOOLBAR_H }}

// ── Collapsed strip ───────────────────────────────────────────────────────────

export const COLLAPSED_STRIP_W      = LEFT_RAIL_COLLAPSED_W;  // alias for clarity

// ── Selection ─────────────────────────────────────────────────────────────────

export const SELECTION_DEBOUNCE_MS  = 120;  // ms

// ── Section card ──────────────────────────────────────────────────────────────

export const SECTION_CARD_HEADER_H  = 36;   // px — compact header row height
