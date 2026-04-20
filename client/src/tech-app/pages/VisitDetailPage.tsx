/**
 * Technician PWA — Visit Detail Page (Phase 3: full tab UI).
 *
 * Tabs: Overview | Notes | Equipment | Parts
 * All data from single GET /api/tech/visits/:visitId (hydrated equipment).
 * Mutations: add note, add part, remove equipment, visit lifecycle.
 *
 * 2026-04-10 (P9-P10 Phase C): The AddPartSheet catalog selector was migrated
 * onto the canonical client pipeline:
 *
 *   - The local `ProductItem` shadow type was REMOVED.
 *   - The inline `useQuery(["/api/items", search])` was REPLACED with the
 *     canonical `useProductSearch(searchText)` hook.
 *   - The manual `<input>` + `<button>` result-list selector was REPLACED
 *     with the canonical `CreateOrSelectField<ProductOption>` plus the
 *     shared `getProductKey` / `getProductLabel` / `getProductDescription`
 *     option helpers.
 *   - The "create new tech catalog item" path now normalizes the response
 *     through `normalizeProductRow` so the selected value matches the
 *     canonical `ProductOption` shape.
 *
 * The save contract is INTENTIONALLY ASYMMETRIC and is preserved unchanged:
 *
 *     POST /api/tech/visits/:visitId/parts
 *     payload: { productId, quantity, equipmentId }
 *
 * Per the canonical Rule 6 in `shared/lineItem.ts`, the server hydrates
 * description / unitPrice / unitCost from the catalog on the tech path.
 * The office `draftToJobPartPayload(...)` helper is intentionally NOT used
 * here. Do not migrate this route to the full canonical input shape.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Navigation, MapPin, StickyNote, AlertCircle, Check,
  Loader2, RefreshCw, Send, Plus, Wrench, Package, Trash2, Paperclip, X as CloseIcon,
  ChevronRight, Search, X, FileText, Clock, Pause, Camera, File as FileIcon, Phone,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { MobileShell } from "../components/MobileShell";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useTechVisitDetail,
  type DetailNote, type DetailEquipment, type DetailPart,
} from "../hooks/useTechVisitDetail";
import {
  STATUS_LABELS, OUTCOME_LABELS, OUTCOME_COLORS, DEFAULT_OUTCOME_COLOR,
} from "../utils/visitDisplay";
import { displayApiError } from "../utils/apiErrorDisplay";
import { useDebouncedValue } from "../utils/useDebouncedValue";
import { toTelHref, toMapsHref } from "../utils/externalLinks";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { NoteAttachmentStrip } from "@/components/attachments/NoteAttachmentStrip";
import { useOfflineNotes } from "@/hooks/useOfflineNoteQueue";
import { useOnline } from "@/hooks/useOnline";
import { useNoteSyncReplay } from "../hooks/useNoteSyncReplay";
import {
  SUPPORTED_MIME_TYPES,
  useFileUpload,
  validateFileClientSide,
} from "@/hooks/useFileUpload";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useProductSearch,
  getProductKey,
  getProductLabel,
  getProductDescription,
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";

// ── Live timer ──

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [display, setDisplay] = useState("00:00:00");
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      setDisplay(`${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
    };
    tick();
    ref.current = setInterval(tick, 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [startedAt]);
  return <>{display}</>;
}

// ── Tabs ──

const TABS = ["Overview", "Notes", "Equipment", "Parts"] as const;
type Tab = typeof TABS[number];

// ── Outcome modal ──

function OutcomeModal({ onSelect, onCancel }: {
  onSelect: (outcome: string, note?: string) => void;
  onCancel: () => void;
}) {
  // Preselect "completed" — the most-frequent visit exit. Combined with the
  // tap-twice-to-confirm shortcut below, this cuts the happy-path completion
  // from 2 taps (select + Confirm) to 1 tap.
  const [selected, setSelected] = useState<string | null>("completed");
  const [note, setNote] = useState("");
  const outcomes = [
    { key: "completed", label: "Completed", desc: "Work finished successfully", cls: "border-emerald-400 bg-emerald-50" },
    { key: "needs_parts", label: "Needs Parts", desc: "Waiting on parts to continue", cls: "border-amber-400 bg-amber-50" },
    { key: "needs_followup", label: "Needs Follow-Up", desc: "Additional visit required", cls: "border-blue-400 bg-blue-50" },
  ];
  const needsNote = selected === "needs_parts" || selected === "needs_followup";
  const canSubmit = selected && (!needsNote || note.trim());

  // Tap an outcome row: select it. Tap the already-selected "completed" row
  // again: instantly confirm (no note required for that outcome). For the
  // outcomes that need a note, keep the explicit Confirm button as the gate.
  const handleOutcomeTap = (key: string) => {
    if (key === "completed" && selected === key) {
      onSelect(key);
      return;
    }
    setSelected(key);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-5 space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-slate-900">Visit Outcome</h2>
        <div className="space-y-2">
          {outcomes.map(o => (
            <button key={o.key} onClick={() => handleOutcomeTap(o.key)}
              className={`w-full text-left p-3 rounded-md border transition-colors ${selected === o.key ? o.cls : "border-slate-200"}`}>
              <div className="text-sm font-semibold text-slate-800">{o.label}</div>
              <div className="text-xs text-slate-500">{o.desc}</div>
            </button>
          ))}
        </div>
        {needsNote && (
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="Required: describe what's needed…"
            className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 resize-none h-20" />
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 h-10 rounded-md border border-slate-200 text-sm font-medium text-slate-600">Cancel</button>
          <button onClick={() => selected && canSubmit && onSelect(selected, note.trim() || undefined)}
            disabled={!canSubmit}
            className="flex-1 h-10 rounded-md bg-emerald-600 text-white text-sm font-semibold disabled:bg-slate-200 disabled:text-slate-400">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Equipment detail sheet ──

// EquipmentSheet modal removed — equipment card tap opens EquipmentDetailScreen directly

// ── Product search for Add Part ──
//
// 2026-04-10 Phase C: Selector standardized onto the canonical client
// pipeline (useProductSearch + CreateOrSelectField + ProductOption helpers).
// Save contract is intentionally REF-BASED — see the file-level header for
// the full asymmetry note.

function AddPartSheet({ equipmentId, equipmentName, recentParts, onClose, onSuccess, addPart, onError }: {
  equipmentId: string | null;
  /** Optional human-readable equipment label, shown in the sheet header so
   *  the tech sees which equipment context this add will attach to. */
  equipmentName?: string | null;
  /** Parts already on this visit. Used to render "Recent on this visit"
   *  chips for one-tap re-add of items the tech is already working with. */
  recentParts: DetailPart[];
  onClose: () => void;
  /** Fired only when a part has actually been added. Caller uses this for
   *  the success toast so a backdrop / X dismissal does not falsely
   *  announce "Part added". */
  onSuccess?: () => void;
  addPart: { mutateAsync: (p: { productId: string; quantity: string; equipmentId?: string | null }) => Promise<any>; isPending: boolean };
  onError: (err: any) => void;
}) {
  // Canonical ProductOption is the in-memory shape — same as every office
  // selector after Phase A/B. No tech-local shadow type.
  const [selected, setSelected] = useState<ProductOption | null>(null);
  const [searchText, setSearchText] = useState("");
  const [qty, setQty] = useState("1");
  const [creating, setCreating] = useState(false);
  const [newPrice, setNewPrice] = useState("");
  const [newType, setNewType] = useState<"product" | "service">("product");
  const [createPending, setCreatePending] = useState(false);
  // Multi-part flow controls. `keepOpen` toggles whether a successful add
  // closes the sheet or returns to the search view for the next part.
  // `lastAdded` drives the brief inline confirmation that replaces the
  // close-as-feedback signal when keepOpen is true.
  // `pendingChipId` disables the tapped recent chip while its mutation
  // is in flight so the tech can't double-fire.
  const [keepOpen, setKeepOpen] = useState(false);
  const [lastAdded, setLastAdded] = useState<{ name: string; qty: string } | null>(null);
  const [pendingChipId, setPendingChipId] = useState<string | null>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // 2026-04-10 Phase C: canonical search hook. Fires after 2 chars; same
  // /api/items endpoint, same caching, same normalized ProductOption[] shape
  // as every office selector.
  // Debounce the query locally so the shared hook fires at most once per
  // quiet window instead of on every keystroke. Hook contract unchanged.
  const debouncedSearchText = useDebouncedValue(searchText, 200);
  const {
    data: searchResults = [],
    isLoading: isSearchLoading,
    isError: isSearchError,
    refetch: refetchSearch,
  } = useProductSearch(debouncedSearchText);
  // Hook gate: `useProductSearch` only fires when searchText.length >= 2.
  // Scope the error banner to the same condition so we don't show a retry
  // prompt for queries that were never issued.
  const showSearchError = isSearchError && searchText.trim().length >= 2;
  // Keep the selector showing a loading indicator during the debounce wait
  // as well as the network fetch so the results list doesn't briefly flash
  // "empty" between keystroke and request.
  const selectorLoading = isSearchLoading || (searchText.trim().length >= 2 && searchText !== debouncedSearchText);

  // "Recent on this visit" chips — dedupe by productId (so re-add is
  // unambiguous), most-recent first, capped at 5. Skip parts without a
  // productId (legacy / manually-described rows can't be re-added by ref).
  const recentChips = useMemo(() => {
    const seen = new Set<string>();
    const out: DetailPart[] = [];
    const sorted = [...recentParts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const p of sorted) {
      if (!p.productId || seen.has(p.productId)) continue;
      seen.add(p.productId);
      out.push(p);
      if (out.length >= 5) break;
    }
    return out;
  }, [recentParts]);

  // Auto-focus qty as soon as a product is picked. `select()` highlights the
  // default "1" so the tech can immediately type a new number without
  // erasing — typing replaces the selection.
  useEffect(() => {
    if (selected) {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }
  }, [selected]);

  // Auto-expand the create-new form when a search yielded zero hits. Saves
  // the explicit "tap Create" step on the slow new-catalog-item path.
  // Only triggers once results have settled (not loading) and the user is
  // not already in the create form.
  const noResults = !selectorLoading && searchText.trim().length >= 2 && searchResults.length === 0 && !creating;
  useEffect(() => {
    if (noResults) setCreating(true);
  }, [noResults]);

  // Clear the inline "Added" strip after a short window so it doesn't
  // linger across multiple adds.
  useEffect(() => {
    if (!lastAdded) return;
    const t = setTimeout(() => setLastAdded(null), 2500);
    return () => clearTimeout(t);
  }, [lastAdded]);

  const handleCreateItem = async () => {
    if (!searchText.trim() || createPending) return;
    setCreatePending(true);
    try {
      // Tech-side catalog create stays on the tech route (server-side
      // permission model is intentionally narrower for technicians than the
      // office /api/items route). The response is normalized through the
      // canonical normalizeProductRow so the selected value matches the
      // ProductOption shape every other surface uses.
      const created = await apiRequest<unknown>("/api/tech/items", {
        method: "POST",
        body: JSON.stringify({ name: searchText.trim(), type: newType, unitPrice: newPrice || null }),
      });
      setSelected(normalizeProductRow(created));
      setCreating(false);
    } catch (err: any) { onError(err); }
    finally { setCreatePending(false); }
  };

  const handleSubmit = async () => {
    if (!selected || addPart.isPending) return;
    try {
      // 2026-04-10 Phase C: REF-BASED save contract preserved verbatim.
      // Server hydrates description/unitPrice/unitCost from the catalog row
      // matching `productId`. Do NOT use draftToJobPartPayload — that's the
      // office contract. See `shared/lineItem.ts` Rule 6 for the rationale.
      await addPart.mutateAsync({ productId: selected.id, quantity: qty, equipmentId });
      const justAdded = { name: selected.name, qty };
      onSuccess?.();
      if (keepOpen) {
        // Multi-part flow: clear and return to search so the next part can
        // be entered without a sheet open/close cycle. Inline strip below
        // confirms the add since we're not closing.
        setSelected(null);
        setSearchText("");
        setQty("1");
        setCreating(false);
        setLastAdded(justAdded);
      } else {
        onClose();
      }
    } catch (err: any) { onError(err); }
  };

  // One-tap re-add from a recent chip. Fires the same mutation contract
  // used by the manual flow, with qty="1" and the current sheet's
  // equipment context. Skips view B entirely.
  const handleChipTap = async (chip: DetailPart) => {
    if (!chip.productId || pendingChipId || addPart.isPending) return;
    setPendingChipId(chip.id);
    try {
      await addPart.mutateAsync({ productId: chip.productId, quantity: "1", equipmentId });
      onSuccess?.();
      setLastAdded({ name: chip.description, qty: "1" });
      if (!keepOpen) onClose();
    } catch (err: any) { onError(err); }
    finally { setPendingChipId(null); }
  };

  // Qty stepper handlers — keep at integer floor of 1.
  const stepQty = (delta: number) => {
    const current = Math.max(1, parseInt(qty || "1", 10) || 1);
    setQty(String(Math.max(1, current + delta)));
  };

  // Backdrop tap closes only when there is no in-progress work. When the
  // tech has selected a product or opened the inline catalog-create form,
  // an accidental backdrop tap would discard half-entered fields — so
  // backdrop is a no-op and the X / Back button becomes the explicit exit.
  const hasInProgressWork = !!selected || creating || createPending;
  const handleBackdrop = () => { if (!hasInProgressWork) onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={handleBackdrop}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-4 shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-900">Add Part</h2>
            {/* Equipment context — shown when AddPartSheet was opened with
                a specific equipment target so the tech knows which item
                this part will attach to. */}
            {equipmentName && (
              <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                <Wrench className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{equipmentName}</span>
              </p>
            )}
          </div>
          {/* Keep adding toggle — drives multi-part flow. Persisted only
              for the lifetime of this sheet session. */}
          <button
            onClick={() => setKeepOpen(v => !v)}
            aria-pressed={keepOpen}
            className={`min-h-[44px] px-3 rounded-md text-xs font-semibold transition-colors ${
              keepOpen
                ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                : "bg-slate-100 text-slate-600 border border-slate-200"
            }`}
            title={keepOpen ? "Sheet stays open after each add" : "Sheet closes after each add"}
          >
            {keepOpen ? "Keep adding ✓" : "Keep adding"}
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>
        {/* Inline confirmation — replaces close-as-feedback during a
            keep-open session. Auto-clears via the timeout effect above. */}
        {lastAdded && (
          <div
            className="mb-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-1.5 flex items-center gap-2"
            role="status"
            aria-live="polite"
          >
            <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
            <p className="text-xs text-emerald-700 truncate">
              Added <span className="font-semibold">{lastAdded.name}</span> ×{lastAdded.qty}
            </p>
          </div>
        )}
        {!selected ? (
          <>
            {/* Recent chips — one-tap re-add of items already on this
                visit. Sourced from `visit.parts` (deduped by productId,
                most-recent first, max 5). Tap fires the canonical add
                mutation at qty 1; honors the keep-open toggle. */}
            {!creating && recentChips.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Recent on this visit</p>
                <div className="flex flex-wrap gap-1.5">
                  {recentChips.map(chip => {
                    const pending = pendingChipId === chip.id;
                    return (
                      <button
                        key={chip.id}
                        onClick={() => handleChipTap(chip)}
                        disabled={!!pendingChipId || addPart.isPending}
                        aria-label={`Add another ${chip.description}`}
                        className="min-h-[36px] px-2.5 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-700 hover:bg-slate-200 active:bg-slate-300 disabled:opacity-60 flex items-center gap-1.5 max-w-[200px]"
                      >
                        {pending ? <Loader2 className="h-3 w-3 animate-spin shrink-0" /> : <Plus className="h-3 w-3 shrink-0" />}
                        <span className="truncate">{chip.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Search error banner — rendered alongside the canonical
                CreateOrSelectField rather than modifying the shared
                selector's contract. Only shows once the hook would have
                fired (searchText >= 2 chars). */}
            {showSearchError && (
              <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <p className="text-xs text-amber-800 flex-1">Couldn't load catalog results.</p>
                <button
                  onClick={() => refetchSearch()}
                  className="min-h-[44px] px-3 rounded-md text-xs font-semibold text-amber-700 hover:bg-amber-100 active:bg-amber-200"
                >
                  Retry
                </button>
              </div>
            )}
            {/* 2026-04-10 Phase C: canonical CreateOrSelectField replaces the
                manual input + result-list. The "Create new" callback opens the
                inline tech catalog create form below. */}
            <div className="mb-2">
              <CreateOrSelectField<ProductOption>
                label=""
                compact
                value={null}
                onChange={(product) => {
                  if (product) {
                    setSelected(product);
                    setSearchText("");
                    setCreating(false);
                  }
                }}
                searchResults={searchResults}
                searchLoading={selectorLoading}
                searchText={searchText}
                onSearchTextChange={setSearchText}
                getKey={getProductKey}
                getLabel={getProductLabel}
                getDescription={getProductDescription}
                createLabel={`Create "${searchText || "new item"}"`}
                onCreateNew={() => setCreating(true)}
                placeholder="Search products…"
              />
            </div>
            {creating && (
              <div className="border-t border-slate-200 pt-3 space-y-2">
                <p className="text-xs font-semibold text-slate-600">Create new item: {searchText}</p>
                <div className="flex gap-2">
                  <button onClick={() => setNewType("product")}
                    className={`flex-1 h-8 rounded-md text-xs font-semibold border ${newType === "product" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}>
                    Product
                  </button>
                  <button onClick={() => setNewType("service")}
                    className={`flex-1 h-8 rounded-md text-xs font-semibold border ${newType === "service" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}>
                    Service
                  </button>
                </div>
                <input value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Unit price (optional)"
                  type="number" step="0.01" inputMode="decimal" className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
                <button onClick={handleCreateItem} disabled={createPending || !searchText.trim()}
                  className="w-full h-10 rounded-md bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5">
                  {createPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Create & Select
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
              <p className="text-sm font-semibold text-slate-800">{selected.name}</p>
              <p className="text-xs text-slate-500">
                {selected.type === "service" ? "Service" : "Product"}
                {selected.unitPrice && ` · $${selected.unitPrice}`}
              </p>
            </div>
            <div>
              <label htmlFor="add-part-qty" className="text-xs font-semibold text-slate-500 mb-1 block">Quantity</label>
              {/* Stepper flanks the numeric input so common qty bumps don't
                  require opening the soft keyboard. Each stepper is 44×44
                  for thumb-friendly hit targets. */}
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => stepQty(-1)}
                  aria-label="Decrease quantity"
                  disabled={parseInt(qty || "1", 10) <= 1}
                  className="min-h-[44px] min-w-[44px] rounded-md border border-slate-200 text-base font-semibold text-slate-600 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50"
                >
                  −
                </button>
                <input
                  ref={qtyInputRef}
                  id="add-part-qty"
                  value={qty}
                  onChange={e => setQty(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter on qty submits the add — pairs with the qty
                    // autofocus so the common "select → confirm qty=1 →
                    // submit" flow is keyboard-only.
                    if (e.key === "Enter" && selected && !addPart.isPending) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  enterKeyHint="done"
                  className="flex-1 min-w-0 h-11 px-3 text-center text-sm border border-slate-200 rounded-md tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => stepQty(1)}
                  aria-label="Increase quantity"
                  className="min-h-[44px] min-w-[44px] rounded-md border border-slate-200 text-base font-semibold text-slate-600 hover:bg-slate-50 active:bg-slate-100"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelected(null)} className="flex-1 h-10 rounded-md border border-slate-200 text-sm font-medium text-slate-600">Back</button>
              <button onClick={handleSubmit} disabled={addPart.isPending}
                className="flex-1 h-10 rounded-md bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5">
                {addPart.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Add Part
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add Equipment Sheet ──

function AddEquipmentSheet({ visitId, onClose, onSuccess, addEquipment, onError }: {
  visitId: string;
  onClose: () => void;
  /** Fired only when an equipment selection or creation actually succeeded.
   *  Caller uses this for the success toast so a backdrop / X dismissal
   *  does not falsely announce "Equipment added". */
  onSuccess?: () => void;
  addEquipment: { mutateAsync: (equipmentId: string) => Promise<any>; isPending: boolean };
  onError: (err: any) => void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [createPending, setCreatePending] = useState(false);

  // Fetch location equipment for the visit's job location
  const { data: locationEquip, isError: locationEquipError, refetch: refetchLocationEquip } = useQuery<any[]>({
    queryKey: ["/api/tech/visits", visitId, "location-equipment"],
    queryFn: async () => {
      // Get the visit to find job → location, then fetch location equipment
      const detail = await apiRequest<any>(`/api/tech/visits/${visitId}`);
      if (!detail?.job?.id) return [];
      // Use the clients/location equipment endpoint
      const loc = detail.location;
      if (!loc?.id) return [];
      const resp = await apiRequest<any>(`/api/clients/${loc.id}/equipment`);
      return Array.isArray(resp) ? resp : (resp?.data ?? []);
    },
  });

  const filtered = (locationEquip ?? []).filter((e: any) =>
    !search || e.name?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = async (equipmentId: string) => {
    try {
      await addEquipment.mutateAsync(equipmentId);
      onSuccess?.();
      onClose();
    } catch (err: any) { onError(err); }
  };

  const handleCreate = async () => {
    if (!newName.trim() || createPending) return;
    setCreatePending(true);
    try {
      const created = await apiRequest<any>(`/api/tech/visits/${visitId}/location-equipment`, {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), equipmentType: newType || null, modelNumber: newModel || null, serialNumber: newSerial || null }),
      });
      if (created?.id) {
        onSuccess?.();
        onClose(); // Auto-attached by the endpoint
      }
    } catch (err: any) { onError(err); }
    finally { setCreatePending(false); }
  };

  // Backdrop tap closes only when no create-form work is in progress.
  // Prevents discarding a half-filled new-equipment form if the tech
  // fat-fingers the backdrop.
  const hasInProgressWork = creating || createPending;
  const handleBackdrop = () => { if (!hasInProgressWork) onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={handleBackdrop}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-4 shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">Add Equipment</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>
        {!creating ? (
          <>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search location equipment…"
                className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-md" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1 -mx-1">
              {locationEquipError && (
                <div className="text-center py-6 px-4">
                  <AlertCircle className="h-6 w-6 mx-auto mb-2 text-slate-400 opacity-60" />
                  <p className="text-xs text-slate-500 mb-2">Failed to load equipment</p>
                  <button
                    onClick={() => refetchLocationEquip()}
                    className="min-h-[44px] px-5 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!locationEquipError && filtered.map((e: any) => (
                <button key={e.id} onClick={() => handleSelect(e.id)} disabled={addEquipment.isPending}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50 rounded-md">
                  <p className="text-sm font-medium text-slate-800">{e.name}</p>
                  <p className="text-xs text-slate-400">{[e.equipmentType, e.serialNumber].filter(Boolean).join(" · ")}</p>
                </button>
              ))}
              {!locationEquipError && filtered.length === 0 && search.length > 0 && (
                <p className="text-center text-xs text-slate-400 py-3">No matching equipment</p>
              )}
            </div>
            {/* Always-visible create option */}
            <button onClick={() => { setCreating(true); setNewName(search); }}
              className="w-full mt-2 h-10 rounded-md border-2 border-dashed border-slate-200 text-sm font-semibold text-emerald-600 flex items-center justify-center gap-1.5 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors">
              <Plus className="h-3.5 w-3.5" />Create New Equipment
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Name *</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" autoFocus />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Type</label>
              <input value={newType} onChange={e => setNewType(e.target.value)} placeholder="e.g. RTU, Furnace"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Model</label>
              <input value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="Model number"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Serial</label>
              <input value={newSerial} onChange={e => setNewSerial(e.target.value)}
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCreating(false)} className="flex-1 h-10 rounded-md border border-slate-200 text-sm font-medium text-slate-600">Back</button>
              <button onClick={handleCreate} disabled={!newName.trim() || createPending}
                className="flex-1 h-10 rounded-md bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5">
                {createPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Create & Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Equipment Detail Screen (mobile-first, job-grouped history) ──

interface TimelineEntry { id: string; date: string | null; entryType: string; title: string; summary: string | null; jobId: string; jobNumber: number; visitStatus: string; outcome: string | null; technicianName: string | null; }
interface HistoryNote { id: string; text: string; author: string; date: string | null; jobId: string; }

// Group timeline visits + notes by jobId into unified job history cards
function buildJobHistory(timeline: TimelineEntry[], eqNotes: HistoryNote[]) {
  const jobMap = new Map<string, {
    jobId: string; jobNumber: number | null; date: string | null;
    visitStatus: string; outcome: string | null; technicianName: string | null;
    summary: string | null; notes: { id: string; text: string; author: string; date: string | null }[];
  }>();

  // Seed from timeline (visit-level)
  for (const t of timeline) {
    if (!jobMap.has(t.jobId)) {
      jobMap.set(t.jobId, {
        jobId: t.jobId, jobNumber: t.jobNumber, date: t.date,
        visitStatus: t.visitStatus, outcome: t.outcome, technicianName: t.technicianName,
        summary: t.summary, notes: [],
      });
    }
  }

  // Attach notes to their job groups
  for (const n of eqNotes) {
    const group = jobMap.get(n.jobId);
    if (group) {
      group.notes.push({ id: n.id, text: n.text, author: n.author, date: n.date });
    } else {
      // Note for a job not in timeline — jobNumber is not available from notes endpoint
      jobMap.set(n.jobId, {
        jobId: n.jobId, jobNumber: null, date: n.date,
        visitStatus: "", outcome: null, technicianName: null,
        summary: null, notes: [{ id: n.id, text: n.text, author: n.author, date: n.date }],
      });
    }
  }

  // Sort newest first by date
  return Array.from(jobMap.values()).sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
}

function EquipmentDetailScreen({ equipmentId, equipment, isTerminal, onClose, onAddNote, onRemove }: {
  equipmentId: string;
  equipment: DetailEquipment[];
  isTerminal: boolean;
  onClose: () => void;
  onAddNote: (equipmentId: string) => void;
  onRemove: (jobEquipmentId: string) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const eq = equipment.find(e => e.id === equipmentId);

  const timeline = useQuery<TimelineEntry[]>({
    queryKey: ["/api/equipment", equipmentId, "timeline"],
    queryFn: () => apiRequest(`/api/equipment/${equipmentId}/timeline`),
  });
  const eqNotes = useQuery<HistoryNote[]>({
    queryKey: ["/api/equipment", equipmentId, "notes"],
    queryFn: () => apiRequest(`/api/equipment/${equipmentId}/notes`),
  });

  if (!eq) return null;

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "";

  const infoItems = [
    ["Manufacturer", eq.manufacturer], ["Model", eq.model],
    ["Serial", eq.serial], ["Type", eq.type], ["Tag", eq.tag],
  ].filter(([, v]) => v);

  const historyLoading = timeline.isLoading || eqNotes.isLoading;
  const historyError = timeline.isError || eqNotes.isError;
  const jobHistory = (!historyLoading && !historyError && timeline.data && eqNotes.data)
    ? buildJobHistory(timeline.data, eqNotes.data) : [];
  const historyEmpty = !historyLoading && !historyError && jobHistory.length === 0;
  const retryHistory = () => {
    if (timeline.isError) timeline.refetch();
    if (eqNotes.isError) eqNotes.refetch();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
      {/* Compact header */}
      <div className="bg-[#0f1a2e] px-3 pt-2 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/20"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-white truncate">{eq.name}</h1>
            <p className="text-xs text-slate-400 truncate">{[eq.type, eq.manufacturer].filter(Boolean).join(" · ") || "Equipment"}</p>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2.5 space-y-2.5">

          {/* Info card — compact stacked */}
          {infoItems.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2.5">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {infoItems.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">{label}</p>
                    <p className="text-xs font-medium text-slate-800 truncate">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={() => { onAddNote(eq.id); onClose(); }}
              className="flex-1 h-9 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50 active:bg-slate-100">
              <StickyNote className="h-3 w-3" />Add Note
            </button>
            {!isTerminal && !confirmRemove && (
              <button onClick={() => setConfirmRemove(true)}
                className="flex-1 h-9 rounded-md border border-red-200 text-xs font-semibold text-red-600 flex items-center justify-center gap-1.5 hover:bg-red-50 active:bg-red-100">
                <Trash2 className="h-3 w-3" />Remove
              </button>
            )}
          </div>
          {confirmRemove && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-xs font-medium text-red-700">Remove this equipment from the job?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmRemove(false)} className="flex-1 h-8 rounded-md border border-slate-200 text-xs font-medium text-slate-600">Cancel</button>
                <button onClick={() => { onRemove(eq.jobEquipmentId); onClose(); }}
                  className="flex-1 h-8 rounded-md bg-red-600 text-white text-xs font-semibold">Remove</button>
              </div>
            </div>
          )}

          {/* Job-grouped history */}
          {historyLoading && <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-300" /></div>}
          {historyError && (
            <div className="text-center py-8 px-4">
              <AlertCircle className="h-6 w-6 mx-auto mb-2 text-slate-400 opacity-60" />
              <p className="text-xs text-slate-500 mb-2">Failed to load equipment history</p>
              <button
                onClick={retryHistory}
                className="min-h-[44px] px-5 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100"
              >
                Retry
              </button>
            </div>
          )}
          {historyEmpty && <p className="text-center py-8 text-xs text-slate-400">No history for this equipment</p>}
          {jobHistory.map(job => (
            <div key={job.jobId} className="rounded-md border border-slate-200 bg-white overflow-hidden">
              {/* Job header */}
              <div className="px-3 py-2 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">
                  {job.jobNumber != null ? `Job #${job.jobNumber}` : "Equipment Note"}
                </span>
                <span className="text-[10px] text-slate-400">{fmtDate(job.date)}</span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                {/* Visit info */}
                {job.visitStatus && (
                  <p className="text-xs text-slate-500">
                    {job.visitStatus}{job.outcome ? ` · ${job.outcome}` : ""}
                    {job.technicianName ? ` · ${job.technicianName}` : ""}
                  </p>
                )}
                {job.summary && <p className="text-xs text-slate-600">{job.summary}</p>}
                {/* Equipment-specific notes for this job */}
                {job.notes.length > 0 && (
                  <div className="space-y-1 pt-0.5">
                    {job.notes.map(n => (
                      <div key={n.id} className="pl-2 border-l-2 border-emerald-200">
                        <p className="text-xs text-slate-700 leading-relaxed">{n.text}</p>
                        <p className="text-[10px] text-slate-400">{n.author}{n.date ? ` · ${fmtDate(n.date)}` : ""}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Inline editable field ──

function EditableField({ label, value, fieldKey, accentBorder, editingField, editValue, onStart, onChange, onSave, onCancel, isPending }: {
  label: string;
  value: string | null;
  fieldKey: string;
  accentBorder?: boolean;
  editingField: string | null;
  editValue: string;
  onStart: (field: string, value: string | null) => void;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const isEditing = editingField === fieldKey;
  const borderCls = accentBorder ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white";
  const labelCls = accentBorder ? "text-emerald-600" : "text-slate-400";

  if (isEditing) {
    return (
      <div className={`rounded-md border ${borderCls} p-3`}>
        <p className={`text-xs font-semibold ${labelCls} uppercase tracking-wider mb-1`}>{label}</p>
        <textarea value={editValue} onChange={e => onChange(e.target.value)}
          className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 resize-none h-20" autoFocus />
        <div className="flex gap-2 mt-2">
          <button onClick={onCancel} className="flex-1 h-8 rounded-md border border-slate-200 text-xs font-medium text-slate-500">Cancel</button>
          <button onClick={onSave} disabled={isPending}
            className="flex-1 h-8 rounded-md bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60 flex items-center justify-center gap-1">
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}Save
          </button>
        </div>
      </div>
    );
  }

  if (!value) return null;

  return (
    <div className={`rounded-md border ${borderCls} p-3 cursor-pointer active:bg-slate-50 transition-colors`}
      onClick={() => onStart(fieldKey, value)}>
      <p className={`text-xs font-semibold ${labelCls} uppercase tracking-wider mb-1`}>{label}</p>
      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  );
}

// ── Loading / Error states ──

function LoadingState() {
  return (
    <MobileShell>
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mb-3 opacity-50" />
        <p className="text-sm font-medium">Loading visit…</p>
      </div>
    </MobileShell>
  );
}

function ErrorState({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) {
  return (
    <MobileShell>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <button
          onClick={onBack}
          aria-label="Back"
          className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <h1 className="text-sm font-semibold text-slate-800">Visit Detail</h1>
      </div>
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <AlertCircle className="h-10 w-10 mb-2 opacity-40" />
        <p className="text-sm font-medium mb-3">Failed to load visit</p>
        <button onClick={onRetry} className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold">
          <RefreshCw className="h-3 w-3" />Retry
        </button>
      </div>
    </MobileShell>
  );
}

// ── Main page ──

export function VisitDetailPage({ visitId }: { visitId: string }) {
  const [, setLocation] = useLocation();
  const {
    visit, isLoading, isError, refetch,
    startTravel, startJob, complete, addNote, updateNote, deleteNote,
    addPart, deletePart, removeEquipment, addEquipment,
    updateVisitNotes, updateJob,
    // 2026-04-09: reversible workflow controls + pause/resume
    cancelRoute, cancelStart, pauseJob, resumeJob,
  } = useTechVisitDetail(visitId);
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  // 2026-04-14 offline queue: pending + failed note rows for this visit,
  // plus retry/discard actions wired to the replay engine.
  const pendingNotes = useOfflineNotes(visitId);
  const { retry: retryNote, discard: discardNote } = useNoteSyncReplay();

  // 2026-04-14 hook-order fix: `useFileUpload` was previously called below
  // the early `isLoading` / `isError` returns further down this component,
  // which produced a "Rendered more hooks than during the previous render"
  // runtime error on the loading → loaded transition. Hoisting it here so
  // every render executes the same hook sequence.
  const { upload: uploadAttachment } = useFileUpload();
  const { isOnline } = useOnline();

  const [showOutcome, setShowOutcome] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  // Add Part sheet
  const [addPartForEquipment, setAddPartForEquipment] = useState<string | null | undefined>(undefined); // undefined=closed, null=general, string=equipmentId
  // Add Note with equipment context
  const [noteEquipmentId, setNoteEquipmentId] = useState<string | null>(null);
  // Equipment history view
  const [historyEquipmentId, setHistoryEquipmentId] = useState<string | null>(null);
  // Add equipment sheet
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  // Inline editing
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  // 2026-04-14 Fix E: tap-to-edit note sheet
  const [editingNote, setEditingNote] = useState<DetailNote | null>(null);
  // Two-step delete confirm for part rows. Holds the part id awaiting
  // confirmation; resets to null on cancel, on a different row's first
  // tap, or on successful delete.
  const [confirmDeletePartId, setConfirmDeletePartId] = useState<string | null>(null);

  const onBack = () => setLocation("/tech/today");

  if (isLoading) return <LoadingState />;
  if (isError || !visit) return <ErrorState onBack={onBack} onRetry={refetch} />;

  const isTerminal = visit.status === "completed" || visit.status === "on_hold" || visit.status === "cancelled";
  // 2026-04-09: paused is an active workflow state — visit is in flight, just not currently timing.
  const isActive = visit.status === "en_route" || visit.status === "in_progress" || visit.status === "on_site" || visit.status === "paused";
  const isOnSite = visit.status === "in_progress" || visit.status === "on_site";
  const isPaused = visit.status === "paused";
  // 2026-04-10: scheduledStart is the SOLE source of truth for actionability.
  // Status is lifecycle-only (en_route, in_progress, completed, etc.) — it is
  // NOT used to determine whether Start Travel should render. An unscheduled
  // placeholder has status="scheduled" but scheduledStart=null — the presence
  // of scheduledStart is what makes a visit actionable, not the status string.
  const hasSchedule = !!visit.scheduledStart;
  // "Ready to start" = has a schedule AND is in a pre-action lifecycle state
  const isReadyToStart = hasSchedule && !isActive && !isTerminal;

  const showSuccess = (msg: string) => { setActionSuccess(msg); setTimeout(() => setActionSuccess(null), 3000); };
  const showError = (err: any) => {
    // 2026-04-14: typed-code mapping. The server attaches a stable `code`
    // on every business 409 (see server/routes/techField.ts mapper).
    // Switch on the code, not on the status — multiple business rules
    // share status 409 and must surface different messages.
    const code = err?.code;
    if (code === "ACTIVE_VISIT_CONFLICT") {
      setActionError(err?.message || "Complete or pause the other active visit before starting this one.");
      return;
    }
    if (code === "RUNNING_TIME_ENTRY_EXISTS") {
      setActionError(err?.message || "A timer is already running. Pause it before continuing.");
      return;
    }
    if (code === "VERSION_MISMATCH") {
      setActionError("This record was updated elsewhere. Refresh and try again.");
      return;
    }
    // Auth-aware fallback: 401 is handled by SessionExpiredDialog at the app
    // root — surfacing a toast here causes a flicker. 403 gets a stable
    // message. Everything else shows the server-supplied text.
    const msg = displayApiError(err);
    if (msg === null) return;
    setActionError(msg);
  };

  // A16 double-submit guards: explicit early-return prevents a second
  // mutation dispatch if the user taps a button while the first call is
  // still in flight. TanStack Query will dedupe identical mutateAsync calls
  // but these guards make the contract obvious to readers and close the
  // window between user tap and React re-render disabling the button.
  const handleStartTravel = async () => {
    if (startTravel.isPending) return;
    setActionError(null);
    try { await startTravel.mutateAsync(); showSuccess("En route"); } catch (err: any) { showError(err); }
  };
  const handleStartJob = async () => {
    if (startJob.isPending) return;
    setActionError(null);
    try { await startJob.mutateAsync(); showSuccess("On site — job started"); } catch (err: any) { showError(err); }
  };
  // 2026-04-09: reversible workflow + pause/resume handlers.
  // Sub-1-minute time entries created by accidental taps are dropped on the
  // server (timeTrackingRepository.stopAndDiscardIfTrivial) so the tech does
  // not see phantom 5-second segments in payroll.
  const handleCancelRoute = async () => {
    if (cancelRoute.isPending) return;
    setActionError(null);
    try { await cancelRoute.mutateAsync(); showSuccess("Route cancelled"); } catch (err: any) { showError(err); }
  };
  const handleCancelStart = async () => {
    if (cancelStart.isPending) return;
    setActionError(null);
    try { await cancelStart.mutateAsync(); showSuccess("Start cancelled — back to en route"); } catch (err: any) { showError(err); }
  };
  const handlePauseJob = async () => {
    if (pauseJob.isPending) return;
    setActionError(null);
    try { await pauseJob.mutateAsync(); showSuccess("Paused"); } catch (err: any) { showError(err); }
  };
  const handleResumeJob = async () => {
    if (resumeJob.isPending) return;
    setActionError(null);
    try { await resumeJob.mutateAsync(); showSuccess("Resumed"); } catch (err: any) { showError(err); }
  };
  const handleComplete = async (outcome: string, outcomeNote?: string) => {
    if (complete.isPending) return;
    setActionError(null); setShowOutcome(false);
    try { await complete.mutateAsync({ outcome, outcomeNote }); showSuccess("Visit completed"); } catch (err: any) { showError(err); }
  };
  const handleAddNote = async (text: string, equipmentId: string | null, attachments: File[]) => {
    setActionError(null);
    try {
      // 1) Create the note (server endpoint returns the created row).
      const created: any = await addNote.mutateAsync({ text, equipmentId });
      const noteId: string | undefined = created?.id;

      // 2) Upload each staged attachment via the R2 3-step lifecycle, which
      //    also inserts the job_note_attachments row.
      if (noteId && attachments.length > 0) {
        for (const file of attachments) {
          try {
            await uploadAttachment(file, { entityType: "job_note", entityId: noteId });
          } catch (e: any) {
            showError(e);
          }
        }
        // Refresh visit detail so the new attachments render in NoteCard.
        queryClient.invalidateQueries({ queryKey: ["/api/tech/visits", visitId] });
      }

      if (equipmentId) {
        queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipmentId, "notes"] });
        queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipmentId, "timeline"] });
        queryClient.invalidateQueries({ queryKey: ["equipment-history", equipmentId] });
      }
      showSuccess("Note saved");
      setNoteEquipmentId(null);
    } catch (err: any) { showError(err); }
  };
  // 2026-04-14 Fix E: update / delete note (author-only enforced server-side).
  const handleUpdateNote = async (noteId: string, text: string) => {
    setActionError(null);
    try {
      await updateNote.mutateAsync({ noteId, text });
      setEditingNote(null);
      showSuccess("Note updated");
    } catch (err: any) { showError(err); }
  };
  const handleDeleteNote = async (noteId: string) => {
    setActionError(null);
    try {
      await deleteNote.mutateAsync(noteId);
      setEditingNote(null);
      showSuccess("Note deleted");
    } catch (err: any) { showError(err); }
  };
  const handleRemoveEquipment = async (jobEquipmentId: string) => {
    setActionError(null);
    try { await removeEquipment.mutateAsync(jobEquipmentId); showSuccess("Equipment removed"); } catch (err: any) { showError(err); }
  };

  const startEdit = (field: string, currentValue: string | null) => {
    setEditingField(field);
    setEditValue(currentValue || "");
  };
  const cancelEdit = () => { setEditingField(null); setEditValue(""); };
  const saveEdit = async () => {
    if (!editingField) return;
    setActionError(null);
    try {
      // Tech-editable job fields: summary, priority only
      await updateJob.mutateAsync({ version: visit.jobVersion!, [editingField]: editValue || null });
      showSuccess("Saved");
      cancelEdit();
    } catch (err: any) { showError(err); }
  };

  const anyPending =
    startTravel.isPending ||
    startJob.isPending ||
    complete.isPending ||
    cancelRoute.isPending ||
    cancelStart.isPending ||
    pauseJob.isPending ||
    resumeJob.isPending;

  // Group notes by equipment
  const generalNotes = visit.notes.filter(n => !n.equipmentId);
  const notesByEquipment = new Map<string, DetailNote[]>();
  for (const n of visit.notes) {
    if (n.equipmentId) {
      const list = notesByEquipment.get(n.equipmentId) ?? [];
      list.push(n);
      notesByEquipment.set(n.equipmentId, list);
    }
  }

  return (
    <MobileShell showNav>
      {/* ══════ HEADER ══════ */}
      <div className="bg-[#0f1a2e] px-3 pt-2 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            aria-label="Back"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/20 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <h1 className="text-base font-bold text-white leading-tight truncate flex-1">{visit.jobTitle}</h1>
        </div>
        <p className="text-sm text-slate-400 mt-0.5 pl-7">
          {visit.scheduledTime} – {visit.scheduledEnd} <span className="text-slate-600">·</span> {visit.company}
        </p>
        <div className="flex items-center justify-between mt-0.5 pl-7">
          <div className="flex items-center gap-1 text-xs text-slate-500 min-w-0 flex-1 truncate">
            <MapPin className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{visit.address}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {/* One-tap call — only rendered when the site has a phone on file. */}
            {toTelHref(visit.locationPhone) && (
              <a
                href={toTelHref(visit.locationPhone)!}
                aria-label={`Call ${visit.company}`}
                className="flex items-center gap-1 text-sm font-semibold text-emerald-400 min-h-[44px] px-2 rounded-md hover:bg-emerald-500/10 transition-colors"
              >
                <Phone className="h-3.5 w-3.5" />Call
              </a>
            )}
            {/* One-tap navigate — OS handoff to maps. */}
            {toMapsHref(visit.address) && (
              <a
                href={toMapsHref(visit.address)!}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in maps"
                className="flex items-center gap-1 text-sm font-semibold text-[#76B054] min-h-[44px] px-2 rounded-md hover:bg-[#76B054]/10 transition-colors"
              >
                <Navigation className="h-3.5 w-3.5" />Directions
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ══════ TIMER STRIP ══════ */}
      {/* 2026-04-09: indicator + label color change for paused state.
          Reversible Cancel buttons sit on the en_route and on-site strips.
          Pause/Resume sits on the on-site / paused strip. Sub-1-min segments
          are discarded server-side; the UI just calls the canonical actions. */}
      {isActive && !isTerminal && (
        // 2026-04-14 Fix A: status/timer on row 1, action buttons on row 2.
        // On iPhone 15 width (~393px) the previous single-row layout forced
        // the cluster of 2–3 buttons to wrap and visually overlap the timer.
        // Vertical stacking of the two concerns (status info / actions)
        // keeps buttons side-by-side within their row at any mobile width.
        <div className={`px-3 py-1.5 space-y-1.5 ${isPaused ? "bg-amber-100" : "bg-[#22c55e]/10"}`}>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${isPaused ? "bg-amber-500" : "bg-[#22c55e] animate-pulse"}`} />
            <span className={`text-sm font-semibold ${isPaused ? "text-amber-700" : "text-[#22c55e]"}`}>
              {STATUS_LABELS[visit.status] || visit.status}
            </span>
            <span className={`text-base font-bold tabular-nums ml-auto ${isPaused ? "text-amber-700" : "text-[#22c55e]"}`}>
              {visit.timerStartedAt && !isPaused ? <LiveTimer startedAt={visit.timerStartedAt} /> : "00:00:00"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-nowrap">
            {visit.status === "en_route" && (
              <>
                <button
                  onClick={handleCancelRoute}
                  disabled={anyPending}
                  className="flex-1 h-8 px-2 rounded-md bg-white border border-slate-300 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1 active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-cancel-route"
                >
                  {cancelRoute.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Cancel Route
                </button>
                <button
                  onClick={handleStartJob}
                  disabled={anyPending}
                  className="flex-1 h-8 px-2 rounded-md bg-[#22c55e] text-white text-xs font-bold flex items-center justify-center gap-1 active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-start-job"
                >
                  {startJob.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Start Job
                </button>
              </>
            )}
            {isOnSite && (
              <>
                <button
                  onClick={handleCancelStart}
                  disabled={anyPending}
                  className="h-8 w-8 shrink-0 rounded-md bg-white border border-slate-300 text-slate-500 flex items-center justify-center active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-cancel-start"
                  title="Cancel Start"
                  aria-label="Cancel Start"
                >
                  {cancelStart.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-4 w-4" />}
                </button>
                <button
                  onClick={handlePauseJob}
                  disabled={anyPending}
                  className="h-8 w-8 shrink-0 rounded-md bg-amber-100 border border-amber-300 text-amber-600 flex items-center justify-center active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-pause-job"
                  title="Pause"
                  aria-label="Pause"
                >
                  {pauseJob.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => setShowOutcome(true)}
                  disabled={anyPending}
                  className="flex-1 h-8 px-2 rounded-md bg-[#22c55e] text-white text-xs font-bold flex items-center justify-center gap-1 active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-complete"
                >
                  <Check className="h-3.5 w-3.5" />Complete
                </button>
              </>
            )}
            {isPaused && (
              <>
                <button
                  onClick={handleResumeJob}
                  disabled={anyPending}
                  className="flex-1 h-8 px-2 rounded-md bg-[#22c55e] text-white text-xs font-bold flex items-center justify-center gap-1 active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-resume-job"
                >
                  {resumeJob.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Resume
                </button>
                <button
                  onClick={() => setShowOutcome(true)}
                  disabled={anyPending}
                  className="flex-1 h-8 px-2 rounded-md bg-white border border-slate-300 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1 active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-complete-paused"
                >
                  <Check className="h-3.5 w-3.5" />Complete
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Outcome banner */}
      {visit.outcome && (
        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${OUTCOME_COLORS[visit.outcome] || DEFAULT_OUTCOME_COLOR}`}>
            {OUTCOME_LABELS[visit.outcome] || visit.outcome}
          </span>
        </div>
      )}

      {/* Unscheduled banner — shown when visit has no schedule */}
      {!isTerminal && !isActive && !hasSchedule && (
        <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-600 shrink-0" />
          <div>
            <span className="text-xs font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Unscheduled</span>
            <p className="text-xs text-amber-600 mt-0.5">Schedule this visit from the dispatch board before starting.</p>
          </div>
        </div>
      )}

      {/* Primary action — only when visit has a schedule and is ready to start */}
      {isReadyToStart && (
        <div className="px-3 py-2 bg-white border-b border-slate-100">
          <button onClick={handleStartTravel} disabled={anyPending}
            className="w-full h-11 rounded-md text-base font-bold flex items-center justify-center gap-2 active:scale-[0.98] bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60">
            {startTravel.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Start Travel
          </button>
        </div>
      )}

      {/* Action feedback banners — announced by screen readers. Success is
          polite (doesn't interrupt), error is assertive (stops current
          announcement). */}
      {actionSuccess && (
        <div
          className="px-3 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-1.5"
          role="status"
          aria-live="polite"
        >
          <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" /><p className="text-xs font-medium text-emerald-700">{actionSuccess}</p>
        </div>
      )}
      {actionError && (
        <div
          className="px-3 py-1.5 bg-red-50 border-b border-red-100"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-xs text-red-600">{actionError}</p>
          <button
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="min-h-[44px] text-xs text-red-500 underline mt-0.5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Visit Instructions — dispatch-authored notes shown persistently
          across all tabs so the tech does not have to switch to Overview
          to read them. Compact (small leading + condensed font) so it does
          not steal real estate when the body is more important. */}
      {visit.visitNotes && (
        <div className="px-3 py-1.5 bg-emerald-50 border-b border-emerald-100">
          <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Instructions</p>
          <p className="text-xs text-slate-700 leading-snug whitespace-pre-wrap">{visit.visitNotes}</p>
        </div>
      )}

      {/* ══════ TABS ══════ */}
      <div className="flex border-b border-slate-200 bg-white px-1 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 px-2 py-2 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab ? "text-[#22c55e] border-[#22c55e]" : "text-slate-400 border-transparent hover:text-slate-600"
            }`}>{tab}</button>
        ))}
      </div>

      {/* ══════ TAB CONTENT ══════ */}
      <div className="px-3 py-2.5 pb-28">

        {/* ── OVERVIEW ── */}
        {activeTab === "Overview" && (
          <div className="space-y-2">
            {/* 2026-04-19: Job # reference line — techs need the canonical
                job number visible without digging (customer reference,
                paperwork, warranty calls, PO matching, dispatch comms).
                Muted metadata styling (no pill, no bold) so it reads as a
                reference, not a CTA, and doesn't compete with Equipment
                to Service / Job Description below. `tabular-nums` keeps
                digit columns aligned. Hidden entirely when the visit has
                no linked job — no "N/A" placeholder. */}
            {visit.jobNumber != null && (
              <div className="text-sm font-medium text-slate-600 tabular-nums">
                Job # {visit.jobNumber}
              </div>
            )}
            {/* Visit Instructions are now rendered as a persistent banner
                above the tabs bar (visible on every tab), so the redundant
                Overview-only card has been removed. Job Description and
                Site Instructions remain here — they are reference content,
                not in-flight dispatch notes. */}
            {visit.jobDescription && (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Job Description</p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{visit.jobDescription}</p>
              </div>
            )}
            {visit.accessInstructions && (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Site Instructions</p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{visit.accessInstructions}</p>
              </div>
            )}
            {/* Equipment to Service */}
            {visit.equipment.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Equipment to Service</p>
                <div className="space-y-1.5">
                  {visit.equipment.map(eq => (
                    <div key={eq.id}
                      onClick={() => setHistoryEquipmentId(eq.id)}
                      className="rounded-md border border-slate-200 bg-white p-3 flex items-center gap-3 cursor-pointer active:bg-slate-50 transition-colors">
                      <div className="h-8 w-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                        <Wrench className="h-4 w-4 text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{eq.name}</p>
                        <p className="text-xs text-slate-400 truncate">{[eq.type, eq.manufacturer, eq.model].filter(Boolean).join(" · ") || "Equipment"}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* visitNotes is now displayed in the persistent banner above
                the tabs, not inside Overview, so it no longer suppresses
                the Overview empty-state. */}
            {visit.equipment.length === 0 && !visit.jobDescription && !visit.accessInstructions && (
              <EmptyState message="No overview information" className="py-8" />
            )}
            {/* Create Lead from visit context */}
            {!isTerminal && (
              <button
                onClick={() => {
                  setLocation(`/tech/create-lead?locationId=${visit.locationId}&visitId=${visitId}`);
                }}
                className="w-full h-9 rounded-md border border-dashed border-amber-200 text-xs font-semibold text-amber-600 flex items-center justify-center gap-1.5 hover:border-amber-300 hover:bg-amber-50/50 transition-colors mt-2"
              >
                <FileText className="h-3.5 w-3.5" />Create Lead from Visit
              </button>
            )}
          </div>
        )}

        {/* ── NOTES ── */}
        {activeTab === "Notes" && (
          <div className="space-y-2">
            {/* Quick add */}
            <NoteInput
              equipmentId={noteEquipmentId}
              equipment={visit.equipment}
              onEquipmentChange={setNoteEquipmentId}
              onSubmit={handleAddNote}
              isPending={addNote.isPending}
              lockedEquipment={!!noteEquipmentId}
              isOnline={isOnline}
              onBlocked={(msg) => setActionError(msg)}
            />

            {/* Pending / failed offline notes — prepended above real notes */}
            {pendingNotes.length > 0 && (
              <div className="space-y-1.5">
                {pendingNotes.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-md border border-slate-200 bg-white p-3"
                    data-testid={`pending-note-${q.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      {q.syncStatus === "failed" ? (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-red-600">
                          Sync failed
                        </span>
                      ) : q.syncStatus === "syncing" ? (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                          Syncing…
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-600">
                          Pending sync
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400">
                        {new Date(q.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap leading-5">{q.payload.text}</p>
                    {q.syncStatus === "failed" && (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void retryNote(q.id)}
                          className="h-6 px-2 text-[11px] rounded-md border border-red-200 text-red-700 hover:bg-red-50"
                          data-testid={`retry-pending-note-${q.id}`}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={() => void discardNote(q.id)}
                          className="h-6 px-2 text-[11px] rounded-md text-slate-500 hover:text-slate-700"
                          data-testid={`discard-pending-note-${q.id}`}
                        >
                          Discard
                        </button>
                        {q.lastError && (
                          <span className="text-[10px] text-red-500 truncate">{q.lastError}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Equipment-grouped notes */}
            {visit.equipment.map(eq => {
              const eqNotes = notesByEquipment.get(eq.id);
              if (!eqNotes?.length) return null;
              return (
                <div key={eq.id}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Wrench className="h-2.5 w-2.5" />{eq.name}
                  </p>
                  {eqNotes.map(n => <NoteCard key={n.id} note={n} currentUserId={currentUserId} onEdit={setEditingNote} />)}
                </div>
              );
            })}
            {/* General notes */}
            {generalNotes.length > 0 && (
              <div>
                {notesByEquipment.size > 0 && (
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">General</p>
                )}
                {generalNotes.map(n => <NoteCard key={n.id} note={n} currentUserId={currentUserId} onEdit={setEditingNote} />)}
              </div>
            )}
            {visit.notes.length === 0 && (
              <EmptyState icon={StickyNote} message="No notes yet" className="py-8" />
            )}
          </div>
        )}

        {/* ── EQUIPMENT ── */}
        {activeTab === "Equipment" && (
          <div className="space-y-2">
            {!isTerminal && (
              <button onClick={() => setShowAddEquipment(true)}
                className="w-full h-10 rounded-md border-2 border-dashed border-slate-200 text-sm font-semibold text-slate-500 flex items-center justify-center gap-1.5 hover:border-slate-300 hover:text-slate-600">
                <Plus className="h-3.5 w-3.5" />Add Equipment
              </button>
            )}
            {visit.equipment.map(eq => (
              <div key={eq.id} className="rounded-md border border-slate-200 bg-white p-3 flex items-center gap-3">
                <div onClick={() => setHistoryEquipmentId(eq.id)}
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer active:bg-slate-50">
                  <div className="h-8 w-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                    <Wrench className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{eq.name}</p>
                    <p className="text-xs text-slate-400">{[eq.type, eq.serial].filter(Boolean).join(" · ")}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                </div>
                {!isTerminal && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveEquipment(eq.jobEquipmentId); }}
                    aria-label="Remove equipment"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {visit.equipment.length === 0 && (
              <EmptyState icon={Wrench} message="No equipment linked" className="py-8" />
            )}
          </div>
        )}

        {/* ── PARTS ── */}
        {activeTab === "Parts" && (
          <div className="space-y-2">
            <button onClick={() => setAddPartForEquipment(null)}
              className="w-full h-10 rounded-md border-2 border-dashed border-slate-200 text-sm font-semibold text-slate-500 flex items-center justify-center gap-1.5 hover:border-slate-300 hover:text-slate-600">
              <Plus className="h-3.5 w-3.5" />Add Part
            </button>
            {visit.parts.length > 0 ? visit.parts.map(p => {
              const eqName = p.equipmentId ? visit.equipment.find(e => e.id === p.equipmentId)?.name : null;
              const confirming = confirmDeletePartId === p.id;
              return (
                <div key={p.id} className="rounded-md border border-slate-200 bg-white p-3 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{p.description}</p>
                    {/* 2026-04-19: Added-date subscript removed — it was
                        noise on an inventory row. Secondary line now renders
                        only when genuine inventory info (unit price, or
                        equipment attachment) exists, so rows with neither
                        stay a single clean line (no blank placeholder). */}
                    {(p.unitPrice || eqName) && (
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {p.unitPrice && (
                          <span className="text-[10px] text-slate-400">${p.unitPrice}</span>
                        )}
                        {/* Equipment pill — shown only when this part was
                            attached to a specific piece of equipment. Helps
                            spot wrong-equipment duplicates at a glance. */}
                        {eqName && (
                          <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 max-w-[140px]">
                            <Wrench className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{eqName}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-xs font-semibold text-slate-500">×{p.quantity}</span>
                    {!isTerminal && !confirming && (
                      <button
                        onClick={() => setConfirmDeletePartId(p.id)}
                        aria-label="Remove part"
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    {!isTerminal && confirming && (
                      <>
                        <button
                          onClick={() => setConfirmDeletePartId(null)}
                          aria-label="Cancel remove"
                          className="min-h-[44px] px-2.5 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => deletePart.mutateAsync(p.id)
                            .then(() => { setConfirmDeletePartId(null); showSuccess("Part removed"); })
                            .catch((err: any) => { setConfirmDeletePartId(null); showError(err); })}
                          disabled={deletePart.isPending}
                          aria-label="Confirm remove part"
                          className="min-h-[44px] px-2.5 rounded-md text-xs font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-60 flex items-center gap-1"
                        >
                          {deletePart.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            }) : (
              <EmptyState icon={Package} message="No parts added" className="py-6" />
            )}
          </div>
        )}
      </div>

      {/* ══════ SHEETS / MODALS ══════ */}
      {showOutcome && <OutcomeModal onSelect={handleComplete} onCancel={() => setShowOutcome(false)} />}
      {/* EquipmentSheet modal removed — equipment card opens detail screen directly */}
      {addPartForEquipment !== undefined && (
        <AddPartSheet
          equipmentId={addPartForEquipment}
          equipmentName={addPartForEquipment ? (visit.equipment.find(e => e.id === addPartForEquipment)?.name ?? null) : null}
          recentParts={visit.parts}
          // onClose is invoked on backdrop dismiss, X tap, AND after a
          // successful add. The success toast is now driven by the sheet's
          // explicit `onSuccess`, not `onClose`, so dismissing without
          // adding no longer announces a false "Part added".
          onClose={() => setAddPartForEquipment(undefined)}
          onSuccess={() => showSuccess("Part added")}
          addPart={addPart}
          onError={showError}
        />
      )}
      {showAddEquipment && (
        <AddEquipmentSheet
          visitId={visitId}
          onClose={() => setShowAddEquipment(false)}
          onSuccess={() => showSuccess("Equipment added")}
          addEquipment={addEquipment}
          onError={showError}
        />
      )}
      {historyEquipmentId && (
        <EquipmentDetailScreen
          equipmentId={historyEquipmentId}
          equipment={visit.equipment}
          isTerminal={isTerminal}
          onClose={() => setHistoryEquipmentId(null)}
          onAddNote={(eqId) => { setHistoryEquipmentId(null); setNoteEquipmentId(eqId); setActiveTab("Notes"); }}
          onRemove={(jobEquipmentId) => { setHistoryEquipmentId(null); handleRemoveEquipment(jobEquipmentId); }}
        />
      )}
      {editingNote && (
        <NoteEditSheet
          note={editingNote}
          isUpdating={updateNote.isPending}
          isDeleting={deleteNote.isPending}
          onSave={handleUpdateNote}
          onDelete={handleDeleteNote}
          onClose={() => setEditingNote(null)}
        />
      )}
    </MobileShell>
  );
}

// ── Shared note components ──

function NoteCard({
  note,
  currentUserId,
  onEdit,
}: {
  note: DetailNote;
  currentUserId: string | null;
  onEdit: (note: DetailNote) => void;
}) {
  // 2026-04-14 Fix E: the author may tap their own note to open the edit
  // sheet. Non-authors see a read-only card (server enforces author-only
  // regardless, but we hide the affordance so the tap target is honest).
  const canEdit = !!currentUserId && note.userId === currentUserId;
  const interactive = canEdit
    ? "cursor-pointer hover:bg-slate-50 active:bg-slate-100 transition-colors"
    : "";
  return (
    <div
      className={`rounded-md border border-slate-200 bg-white p-3 ${interactive}`}
      onClick={canEdit ? () => onEdit(note) : undefined}
      role={canEdit ? "button" : undefined}
      data-testid={`note-card-${note.id}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-500">{note.author}</span>
        <span className="text-xs text-slate-400">
          {new Date(note.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      <p className="text-xs text-slate-700 leading-relaxed">{note.text}</p>
      {note.attachments && note.attachments.length > 0 && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <NoteAttachmentStrip attachments={note.attachments} />
        </div>
      )}
    </div>
  );
}

/**
 * 2026-04-14 Fix E: lightweight mobile-native bottom sheet for editing a
 * single note. Author-only (NoteCard only opens it for the author). Reuses
 * the canonical tech mutations in useTechVisitDetail — no new endpoints.
 * Delete uses a two-tap confirm inline (same pattern as equipment remove).
 */
function NoteEditSheet({
  note,
  isUpdating,
  isDeleting,
  onSave,
  onDelete,
  onClose,
}: {
  note: DetailNote;
  isUpdating: boolean;
  isDeleting: boolean;
  onSave: (noteId: string, text: string) => Promise<void> | void;
  onDelete: (noteId: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [text, setText] = useState(note.text);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = text.trim().length > 0 && text !== note.text;
  const busy = isUpdating || isDeleting;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      {/* backdrop tap closes */}
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 w-full h-full cursor-default"
        onClick={busy ? undefined : onClose}
      />
      <div
        className="relative w-full bg-white rounded-t-xl shadow-xl p-3 space-y-3 max-h-[85vh] overflow-y-auto"
        data-testid="note-edit-sheet"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">Edit note</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter saves the edit (same pattern as the compose
            // textarea). Guard on dirty + not busy so repeat presses do
            // not double-fire while a save is in flight.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && dirty && !busy) {
              e.preventDefault();
              void onSave(note.id, text.trim());
            }
          }}
          disabled={busy}
          rows={6}
          className="w-full text-xs border border-slate-200 rounded-md px-3 py-2 resize-none disabled:bg-slate-50"
          data-testid="input-note-edit-text"
        />

        {note.attachments && note.attachments.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase mb-1">Attachments</p>
            <NoteAttachmentStrip attachments={note.attachments} />
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="h-9 px-3 rounded-md border border-red-200 text-red-600 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              data-testid="button-note-delete"
            >
              <Trash2 className="h-3.5 w-3.5" />Delete
            </button>
          ) : (
            <>
              <span className="text-xs text-red-600">Delete this note?</span>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="h-9 px-2 rounded-md text-xs text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onDelete(note.id)}
                disabled={busy}
                className="h-9 px-3 rounded-md bg-red-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
                data-testid="button-note-delete-confirm"
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete
              </button>
            </>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 px-3 rounded-md text-xs text-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSave(note.id, text.trim())}
            disabled={busy || !dirty}
            className="h-9 px-4 rounded-md bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:bg-slate-300"
            data-testid="button-note-save"
          >
            {isUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Staged attachment descriptor. `previewUrl` is created once on pick
 * (not during render) and revoked on removal / unmount to avoid
 * leaking blob: URLs in the tab's allocation table.
 */
interface StagedAttachment {
  file: File;
  previewUrl?: string;
}

function NoteInput({ equipmentId, equipment, onEquipmentChange, onSubmit, isPending, lockedEquipment, isOnline, onBlocked }: {
  equipmentId: string | null;
  equipment: DetailEquipment[];
  onEquipmentChange: (id: string | null) => void;
  onSubmit: (text: string, equipmentId: string | null, files: File[]) => void | Promise<void>;
  isPending: boolean;
  lockedEquipment?: boolean;
  /** 2026-04-14: attachments require a network — disabled offline. */
  isOnline: boolean;
  /** Surfaces a user-visible message when a submit is intentionally
   *  rejected client-side (e.g. attachments staged while offline). */
  onBlocked?: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  // 2026-04-14 Fix C: open one of the staged images in a fullscreen preview.
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  // Tracks the full note+upload sequence so the spinner stays on until
  // attachments have finished uploading, not just the note POST.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Revoke any still-live preview URLs on unmount.
  useEffect(() => {
    return () => {
      staged.forEach((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-04-14 Fix D: close the attach menu on outside tap or Escape.
  // The menu previously only closed inside handlePick, so a cancelled
  // native picker left the menu open ("stuck" state).
  useEffect(() => {
    if (!showAttachMenu) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) setShowAttachMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAttachMenu(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showAttachMenu]);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    const valid: StagedAttachment[] = [];
    for (const f of picked) {
      const err = validateFileClientSide(f);
      if (err) continue; // silent skip; page-level toast is heavyweight for tech UI
      valid.push({
        file: f,
        previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      });
    }
    setStaged((prev) => {
      const next = [...prev, ...valid].slice(0, 5);
      // If the 5-item cap dropped any newly picked item, revoke its URL.
      const kept = new Set(next);
      for (const s of valid) {
        if (!kept.has(s) && s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      }
      return next;
    });
    // Reset the input so selecting the same file twice in a row still
    // fires `onChange` — browsers skip duplicate values otherwise.
    if (e.target) e.target.value = "";
    setShowAttachMenu(false);
  };
  const removeStaged = (i: number) =>
    setStaged((prev) => {
      const removed = prev[i];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, idx) => idx !== i);
    });

  const pending = isPending || isSubmitting;

  // 2026-04-14 Fix D: whenever a picker button is tapped we close the
  // attach menu immediately (before opening the native file dialog). If
  // the user cancels the picker, the menu is already closed — no stuck
  // state. Reopening the menu is a single tap.
  const openPicker = (which: "camera" | "photo" | "file") => {
    setShowAttachMenu(false);
    const target =
      which === "camera" ? cameraRef.current :
      which === "photo" ? photoRef.current :
      fileRef.current;
    target?.click();
  };

  const handleSubmit = async () => {
    // Backend requires a non-empty note body; attachments-only is not a
    // valid note. Also rejects rapid repeat taps while a submission is
    // in flight.
    if (!text.trim() || pending) return;
    // 2026-04-14 guard: do not drop attachments into the offline text
    // queue. Block the submit, keep the form intact, surface a clear
    // message. Note: we do NOT clear text or staged here.
    if (!isOnline && staged.length > 0) {
      onBlocked?.("Reconnect to send attachments.");
      return;
    }
    const snapshotText = text.trim();
    const snapshotFiles = staged.map((s) => s.file);
    const snapshotUrls = staged
      .map((s) => s.previewUrl)
      .filter((u): u is string => typeof u === "string");
    setText("");
    setStaged([]);
    setIsSubmitting(true);
    try {
      await Promise.resolve(onSubmit(snapshotText, equipmentId, snapshotFiles));
    } finally {
      setIsSubmitting(false);
      // Snapshot object URLs are no longer referenced by the component;
      // uploader has the raw File objects.
      snapshotUrls.forEach((u) => URL.revokeObjectURL(u));
    }
  };
  const selectedEq = equipment.find(e => e.id === equipmentId);
  const attachmentsDisabled = pending || !isOnline;
  const previewStaged = previewIdx !== null ? staged[previewIdx] : null;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
      {lockedEquipment && selectedEq ? (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200">
          <Wrench className="h-3 w-3 text-emerald-600 shrink-0" />
          <span className="text-xs font-medium text-emerald-700 truncate">{selectedEq.name}</span>
        </div>
      ) : equipment.length > 0 ? (
        <select value={equipmentId ?? ""} onChange={e => onEquipmentChange(e.target.value || null)}
          className="w-full h-8 text-xs border border-slate-200 rounded-md px-2 bg-white text-slate-600">
          <option value="">General note</option>
          {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
        </select>
      ) : null}
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter submits without losing the newline-friendly
            // Enter default. Shift+Enter still inserts a newline (browser
            // default unchanged). Matches the common "compose" pattern.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={pending}
          placeholder={lockedEquipment && selectedEq ? `Note for ${selectedEq.name}…` : "Add a note…"}
          enterKeyHint="send"
          // NoteInput is conditionally rendered inside the Notes tab, so
          // mounting === tab activation. Auto-focusing the textarea on mount
          // means switching to Notes immediately raises the soft keyboard
          // and saves the tech a tap-to-focus.
          autoFocus
          className="flex-1 text-xs border border-slate-200 rounded-md px-3 py-2 resize-none h-16 disabled:bg-slate-50" />
        <div className="flex flex-col gap-1 relative" ref={menuRef}>
          {/* 2026-04-14 Fix F: quick camera shortcut. Direct tap into the
              same canonical compose+submit pipeline — no separate flow. */}
          <button type="button"
            onClick={() => openPicker("camera")}
            disabled={attachmentsDisabled}
            className="h-8 w-8 rounded-md bg-slate-100 text-slate-600 flex items-center justify-center disabled:opacity-50"
            aria-label={isOnline ? "Take photo" : "Camera requires connection"}
            title={isOnline ? "Take photo" : "Camera requires connection"}
            data-testid="button-note-camera"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
          <button type="button"
            onClick={() => setShowAttachMenu((v) => !v)}
            disabled={attachmentsDisabled}
            className="h-8 w-8 rounded-md bg-slate-100 text-slate-600 flex items-center justify-center disabled:opacity-50"
            aria-label={isOnline ? "Attach file" : "Attachments require connection"}
            title={isOnline ? "Attach file" : "Attachments require connection"}
            data-testid="button-note-attach"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleSubmit} disabled={!text.trim() || pending}
            aria-label="Send note"
            className="min-h-[44px] min-w-[44px] rounded-md bg-emerald-600 text-white flex items-center justify-center disabled:bg-slate-200"
            data-testid="button-note-submit">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
          {showAttachMenu && isOnline && (
            <div className="absolute right-10 top-0 z-20 w-40 rounded-md border border-slate-200 bg-white shadow-md overflow-hidden">
              <button type="button"
                className="w-full px-3 py-2 text-left text-xs hover:bg-slate-50"
                onClick={() => openPicker("camera")}
                data-testid="option-take-photo"
              >Take photo</button>
              <button type="button"
                className="w-full px-3 py-2 text-left text-xs hover:bg-slate-50"
                onClick={() => openPicker("photo")}
                data-testid="option-choose-photo"
              >Choose photo</button>
              <button type="button"
                className="w-full px-3 py-2 text-left text-xs hover:bg-slate-50"
                onClick={() => openPicker("file")}
                data-testid="option-choose-file"
              >Choose file</button>
            </div>
          )}
        </div>
      </div>
      {!isOnline && (
        <p className="text-[10px] text-slate-500 -mt-1">Attachments require connection.</p>
      )}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment"
        className="hidden" onChange={handlePick} />
      <input ref={photoRef} type="file" accept="image/*"
        className="hidden" onChange={handlePick} />
      <input ref={fileRef} type="file" multiple accept={SUPPORTED_MIME_TYPES.join(",")}
        className="hidden" onChange={handlePick} />
      {/* 2026-04-14 Fix C: thumbnail grid for images, chip row for non-images. */}
      {staged.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {staged.map((s, i) => {
            const isImage = !!s.previewUrl;
            return (
              <div key={i} className="relative">
                {isImage ? (
                  <button
                    type="button"
                    onClick={() => setPreviewIdx(i)}
                    className="block h-16 w-16 rounded-md overflow-hidden border border-slate-200 bg-slate-50 active:opacity-80"
                    aria-label={`Preview ${s.file.name}`}
                    data-testid={`staged-preview-${i}`}
                  >
                    <img src={s.previewUrl!} alt="" className="h-full w-full object-cover" />
                  </button>
                ) : (
                  <div className="h-16 w-16 rounded-md border border-slate-200 bg-slate-50 flex flex-col items-center justify-center px-1">
                    <FileIcon className="h-4 w-4 text-slate-400" />
                    <span className="text-[9px] text-slate-500 truncate w-full text-center leading-tight mt-0.5">
                      {s.file.name}
                    </span>
                  </div>
                )}
                <button type="button" onClick={() => removeStaged(i)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-slate-700 text-white flex items-center justify-center shadow"
                  aria-label={`Remove ${s.file.name}`}
                  data-testid={`staged-remove-${i}`}
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {/* 2026-04-14 Fix C: tap-to-preview fullscreen overlay. Uses the
          local `previewUrl` only — no server URL resolution for
          pre-submission staged files. */}
      {previewStaged && previewStaged.previewUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewIdx(null)}
          data-testid="staged-preview-modal"
        >
          <img
            src={previewStaged.previewUrl}
            alt={previewStaged.file.name}
            className="max-h-full max-w-full object-contain"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPreviewIdx(null); }}
            className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/10 text-white flex items-center justify-center"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
