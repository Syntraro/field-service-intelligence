/**
 * Technician PWA — Visit Detail Page (Phase 2: real backend data + actions).
 *
 * 2026-04-04: Rewired from mock state to canonical backend endpoints.
 *   Read: GET /api/tech/visits/:visitId
 *   Actions: en-route, start, complete, add note
 *   All time-entry side effects handled by backend orchestrator.
 *   Equipment read-only (tech write endpoints not available).
 *   Notes: read from backend + add via POST /api/tech/visits/:visitId/notes.
 */

import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, Navigation, MapPin,
  StickyNote, AlertCircle, Check,
  Loader2, RefreshCw, Send,
} from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { useTechVisitDetail, type DetailNote } from "../hooks/useTechVisitDetail";
import {
  STATUS_LABELS, OUTCOME_LABELS, OUTCOME_COLORS, DEFAULT_OUTCOME_COLOR,
} from "../utils/visitDisplay";

// ── Live timer component ──

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [display, setDisplay] = useState("00:00:00");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      setDisplay(
        `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
      );
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [startedAt]);

  return <>{display}</>;
}

// ── Tabs ──

const TABS = ["Overview", "Notes"] as const;
type Tab = typeof TABS[number];

// ── Outcome selection modal ──

function OutcomeModal({ onSelect, onCancel }: {
  onSelect: (outcome: string, note?: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const outcomes = [
    { key: "completed", label: "Completed", desc: "Work finished successfully", selected: "border-emerald-400 bg-emerald-50" },
    { key: "needs_parts", label: "Needs Parts", desc: "Waiting on parts to continue", selected: "border-amber-400 bg-amber-50" },
    { key: "needs_followup", label: "Needs Follow-Up", desc: "Additional visit required", selected: "border-blue-400 bg-blue-50" },
  ];

  const needsNote = selected === "needs_parts" || selected === "needs_followup";
  const canSubmit = selected && (!needsNote || note.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div className="w-full max-w-md bg-white rounded-t-2xl p-5 space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-slate-900">Visit Outcome</h2>
        <div className="space-y-2">
          {outcomes.map(o => (
            <button
              key={o.key}
              onClick={() => setSelected(o.key)}
              className={`w-full text-left p-3 rounded-xl border transition-colors ${
                selected === o.key ? o.selected : "border-slate-200"
              }`}
            >
              <div className="text-sm font-semibold text-slate-800">{o.label}</div>
              <div className="text-xs text-slate-500">{o.desc}</div>
            </button>
          ))}
        </div>
        {needsNote && (
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Required: describe what's needed…"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none h-20"
          />
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 h-10 rounded-lg border border-slate-200 text-sm font-medium text-slate-600">Cancel</button>
          <button
            onClick={() => selected && canSubmit && onSelect(selected, note.trim() || undefined)}
            disabled={!canSubmit}
            className="flex-1 h-10 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:bg-slate-200 disabled:text-slate-400"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Notes section ──

function NotesSection({ notes, onAddNote, isPending }: {
  notes: DetailNote[];
  onAddNote: (text: string) => void;
  isPending: boolean;
}) {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (!text.trim() || isPending) return;
    onAddNote(text.trim());
    setText("");
  };

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={isPending}
            placeholder="Add a note…"
            className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 resize-none h-16 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || isPending}
            className="self-end h-8 w-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center disabled:bg-slate-200 disabled:text-slate-400"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {notes.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <StickyNote className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs font-medium">No notes yet</p>
        </div>
      ) : (
        notes.map(n => (
          <div key={n.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-slate-500">{n.author}</span>
              <span className="text-[10px] text-slate-400">
                {new Date(n.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">{n.text}</p>
          </div>
        ))
      )}
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
        <button onClick={onBack} className="p-1 rounded-md active:bg-slate-100">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <h1 className="text-sm font-semibold text-slate-800">Visit Detail</h1>
      </div>
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <AlertCircle className="h-10 w-10 mb-2 opacity-40" />
        <p className="text-sm font-medium mb-3">Failed to load visit</p>
        <button onClick={onRetry} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold">
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
    startTravel, startJob, complete, addNote,
  } = useTechVisitDetail(visitId);

  const [showOutcome, setShowOutcome] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const onBack = () => setLocation("/tech/today");

  if (isLoading) return <LoadingState />;
  if (isError || !visit) return <ErrorState onBack={onBack} onRetry={refetch} />;

  const isTerminal = visit.status === "completed" || visit.status === "on_hold" || visit.status === "cancelled";
  const isActive = visit.status === "en_route" || visit.status === "in_progress" || visit.status === "on_site";
  const isOnSite = visit.status === "in_progress" || visit.status === "on_site";
  const isScheduled = visit.status === "scheduled" || visit.status === "dispatched";

  const showSuccess = (msg: string) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 3000);
  };

  const handleStartTravel = async () => {
    setActionError(null);
    try { await startTravel.mutateAsync(); showSuccess("En route"); } catch (err: any) { setActionError(err?.message || "Failed to start travel"); }
  };

  const handleStartJob = async () => {
    setActionError(null);
    try { await startJob.mutateAsync(); showSuccess("On site — job started"); } catch (err: any) { setActionError(err?.message || "Failed to start job"); }
  };

  const handleComplete = async (outcome: string, outcomeNote?: string) => {
    setActionError(null);
    setShowOutcome(false);
    try { await complete.mutateAsync({ outcome, outcomeNote }); showSuccess("Visit completed"); } catch (err: any) { setActionError(err?.message || "Failed to complete visit"); }
  };

  const handleAddNote = async (text: string) => {
    setActionError(null);
    try { await addNote.mutateAsync(text); showSuccess("Note saved"); } catch (err: any) { setActionError(err?.message || "Failed to save note"); }
  };

  const anyPending = startTravel.isPending || startJob.isPending || complete.isPending;

  return (
    <MobileShell showNav>
      {/* ══════ COMPRESSED HEADER ══════ */}
      <div className="bg-[#0f1a2e] px-3 pt-2 pb-2">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-1 -ml-1 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="h-4 w-4 text-white" />
          </button>
          <h1 className="text-[13px] font-bold text-white leading-tight truncate flex-1">{visit.jobTitle}</h1>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5 pl-7">
          {visit.scheduledTime} – {visit.scheduledEnd} <span className="text-slate-600">·</span> {visit.company}
        </p>
        <div className="flex items-center justify-between mt-0.5 pl-7">
          <div className="flex items-center gap-1 text-[10px] text-slate-500 min-w-0 flex-1 truncate">
            <MapPin className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{visit.address}</span>
          </div>
          <button className="flex items-center gap-1 text-[11px] font-semibold text-[#76B054] shrink-0 ml-2 px-2 py-1 rounded-lg hover:bg-[#76B054]/10 transition-colors">
            <Navigation className="h-3 w-3" />Directions
          </button>
        </div>
      </div>

      {/* ══════ TIMER STRIP — active states ══════ */}
      {isActive && !isTerminal && (
        <div className="px-3 py-1.5 flex items-center gap-2 bg-[#22c55e]/10">
          <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-[#22c55e] animate-pulse" />
          <span className="text-[11px] font-semibold text-[#22c55e]">
            {STATUS_LABELS[visit.status] || visit.status}
          </span>
          <span className="text-[14px] font-bold tabular-nums text-[#22c55e]">
            {visit.checkedInAt ? <LiveTimer startedAt={visit.checkedInAt} /> : "00:00:00"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {visit.status === "en_route" && (
              <button onClick={handleStartJob} disabled={anyPending}
                className="h-8 px-3 rounded-lg bg-[#22c55e] text-white text-[11px] font-bold flex items-center gap-1.5 active:scale-[0.97] disabled:opacity-60">
                {startJob.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Start Job
              </button>
            )}
            {isOnSite && (
              <button onClick={() => setShowOutcome(true)} disabled={anyPending}
                className="h-8 px-3 rounded-lg bg-[#22c55e] text-white text-[11px] font-bold flex items-center gap-1.5 active:scale-[0.97] disabled:opacity-60">
                <Check className="h-3.5 w-3.5" />Complete
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══════ OUTCOME BANNER ══════ */}
      {visit.outcome && (
        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${OUTCOME_COLORS[visit.outcome] || DEFAULT_OUTCOME_COLOR}`}>
            {OUTCOME_LABELS[visit.outcome] || visit.outcome}
          </span>
          <span className="text-[10px] text-slate-400">Visit outcome set</span>
        </div>
      )}

      {/* ══════ PRIMARY ACTION (scheduled → Start Travel) ══════ */}
      {!isTerminal && isScheduled && (
        <div className="px-3 py-2 bg-white border-b border-slate-100">
          <button
            onClick={handleStartTravel}
            disabled={anyPending}
            className="w-full h-11 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-all bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
          >
            {startTravel.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Start Travel
          </button>
        </div>
      )}

      {/* Action success */}
      {actionSuccess && (
        <div className="px-3 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-1.5">
          <Check className="h-3 w-3 text-emerald-600" />
          <p className="text-xs font-medium text-emerald-700">{actionSuccess}</p>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="px-3 py-1.5 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-600">{actionError}</p>
          <button onClick={() => setActionError(null)} className="text-[10px] text-red-500 underline mt-0.5">Dismiss</button>
        </div>
      )}

      {/* ══════ TABS ══════ */}
      <div className="flex border-b border-slate-200 bg-white px-1">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 px-3 py-2 text-[11px] font-semibold whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab ? "text-[#22c55e] border-[#22c55e]" : "text-slate-400 border-transparent hover:text-slate-600"
            }`}>{tab}</button>
        ))}
      </div>

      {/* ══════ TAB CONTENT ══════ */}
      <div className="px-3 py-2.5 pb-28">
        {activeTab === "Overview" && (
          <div className="space-y-2">
            {visit.jobDescription && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Job Description</p>
                <p className="text-[12px] text-slate-600 leading-relaxed">{visit.jobDescription}</p>
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Status</p>
              <p className="text-sm font-semibold text-slate-800">{STATUS_LABELS[visit.status] || visit.status}</p>
              {visit.outcomeNote && (
                <p className="text-xs text-slate-500 mt-1">{visit.outcomeNote}</p>
              )}
            </div>
            {visit.equipmentIds && visit.equipmentIds.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Equipment ({visit.equipmentIds.length})
                </p>
                <p className="text-xs text-slate-500">Equipment linked to this visit</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "Notes" && (
          <NotesSection
            notes={visit.notes}
            onAddNote={handleAddNote}
            isPending={addNote.isPending}
          />
        )}
      </div>

      {/* Outcome modal */}
      {showOutcome && (
        <OutcomeModal
          onSelect={handleComplete}
          onCancel={() => setShowOutcome(false)}
        />
      )}
    </MobileShell>
  );
}
