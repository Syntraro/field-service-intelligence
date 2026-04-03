/**
 * Dispatch hover context — shared hover state for map↔calendar linkage.
 *
 * Avoids prop drilling through Timeline → LaneRow → VisitBlock chain.
 * Provider lives in DispatchPreview.tsx; consumed by DispatchVisitBlock,
 * WeekCalendarVisitBlock, and DispatchMapPanel.
 *
 * 2026-03-31: Created for dispatch map hover linkage.
 */
import { createContext, useContext } from "react";

interface DispatchHoverState {
  /** Visit ID currently hovered (from calendar card or map marker) */
  hoveredVisitId: string | null;
  /** Set hovered visit ID (null to clear) */
  setHoveredVisitId: (id: string | null) => void;
}

export const DispatchHoverContext = createContext<DispatchHoverState>({
  hoveredVisitId: null,
  setHoveredVisitId: () => {},
});

export function useDispatchHover() {
  return useContext(DispatchHoverContext);
}
