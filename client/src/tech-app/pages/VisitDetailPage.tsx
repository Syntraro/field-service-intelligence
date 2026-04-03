/** Technician PWA — Job Detail
 *  2026-04-03: State-driven single primary action, undo mechanism,
 *  reduced tabs (Overview/Notes/More), equipment-bound input,
 *  quick action bar, compressed header.
 *  2026-04-03: Moved Complete/Pause to header timer strip, added Reopen flow,
 *  equipment modal with Select Existing / Add New, part modal with
 *  catalog + manual create, compact outcome banner, tightened layout.
 *  2026-04-03: Consolidated Start Job into timer strip (en_route state),
 *  full-width CTA now only for scheduled→Start Travel. */

import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, Navigation, MapPin, Wrench, Pause, Play,
  StickyNote, Plus, X, ChevronRight, AlertCircle,
  Camera, Package, Megaphone, Check, RotateCcw,
  Search, AlertTriangle,
} from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { OutcomeModal } from "../components/OutcomeModal";
import { STATUS_LABELS, PRIMARY_ACTION, ACTION_COLORS } from "../utils/visitDisplay";
import type { MockVisit, MockEquipment, MockNote, MockPart, VisitStatus, Outcome } from "../types";

/* ── Confirmation modal for removing active equipment context ── */
function RemoveEquipmentConfirm({ equipmentName, onConfirm, onCancel }: {
  equipmentName: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={onCancel}>
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">Remove equipment from current work?</h2>
        </div>
        <p className="text-[12px] text-slate-600 leading-relaxed">
          This will remove notes, parts, and related work logged for <strong>{equipmentName}</strong> in the current session.
        </p>
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 h-10 rounded-lg border border-slate-200 text-sm font-medium text-slate-600">Cancel</button>
          <button onClick={onConfirm} className="flex-1 h-10 rounded-lg bg-red-600 text-white text-sm font-semibold active:scale-[0.98]">Remove</button>
        </div>
      </div>
    </div>
  );
}

