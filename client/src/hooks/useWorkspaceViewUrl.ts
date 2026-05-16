import { useSearch } from "wouter";

/**
 * Reads the active workspace view from the ?view= URL param.
 * Returns defaultView when the param is absent or invalid.
 *
 * Read-only — domain callsites own navigation (they may need to
 * preserve extra params like tab=invoices). Use alongside
 * useWorkspaceState which wires setView to the domain's onNavigate.
 */
export function useWorkspaceViewUrl<V extends string>(
  validViews: readonly V[],
  defaultView: V,
): V {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (validViews as readonly string[]).includes(view)) return view as V;
  return defaultView;
}
