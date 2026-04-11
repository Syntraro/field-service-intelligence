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
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Navigation, MapPin, StickyNote, AlertCircle, Check,
  Loader2, RefreshCw, Send, Plus, Wrench, Package, Trash2,
  ChevronRight, Search, X, FileText, Clock, Pause,
} from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useTechVisitDetail,
  type DetailNote, type DetailEquipment,
} from "../hooks/useTechVisitDetail";
import {
  STATUS_LABELS, OUTCOME_LABELS, OUTCOME_COLORS, DEFAULT_OUTCOME_COLOR,
} from "../utils/visitDisplay";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const outcomes = [
    { key: "completed", label: "Completed", desc: "Work finished successfully", cls: "border-emerald-400 bg-emerald-50" },
    { key: "needs_parts", label: "Needs Parts", desc: "Waiting on parts to continue", cls: "border-amber-400 bg-amber-50" },
    { key: "needs_followup", label: "Needs Follow-Up", desc: "Additional visit required", cls: "border-blue-400 bg-blue-50" },
  ];
  const needsNote = selected === "needs_parts" || selected === "needs_followup";
  const canSubmit = selected && (!needsNote || note.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-5 space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-slate-900">Visit Outcome</h2>
        <div className="space-y-2">
          {outcomes.map(o => (
            <button key={o.key} onClick={() => setSelected(o.key)}
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

function AddPartSheet({ equipmentId, onClose, addPart, onError }: {
  equipmentId: string | null;
  onClose: () => void;
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

  // 2026-04-10 Phase C: canonical search hook. Fires after 2 chars; same
  // /api/items endpoint, same caching, same normalized ProductOption[] shape
  // as every office selector.
  const { data: searchResults = [], isLoading: isSearchLoading } = useProductSearch(searchText);

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
      onClose();
    } catch (err: any) { onError(err); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-4 shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">Add Part</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-slate-100"><X className="h-4 w-4 text-slate-400" /></button>
        </div>
        {!selected ? (
          <>
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
                searchLoading={isSearchLoading}
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
                  type="number" step="0.01" className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
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
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Quantity</label>
              <input value={qty} onChange={e => setQty(e.target.value)} type="number" min="1" step="1"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
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

function AddEquipmentSheet({ visitId, onClose, addEquipment, onError }: {
  visitId: string;
  onClose: () => void;
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
  const { data: locationEquip } = useQuery<any[]>({
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
      if (created?.id) onClose(); // Auto-attached by the endpoint
    } catch (err: any) { onError(err); }
    finally { setCreatePending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-4 shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">Add Equipment</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-slate-100"><X className="h-4 w-4 text-slate-400" /></button>
        </div>
        {!creating ? (
          <>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search location equipment…"
                className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-md" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1 -mx-1">
              {filtered.map((e: any) => (
                <button key={e.id} onClick={() => handleSelect(e.id)} disabled={addEquipment.isPending}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50 rounded-md">
                  <p className="text-sm font-medium text-slate-800">{e.name}</p>
                  <p className="text-xs text-slate-400">{[e.equipmentType, e.serialNumber].filter(Boolean).join(" · ")}</p>
                </button>
              ))}
              {filtered.length === 0 && search.length > 0 && (
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
  const jobHistory = (!historyLoading && timeline.data && eqNotes.data)
    ? buildJobHistory(timeline.data, eqNotes.data) : [];
  const historyEmpty = !historyLoading && jobHistory.length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
      {/* Compact header */}
      <div className="bg-[#0f1a2e] px-3 pt-2 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-1 -ml-1 rounded-md hover:bg-white/10"><ArrowLeft className="h-4 w-4 text-white" /></button>
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
        <button onClick={onBack} className="p-1 rounded-md active:bg-slate-100"><ArrowLeft className="h-5 w-5 text-slate-600" /></button>
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
    startTravel, startJob, complete, addNote, addPart, deletePart, removeEquipment, addEquipment,
    updateVisitNotes, updateJob,
    // 2026-04-09: reversible workflow controls + pause/resume
    cancelRoute, cancelStart, pauseJob, resumeJob,
  } = useTechVisitDetail(visitId);

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
    if (err?.code === "VERSION_MISMATCH" || err?.status === 409) {
      setActionError("This record was updated elsewhere. Refresh and try again.");
    } else {
      setActionError(err?.message || "Failed");
    }
  };

  const handleStartTravel = async () => {
    setActionError(null);
    try { await startTravel.mutateAsync(); showSuccess("En route"); } catch (err: any) { showError(err); }
  };
  const handleStartJob = async () => {
    setActionError(null);
    try { await startJob.mutateAsync(); showSuccess("On site — job started"); } catch (err: any) { showError(err); }
  };
  // 2026-04-09: reversible workflow + pause/resume handlers.
  // Sub-1-minute time entries created by accidental taps are dropped on the
  // server (timeTrackingRepository.stopAndDiscardIfTrivial) so the tech does
  // not see phantom 5-second segments in payroll.
  const handleCancelRoute = async () => {
    setActionError(null);
    try { await cancelRoute.mutateAsync(); showSuccess("Route cancelled"); } catch (err: any) { showError(err); }
  };
  const handleCancelStart = async () => {
    setActionError(null);
    try { await cancelStart.mutateAsync(); showSuccess("Start cancelled — back to en route"); } catch (err: any) { showError(err); }
  };
  const handlePauseJob = async () => {
    setActionError(null);
    try { await pauseJob.mutateAsync(); showSuccess("Paused"); } catch (err: any) { showError(err); }
  };
  const handleResumeJob = async () => {
    setActionError(null);
    try { await resumeJob.mutateAsync(); showSuccess("Resumed"); } catch (err: any) { showError(err); }
  };
  const handleComplete = async (outcome: string, outcomeNote?: string) => {
    setActionError(null); setShowOutcome(false);
    try { await complete.mutateAsync({ outcome, outcomeNote }); showSuccess("Visit completed"); } catch (err: any) { showError(err); }
  };
  const handleAddNote = async (text: string, equipmentId?: string | null) => {
    setActionError(null);
    try {
      await addNote.mutateAsync({ text, equipmentId });
      // Invalidate equipment history queries so notes appear in equipment detail screen
      if (equipmentId) {
        queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipmentId, "notes"] });
        queryClient.invalidateQueries({ queryKey: ["/api/equipment", equipmentId, "timeline"] });
        queryClient.invalidateQueries({ queryKey: ["equipment-history", equipmentId] });
      }
      showSuccess("Note saved");
      setNoteEquipmentId(null);
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
          <button onClick={onBack} className="p-1 -ml-1 rounded-md hover:bg-white/10 transition-colors">
            <ArrowLeft className="h-4 w-4 text-white" />
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
          <button className="flex items-center gap-1 text-sm font-semibold text-[#76B054] shrink-0 ml-2 px-2 py-1 rounded-md hover:bg-[#76B054]/10 transition-colors">
            <Navigation className="h-3 w-3" />Directions
          </button>
        </div>
      </div>

      {/* ══════ TIMER STRIP ══════ */}
      {/* 2026-04-09: indicator + label color change for paused state.
          Reversible Cancel buttons sit on the en_route and on-site strips.
          Pause/Resume sits on the on-site / paused strip. Sub-1-min segments
          are discarded server-side; the UI just calls the canonical actions. */}
      {isActive && !isTerminal && (
        <div className={`px-3 py-1.5 flex items-center gap-2 ${isPaused ? "bg-amber-100" : "bg-[#22c55e]/10"}`}>
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${isPaused ? "bg-amber-500" : "bg-[#22c55e] animate-pulse"}`} />
          <span className={`text-sm font-semibold ${isPaused ? "text-amber-700" : "text-[#22c55e]"}`}>
            {STATUS_LABELS[visit.status] || visit.status}
          </span>
          <span className={`text-base font-bold tabular-nums ${isPaused ? "text-amber-700" : "text-[#22c55e]"}`}>
            {visit.timerStartedAt && !isPaused ? <LiveTimer startedAt={visit.timerStartedAt} /> : "00:00:00"}
          </span>
          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
            {visit.status === "en_route" && (
              <>
                <button
                  onClick={handleCancelRoute}
                  disabled={anyPending}
                  className="h-8 px-3 rounded-md bg-white border border-slate-300 text-slate-700 text-sm font-semibold flex items-center gap-1.5 active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-cancel-route"
                >
                  {cancelRoute.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Cancel Route
                </button>
                <button
                  onClick={handleStartJob}
                  disabled={anyPending}
                  className="h-8 px-3 rounded-md bg-[#22c55e] text-white text-sm font-bold flex items-center gap-1.5 active:scale-[0.97] disabled:opacity-60"
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
                  className="h-8 w-8 rounded-md bg-white border border-slate-300 text-slate-500 flex items-center justify-center active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-cancel-start"
                  title="Cancel Start"
                  aria-label="Cancel Start"
                >
                  {cancelStart.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-4 w-4" />}
                </button>
                <button
                  onClick={handlePauseJob}
                  disabled={anyPending}
                  className="h-8 w-8 rounded-md bg-amber-100 border border-amber-300 text-amber-600 flex items-center justify-center active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-pause-job"
                  title="Pause"
                  aria-label="Pause"
                >
                  {pauseJob.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => setShowOutcome(true)}
                  disabled={anyPending}
                  className="h-8 px-3 rounded-md bg-[#22c55e] text-white text-sm font-bold flex items-center gap-1.5 active:scale-[0.97] disabled:opacity-60"
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
                  className="h-8 px-3 rounded-md bg-[#22c55e] text-white text-sm font-bold flex items-center gap-1.5 active:scale-[0.97] disabled:opacity-60"
                  data-testid="button-resume-job"
                >
                  {resumeJob.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Resume
                </button>
                <button
                  onClick={() => setShowOutcome(true)}
                  disabled={anyPending}
                  className="h-8 px-3 rounded-md bg-white border border-slate-300 text-slate-700 text-sm font-semibold flex items-center gap-1.5 active:scale-[0.97] disabled:opacity-60"
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

      {/* Toast messages */}
      {actionSuccess && (
        <div className="px-3 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-1.5">
          <Check className="h-3 w-3 text-emerald-600" /><p className="text-xs font-medium text-emerald-700">{actionSuccess}</p>
        </div>
      )}
      {actionError && (
        <div className="px-3 py-1.5 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-600">{actionError}</p>
          <button onClick={() => setActionError(null)} className="text-xs text-red-500 underline mt-0.5">Dismiss</button>
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
            {/* Office-owned fields: read-only in tech app */}
            {visit.visitNotes && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
                <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-1">Visit Instructions</p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{visit.visitNotes}</p>
              </div>
            )}
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
            {visit.equipment.length === 0 && !visit.visitNotes && !visit.jobDescription && !visit.accessInstructions && (
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
            />
            {/* Equipment-grouped notes */}
            {visit.equipment.map(eq => {
              const eqNotes = notesByEquipment.get(eq.id);
              if (!eqNotes?.length) return null;
              return (
                <div key={eq.id}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Wrench className="h-2.5 w-2.5" />{eq.name}
                  </p>
                  {eqNotes.map(n => <NoteCard key={n.id} note={n} />)}
                </div>
              );
            })}
            {/* General notes */}
            {generalNotes.length > 0 && (
              <div>
                {notesByEquipment.size > 0 && (
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">General</p>
                )}
                {generalNotes.map(n => <NoteCard key={n.id} note={n} />)}
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
                    className="p-1.5 rounded-md hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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
            {visit.parts.length > 0 ? visit.parts.map(p => (
              <div key={p.id} className="rounded-md border border-slate-200 bg-white p-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{p.description}</p>
                  <p className="text-[10px] text-slate-400">
                    {new Date(p.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {p.unitPrice && ` · $${p.unitPrice}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-xs font-semibold text-slate-500">×{p.quantity}</span>
                  {!isTerminal && (
                    <button onClick={() => deletePart.mutateAsync(p.id).then(() => showSuccess("Part removed")).catch((err: any) => showError(err))}
                      disabled={deletePart.isPending}
                      className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )) : (
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
          onClose={() => { setAddPartForEquipment(undefined); showSuccess("Part added"); }}
          addPart={addPart}
          onError={showError}
        />
      )}
      {showAddEquipment && (
        <AddEquipmentSheet
          visitId={visitId}
          onClose={() => { setShowAddEquipment(false); showSuccess("Equipment added"); }}
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
    </MobileShell>
  );
}

// ── Shared note components ──

function NoteCard({ note }: { note: DetailNote }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-500">{note.author}</span>
        <span className="text-xs text-slate-400">
          {new Date(note.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      <p className="text-xs text-slate-700 leading-relaxed">{note.text}</p>
    </div>
  );
}

function NoteInput({ equipmentId, equipment, onEquipmentChange, onSubmit, isPending, lockedEquipment }: {
  equipmentId: string | null;
  equipment: DetailEquipment[];
  onEquipmentChange: (id: string | null) => void;
  onSubmit: (text: string, equipmentId?: string | null) => void;
  isPending: boolean;
  lockedEquipment?: boolean;
}) {
  const [text, setText] = useState("");
  const handleSubmit = () => {
    if (!text.trim() || isPending) return;
    onSubmit(text.trim(), equipmentId);
    setText("");
  };
  const selectedEq = equipment.find(e => e.id === equipmentId);
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
      {lockedEquipment && selectedEq ? (
        // Equipment context enforced — show as label, not changeable
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
        <textarea value={text} onChange={e => setText(e.target.value)} disabled={isPending}
          placeholder={lockedEquipment && selectedEq ? `Note for ${selectedEq.name}…` : "Add a note…"}
          className="flex-1 text-xs border border-slate-200 rounded-md px-3 py-2 resize-none h-16 disabled:bg-slate-50" />
        <button onClick={handleSubmit} disabled={!text.trim() || isPending}
          className="self-end h-8 w-8 rounded-md bg-emerald-600 text-white flex items-center justify-center disabled:bg-slate-200">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