/* ── Timer hook ── */
function useElapsedTimer(startedAt?: string, running?: boolean) {
  const [display, setDisplay] = useState("00:00:00");
  useEffect(() => {
    if (!startedAt || !running) { setDisplay("00:00:00"); return; }
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      const hh = String(Math.floor(s / 3600)).padStart(2, "0");
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      setDisplay(`${hh}:${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, running]);
  return display;
}

/* ── Mock site equipment for "Select Existing" flow ── */
const SITE_EQUIPMENT: MockEquipment[] = [
  { id: "site-eq1", name: "RTU-1 Carrier 48TC", model: "48TC-D16", serial: "2819A44301" },
  { id: "site-eq2", name: "RTU-2 Lennox LGH", model: "LGH120H4", serial: "5721B00892" },
  { id: "site-eq3", name: "Exhaust Fan #1", model: "Dayton 4C661", serial: "EF-2024-0187" },
  { id: "site-eq4", name: "Walk-in Cooler Compressor", model: "Copeland ZB26", serial: "C41905773" },
  { id: "site-eq5", name: "Split AC — Dining Area", model: "Mitsubishi MSZ-GL12", serial: "MSZ-2025-0044" },
];

/* ── Mock Products & Services catalog for part selection ── */
const PARTS_CATALOG = [
  { id: "cat-1", name: "Capacitor 45/5 MFD 440V", price: 18.50 },
  { id: "cat-2", name: "Contactor 30A 24V Coil", price: 24.00 },
  { id: "cat-3", name: "Fan Motor 1/4 HP", price: 89.00 },
  { id: "cat-4", name: "Refrigerant R-410A (25lb)", price: 175.00 },
  { id: "cat-5", name: "Filter 16x25x1 MERV-8", price: 6.50 },
  { id: "cat-6", name: "Thermostat Wire 18/5 (50ft)", price: 32.00 },
  { id: "cat-7", name: "Compressor Relay", price: 42.00 },
  { id: "cat-8", name: "Drain Pan Treatment Tabs (6pk)", price: 12.00 },
  { id: "cat-9", name: "Belt A-48", price: 14.50 },
  { id: "cat-10", name: "Hard Start Kit", price: 35.00 },
];

/* ── Equipment Modal — Select Existing or Add New ── */
function EquipmentModal({ visitEquipmentIds, onSelect, onAdd, onClose }: {
  visitEquipmentIds: string[];
  onSelect: (eq: MockEquipment) => void;
  onAdd: (eq: MockEquipment) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"select" | "add">("select");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [search, setSearch] = useState("");

  // Filter site equipment not already on the visit
  const available = SITE_EQUIPMENT.filter(
    eq => !visitEquipmentIds.includes(eq.id) &&
      (search === "" || eq.name.toLowerCase().includes(search.toLowerCase()) || eq.model?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-slate-900">Equipment</h2>

        {/* Segmented toggle: Select Existing / Add New */}
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          <button onClick={() => setMode("select")}
            className={`flex-1 py-2 text-[11px] font-semibold rounded-md transition-all ${
              mode === "select" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}>Select Existing</button>
          <button onClick={() => setMode("add")}
            className={`flex-1 py-2 text-[11px] font-semibold rounded-md transition-all ${
              mode === "add" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}>Add New</button>
        </div>

        {mode === "select" ? (
          <div className="space-y-2">
            {/* Search filter */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search equipment..."
                className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40" autoFocus />
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {available.length === 0 ? (
                <p className="text-[11px] text-slate-400 py-4 text-center">No equipment found</p>
              ) : available.map(eq => (
                <button key={eq.id} onClick={() => { onSelect(eq); onClose(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 hover:border-[#22c55e] hover:bg-[#22c55e]/5 transition-colors text-left">
                  <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Wrench className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-slate-900 truncate">{eq.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {[eq.model, eq.serial && `S/N: ${eq.serial}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Plus className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Add New form */
          <div className="space-y-2.5">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rooftop Unit #2"
                className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40" autoFocus />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Model</label>
                <input value={model} onChange={e => setModel(e.target.value)} placeholder="Optional"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Serial</label>
                <input value={serial} onChange={e => setSerial(e.target.value)} placeholder="Optional"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-slate-200 text-sm font-medium text-slate-600">Cancel</button>
              <button onClick={() => {
                if (name.trim()) {
                  onAdd({ id: `eq-${Date.now()}`, name: name.trim(), model: model.trim() || undefined, serial: serial.trim() || undefined });
                  onClose();
                }
              }} disabled={!name.trim()} className="flex-1 h-10 rounded-lg bg-[#22c55e] text-white text-sm font-semibold disabled:opacity-40 active:scale-[0.98]">Add</button>
            </div>
          </div>
        )}

        {mode === "select" && (
          <button onClick={onClose} className="w-full h-9 text-sm text-slate-500 font-medium">Cancel</button>
        )}
      </div>
    </div>
  );
}

/* ── Add Part Modal — Products & Services catalog + Create Part ── */
function AddPartModal({ equipmentName, onAdd, onClose }: {
  equipmentName: string;
  onAdd: (part: { name: string; qty: number; price?: number }) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"catalog" | "create">("catalog");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");

  // Catalog qty tracker for inline add
  const [catalogQty, setCatalogQty] = useState<Record<string, number>>({});

  const filtered = PARTS_CATALOG.filter(
    p => search === "" || p.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCatalogAdd = (item: typeof PARTS_CATALOG[0]) => {
    const q = catalogQty[item.id] || 1;
    onAdd({ name: item.name, qty: q, price: item.price });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-slate-900">Add Part</h2>
        <p className="text-[11px] text-slate-500">For: {equipmentName}</p>

        {/* Segmented toggle */}
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          <button onClick={() => setMode("catalog")}
            className={`flex-1 py-2 text-[11px] font-semibold rounded-md transition-all ${
              mode === "catalog" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}>Products & Services</button>
          <button onClick={() => setMode("create")}
            className={`flex-1 py-2 text-[11px] font-semibold rounded-md transition-all ${
              mode === "create" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}>Create Part</button>
        </div>

        {mode === "catalog" ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search catalog..."
                className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40" autoFocus />
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {filtered.length === 0 ? (
                <p className="text-[11px] text-slate-400 py-4 text-center">No items found — try Create Part</p>
              ) : filtered.map(item => (
                <div key={item.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 hover:border-[#22c55e]/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-slate-900 truncate">{item.name}</p>
                    <p className="text-[10px] text-slate-500">${item.price.toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input type="number" min="1" value={catalogQty[item.id] || 1}
                      onChange={e => setCatalogQty(prev => ({ ...prev, [item.id]: parseInt(e.target.value) || 1 }))}
                      className="w-12 h-7 rounded-md border border-slate-200 bg-slate-50 text-center text-[11px] focus:outline-none focus:ring-1 focus:ring-[#22c55e]/40" />
                    <button onClick={() => handleCatalogAdd(item)}
                      className="h-7 px-2.5 rounded-md bg-[#22c55e] text-white text-[10px] font-bold active:scale-[0.97]">Add</button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={onClose} className="w-full h-9 text-sm text-slate-500 font-medium">Cancel</button>
          </div>
        ) : (
          /* Create Part form */
          <div className="space-y-2.5">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Part Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Capacitor 45/5 MFD"
                className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40" autoFocus />
            </div>
            <div className="flex gap-2">
              <div className="w-24">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Qty</label>
                <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Price (optional)</label>
                <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="$0.00"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-slate-200 text-sm font-medium text-slate-600">Cancel</button>
              <button onClick={() => { if (name.trim()) { onAdd({ name: name.trim(), qty: parseInt(qty) || 1, price: price ? parseFloat(price) : undefined }); onClose(); } }}
                disabled={!name.trim()} className="flex-1 h-10 rounded-lg bg-[#22c55e] text-white text-sm font-semibold disabled:opacity-40 active:scale-[0.98]">Add Part</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Notes Sheet (structured, with equipment picker) ── */
function NotesSheet({ onSave, onCancel, equipment, defaultEquipmentId }: {
  onSave: (text: string, equipmentId?: string) => void;
  onCancel: () => void;
  equipment: MockEquipment[];
  defaultEquipmentId?: string;
}) {
  const [text, setText] = useState("");
  const [eqId, setEqId] = useState(defaultEquipmentId || "");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-slate-900">Add Note</h2>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Type your note..."
          className="w-full h-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm resize-none" autoFocus />
        {equipment.length > 0 && (
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Attach to equipment</label>
            <select value={eqId} onChange={e => setEqId(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs">
              <option value="">General note</option>
              {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 h-10 rounded-lg border border-slate-200 text-sm font-medium text-slate-600">Cancel</button>
          <button onClick={() => { if (text.trim()) onSave(text.trim(), eqId || undefined); }}
            disabled={!text.trim()} className="flex-1 h-10 rounded-lg bg-[#22c55e] text-white text-sm font-semibold disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  );
}

/* ── Undo Toast ── */
function UndoToast({ message, onUndo, onDismiss }: { message: string; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, 5000);
    return () => clearTimeout(id);
  }, [onDismiss]);
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-md">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center justify-between shadow-lg">
        <span className="text-[12px] font-medium">{message}</span>
        <button onClick={onUndo} className="text-[12px] font-bold text-[#22c55e] ml-3 shrink-0">Undo</button>
      </div>
    </div>
  );
}

/* ── Tabs ── */
const TABS = ["Overview", "Notes", "More"] as const;
type Tab = typeof TABS[number];

/* ── Outcome label helpers ── */
const OUTCOME_LABELS: Record<Outcome, string> = {
  completed: "Completed",
  needs_parts: "Needs Parts",
  needs_followup: "Needs Follow-Up",
  on_hold: "On Hold",
};
const OUTCOME_COLORS: Record<Outcome, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  needs_parts: "bg-amber-100 text-amber-700",
  needs_followup: "bg-blue-100 text-blue-700",
  on_hold: "bg-red-100 text-red-700",
};

/* ================================================================== */
/*  VisitDetailPage — main export                                     */
/* ================================================================== */
export function VisitDetailPage({
  visit, onBack, onStatusChange, onOutcome, onReopen, onAddNote, onAddEquipment, onRemoveEquipment, onAddPart,
  onClearEquipmentWork,
}: {
  visit: MockVisit;
  onBack: () => void;
  onStatusChange: (id: string, newStatus: VisitStatus) => void;
  onOutcome: (id: string, outcome: Outcome) => void;
  onReopen: (id: string) => void;
  onAddNote: (id: string, text: string, equipmentId?: string) => void;
  onAddEquipment?: (visitId: string, equipment: MockEquipment) => void;
  onRemoveEquipment?: (visitId: string, equipmentId: string) => void;
  onAddPart?: (visitId: string, part: Omit<MockPart, "id">) => void;
  /** Remove equipment-scoped notes/parts for active context without deleting the equipment itself */
  onClearEquipmentWork?: (visitId: string, equipmentId: string) => void;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [showOutcome, setShowOutcome] = useState(false);
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [showAddPart, setShowAddPart] = useState(false);
  const [paused, setPaused] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  // Confirmation modal for removing active equipment work context
  const [confirmRemoveEqId, setConfirmRemoveEqId] = useState<string | null>(null);
  const confirmRemoveEquipment = confirmRemoveEqId ? visit.equipment.find(e => e.id === confirmRemoveEqId) : null;

  // Equipment selection for equipment-bound input
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);
  const selectedEquipment = visit.equipment.find(e => e.id === selectedEquipmentId) || null;

  // Undo mechanism
  const [undoState, setUndoState] = useState<{ prevStatus: VisitStatus; message: string } | null>(null);

  const isTerminal = visit.status === "completed" || visit.status === "on_hold";
  const isActive = visit.status === "en_route" || visit.status === "in_progress";
  const isOnSite = visit.status === "in_progress";
  const isTimerActive = isActive && !paused;
  const elapsed = useElapsedTimer(visit.workStartedAt, isTimerActive);

  const dismissUndo = useCallback(() => setUndoState(null), []);

  // State-driven primary action
  const handlePrimaryAction = () => {
    if (isTerminal) return;
    const prevStatus = visit.status;
    if (visit.status === "scheduled") {
      onStatusChange(visit.id, "en_route");
      setUndoState({ prevStatus, message: "Marked as En Route" });
    } else if (visit.status === "en_route") {
      onStatusChange(visit.id, "in_progress");
      setUndoState({ prevStatus, message: "Marked as On Site" });
    }
  };

  const handleUndo = () => {
    if (undoState) {
      onStatusChange(visit.id, undoState.prevStatus);
      setUndoState(null);
    }
  };

  const handleReopen = () => {
    onReopen(visit.id);
    setPaused(false);
  };

  // Notes sheet with optional equipment pre-selection
  const [noteDefaultEqId, setNoteDefaultEqId] = useState<string | undefined>();
  const openNoteSheet = (equipmentId?: string) => {
    setNoteDefaultEqId(equipmentId);
    setShowNotes(true);
  };

  return (
    <MobileShell showNav>
      {/* ══════ COMPRESSED HEADER ══════ */}
      <div className="bg-[#0f1a2e] px-3 pt-2 pb-2">
        {/* Row 1: Back + Title */}
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-1 -ml-1 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="h-4 w-4 text-white" />
          </button>
          <h1 className="text-[13px] font-bold text-white leading-tight truncate flex-1">{visit.jobTitle}</h1>
        </div>
        {/* Row 2: Time + Company */}
        <p className="text-[11px] text-slate-400 mt-0.5 pl-7">
          {visit.scheduledTime} – {visit.scheduledEnd} <span className="text-slate-600">·</span> {visit.company}
        </p>
        {/* Row 3: Address + Directions */}
        <div className="flex items-center justify-between mt-0.5 pl-7">
          <div className="flex items-center gap-1 text-[10px] text-slate-500 min-w-0 flex-1 truncate">
            <MapPin className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{visit.address}</span>
          </div>
          <button className="flex items-center gap-1 text-[11px] font-semibold text-[#76B054] shrink-0 ml-2 px-2 py-1 rounded-lg hover:bg-[#76B054]/10 transition-colors">
            <Navigation className="h-3 w-3" />Directions
          </button>
        </div>
      </div>

      {/* ══════ TIMER STRIP — unified action row for all active states ══════ */}
      {isActive && !isTerminal && (
        <div className={`px-3 py-1.5 flex items-center gap-2 ${
          paused ? "bg-amber-50" : "bg-[#22c55e]/10"
        }`}>
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${paused ? "bg-amber-400" : "bg-[#22c55e] animate-pulse"}`} />
          <span className={`text-[11px] font-semibold ${paused ? "text-amber-700" : "text-[#22c55e]"}`}>
            {paused ? "Paused" : STATUS_LABELS[visit.status]}
          </span>
          <span className={`text-[14px] font-bold tabular-nums ${paused ? "text-amber-600" : "text-[#22c55e]"}`}>{elapsed}</span>
          {/* Right-aligned: Pause + primary action (Start Job or Complete) */}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setPaused(!paused)}
              className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[11px] font-semibold transition-all ${
                paused ? "bg-[#22c55e]/20 text-[#22c55e]" : "bg-white/80 text-slate-600 border border-slate-200"
              }`}>
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {paused ? "Resume" : "Pause"}
            </button>
            {visit.status === "en_route" && (
              <button onClick={handlePrimaryAction}
                className="h-8 px-3 rounded-lg bg-[#22c55e] text-white text-[11px] font-bold flex items-center gap-1.5 active:scale-[0.97] transition-all shadow-sm">
                Start Job
              </button>
            )}
            {isOnSite && (
              <button onClick={() => setShowOutcome(true)}
                className="h-8 px-3 rounded-lg bg-[#22c55e] text-white text-[11px] font-bold flex items-center gap-1.5 active:scale-[0.97] transition-all shadow-sm">
                <Check className="h-3.5 w-3.5" />Complete
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══════ OUTCOME BANNER — compact status chip ══════ */}
      {visit.outcome && (
        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${OUTCOME_COLORS[visit.outcome]}`}>
            {OUTCOME_LABELS[visit.outcome]}
          </span>
          <span className="text-[10px] text-slate-400">Visit outcome set</span>
          <button onClick={handleReopen}
            className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors">
            <RotateCcw className="h-3 w-3" />Reopen
          </button>
        </div>
      )}

      {/* ══════ PRIMARY ACTION BUTTON (scheduled only — Start Travel) ══════ */}
      {!isTerminal && visit.status === "scheduled" && (
        <div className="px-3 py-2 bg-white border-b border-slate-100">
          <button
            onClick={handlePrimaryAction}
            className={`w-full h-11 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-all ${
              ACTION_COLORS[visit.status] || "bg-slate-200 text-slate-600"
            }`}
          >
            {PRIMARY_ACTION[visit.status]}
          </button>
        </div>
      )}

      {/* ══════ EQUIPMENT CONTEXT BAR — label + dismiss only (Note/Part actions live on equipment card) ══════ */}
      {selectedEquipment && (
        <div className="px-3 py-2 bg-[#22c55e]/10 border-b border-[#22c55e]/20 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Wrench className="h-3 w-3 text-[#22c55e] shrink-0" />
            <span className="text-[11px] font-semibold text-[#166534] truncate">Working on: {selectedEquipment.name}</span>
          </div>
          <button onClick={() => setConfirmRemoveEqId(selectedEquipment.id)}
            className="p-1 rounded-md hover:bg-[#22c55e]/15 text-[#22c55e]/60 shrink-0"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* ══════ TABS ══════ */}
      <div className="flex border-b border-slate-200 bg-white px-1" style={{ scrollbarWidth: "none" }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 px-3 py-2 text-[11px] font-semibold whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab ? "text-[#22c55e] border-[#22c55e]" : "text-slate-400 border-transparent hover:text-slate-600"
            }`}>{tab}</button>
        ))}
      </div>

      {/* ══════ TAB CONTENT — reduced bottom padding since Complete moved to header ══════ */}
      <div className="px-3 py-2.5 pb-28">

        {/* ── Overview: Instructions -> Description -> Equipment ── */}
        {activeTab === "Overview" && (
          <div className="space-y-2">
            {/* 1. Visit Instructions — priority block */}
            {visit.instructions && (
              <div className="rounded-xl bg-amber-50 border border-amber-200/60 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Visit Instructions</span>
                </div>
                <p className="text-[12px] text-amber-900 leading-relaxed">{visit.instructions}</p>
              </div>
            )}

            {/* 2. Job Description */}
            {visit.description && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Job Description</p>
                <p className="text-[12px] text-slate-600 leading-relaxed">{visit.description}</p>
              </div>
            )}

            {/* 3. Equipment Section — tap to select (green highlight), parts nested per-card */}
            {visit.equipment.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 px-1">Equipment</p>
                <div className="space-y-1.5">
                  {visit.equipment.map(eq => {
                    const isSelected = selectedEquipmentId === eq.id;
                    const eqParts = visit.parts.filter(p => p.equipmentId === eq.id);
                    const eqNotes = visit.notes.filter(n => n.equipmentId === eq.id);
                    return (
                      <div key={eq.id} className={`rounded-xl border transition-all ${
                        isSelected ? "border-[#22c55e] bg-[#22c55e]/5 ring-1 ring-[#22c55e]/20" : "border-slate-200 bg-white"
                      }`}>
                        {/* Compact row: icon + details left, Note/Part actions right */}
                        <div className="flex items-center gap-2 px-3 py-2">
                          <button
                            onClick={() => setSelectedEquipmentId(isSelected ? null : eq.id)}
                            className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                          >
                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                              isSelected ? "bg-[#22c55e]/15" : "bg-slate-100"
                            }`}>
                              <Wrench className={`h-3.5 w-3.5 ${isSelected ? "text-[#22c55e]" : "text-slate-400"}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-bold text-slate-900 truncate">{eq.name}</p>
                              <p className="text-[9px] text-slate-500 truncate">
                                {[eq.model, eq.serial && `S/N: ${eq.serial}`].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                            {isSelected && <div className="h-2 w-2 rounded-full bg-[#22c55e] shrink-0" />}
                          </button>
                          {/* Note + Part actions — right-aligned, stacked vertically with text labels */}
                          <div className="flex flex-col gap-1 shrink-0">
                            <button onClick={() => openNoteSheet(eq.id)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 text-[10px] font-semibold text-slate-600 active:bg-slate-200">
                              <StickyNote className="h-3 w-3" />Note{eqNotes.length > 0 && ` (${eqNotes.length})`}
                            </button>
                            <button onClick={() => { setSelectedEquipmentId(eq.id); setShowAddPart(true); }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 text-[10px] font-semibold text-slate-600 active:bg-slate-200">
                              <Package className="h-3 w-3" />Part{eqParts.length > 0 && ` (${eqParts.length})`}
                            </button>
                          </div>
                        </div>
                        {/* Parts attached to this equipment */}
                        {eqParts.length > 0 && (
                          <div className="px-3 pb-2 pt-0 border-t border-slate-100 mx-2">
                            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5 mt-1.5">Parts Used</p>
                            {eqParts.map(p => (
                              <div key={p.id} className="flex items-center justify-between py-0.5">
                                <span className="text-[11px] text-slate-600">- {p.name} (Qty: {p.qty})</span>
                                {p.price != null && <span className="text-[10px] text-slate-500">${p.price.toFixed(2)}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!visit.instructions && !visit.description && visit.equipment.length === 0 && (
              <p className="text-[12px] text-slate-400 py-6 text-center">No details available</p>
            )}
          </div>
        )}

        {/* ── Notes — grouped by equipment, then general ── */}
        {activeTab === "Notes" && (() => {
          // Group notes by equipmentId for grouped rendering
          const generalNotes = visit.notes.filter(n => !n.equipmentId);
          const equipmentIds = Array.from(new Set(visit.notes.filter(n => n.equipmentId).map(n => n.equipmentId!)));
          const equipmentGroups = equipmentIds.map(eqId => ({
            equipment: visit.equipment.find(e => e.id === eqId),
            notes: visit.notes.filter(n => n.equipmentId === eqId),
          }));

          return (
            <div className="space-y-2">
              {visit.notes.length === 0 ? (
                <p className="text-[12px] text-slate-400 py-4 text-center">No notes yet</p>
              ) : (
                <div className="space-y-2">
                  {/* Equipment-grouped notes */}
                  {equipmentGroups.map(({ equipment: eq, notes }) => (
                    <div key={eq?.id || "unknown"} className="rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/5 overflow-hidden">
                      <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-[#22c55e]/10">
                        <Wrench className="h-3 w-3 text-[#22c55e]" />
                        <span className="text-[10px] font-bold text-[#166534]">{eq?.name || "Unknown Equipment"}</span>
                      </div>
                      <div className="divide-y divide-[#22c55e]/10">
                        {notes.map(n => (
                          <div key={n.id} className="px-3 py-2">
                            <p className="text-[12px] text-slate-700">{n.text}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {new Date(n.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} — {n.technician}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {/* General notes */}
                  {generalNotes.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                      <div className="px-3 py-1.5 border-b border-slate-200">
                        <span className="text-[10px] font-bold text-slate-500">General</span>
                      </div>
                      <div className="divide-y divide-slate-200">
                        {generalNotes.map(n => (
                          <div key={n.id} className="px-3 py-2">
                            <p className="text-[12px] text-slate-600">{n.text}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {new Date(n.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} — {n.technician}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button onClick={() => openNoteSheet()}
                className="w-full h-9 rounded-lg border border-dashed border-slate-300 text-xs font-semibold text-slate-500 flex items-center justify-center gap-1.5 hover:border-[#22c55e] hover:text-[#22c55e] transition-colors">
                <Plus className="h-3.5 w-3.5" />Add Note
              </button>
            </div>
          );
        })()}

        {/* ── More — leads + misc ── */}
        {activeTab === "More" && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <Megaphone className="h-7 w-7 text-slate-300 mx-auto mb-2" />
              <p className="text-[12px] text-slate-500 mb-3">Spot a sales opportunity?</p>
              <button className="px-5 h-9 rounded-lg bg-[#22c55e] text-white text-xs font-semibold active:scale-[0.97] transition-all">Create Lead</button>
            </div>
          </div>
        )}
      </div>

      {/* ══════ QUICK ACTION BAR (pinned bottom, above nav) — Note/Part/Photo/Equip only ══════ */}
      <div className="fixed bottom-[52px] left-1/2 -translate-x-1/2 w-full max-w-md z-30">
        <div className="bg-white border-t border-slate-200 px-2 py-2 flex gap-1">
          <button onClick={() => openNoteSheet(selectedEquipmentId || undefined)}
            className="flex-1 h-11 rounded-xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center gap-0.5 active:bg-slate-100 transition-colors">
            <StickyNote className="h-4 w-4 text-slate-500" />
            <span className="text-[9px] font-semibold text-slate-500">Note</span>
          </button>
          <button onClick={() => { if (!selectedEquipmentId && visit.equipment.length > 0) setSelectedEquipmentId(visit.equipment[0].id); setShowAddPart(true); }}
            className="flex-1 h-11 rounded-xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center gap-0.5 active:bg-slate-100 transition-colors">
            <Package className="h-4 w-4 text-slate-500" />
            <span className="text-[9px] font-semibold text-slate-500">Part</span>
          </button>
          <button
            className="flex-1 h-11 rounded-xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center gap-0.5 active:bg-slate-100 transition-colors">
            <Camera className="h-4 w-4 text-slate-500" />
            <span className="text-[9px] font-semibold text-slate-500">Photo</span>
          </button>
          <button onClick={() => setShowEquipmentModal(true)}
            className="flex-1 h-11 rounded-xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center gap-0.5 active:bg-slate-100 transition-colors">
            <Wrench className="h-4 w-4 text-slate-500" />
            <span className="text-[9px] font-semibold text-slate-500">Equip</span>
          </button>
        </div>
      </div>

      {/* ══════ MODALS ══════ */}
      {confirmRemoveEquipment && (
        <RemoveEquipmentConfirm
          equipmentName={confirmRemoveEquipment.name}
          onCancel={() => setConfirmRemoveEqId(null)}
          onConfirm={() => {
            // Capture ID before clearing state to avoid stale closure issues
            const eqId = confirmRemoveEquipment.id;
            // Clear local UI state first so banner + card styling update immediately
            setSelectedEquipmentId(null);
            setConfirmRemoveEqId(null);
            // Then clear equipment-scoped session work (notes/parts) via parent
            onClearEquipmentWork?.(visit.id, eqId);
          }}
        />
      )}
      {showOutcome && (
        <OutcomeModal onSelect={outcome => { onOutcome(visit.id, outcome); setShowOutcome(false); }} onCancel={() => setShowOutcome(false)} />
      )}
      {showNotes && (
        <NotesSheet
          onSave={(text, eqId) => { onAddNote(visit.id, text, eqId); setShowNotes(false); }}
          onCancel={() => setShowNotes(false)}
          equipment={visit.equipment}
          defaultEquipmentId={noteDefaultEqId}
        />
      )}
      {showEquipmentModal && (
        <EquipmentModal
          visitEquipmentIds={visit.equipment.map(e => e.id)}
          onSelect={eq => onAddEquipment?.(visit.id, eq)}
          onAdd={eq => onAddEquipment?.(visit.id, eq)}
          onClose={() => setShowEquipmentModal(false)}
        />
      )}
      {showAddPart && selectedEquipment && (
        <AddPartModal
          equipmentName={selectedEquipment.name}
          onAdd={part => onAddPart?.(visit.id, { equipmentId: selectedEquipment.id, ...part })}
          onClose={() => setShowAddPart(false)}
        />
      )}
      {/* Undo toast */}
      {undoState && (
        <UndoToast message={undoState.message} onUndo={handleUndo} onDismiss={dismissUndo} />
      )}
    </MobileShell>
  );
}
