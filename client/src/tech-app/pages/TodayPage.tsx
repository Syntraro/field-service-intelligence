/**
 * Technician PWA — Today schedule screen.
 *
 * Phase 1 (2026-04-04): Wired to real backend via GET /api/tech/visits/today.
 *   - Removed mock visit data (INITIAL_VISITS, TEAM_VISITS, MOCK_TECHNICIANS)
 *   - Removed Team View (no real multi-tech endpoint for technician role)
 *   - Added loading, empty, and error states
 *   - Clock-in/out remains local-only (deferred to Phase 2 — tightly coupled
 *     to visit action flow, wiring it here without visit status mutations
 *     would create partial state that's hard to reconcile)
 *   - FAB retained with static permission mock (future: derive from user role)
 *   - Visit card tap navigates to /tech/visit/:id (detail stays mock until Phase 2)
 */

import { useState, useCallback } from "react";
import { MobileShell } from "../components/MobileShell";
import { DaySelector, toDateStr } from "../components/DaySelector";
import { useTodayVisits, type TodayVisit } from "../hooks/useTodayVisits";
import { useTechShift } from "../hooks/useTechShift";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import {
  STATUS_LABELS, STATUS_COLORS, DEFAULT_STATUS_COLOR,
} from "../utils/visitDisplay";
import {
  CalendarDays, MapPin, ChevronRight, Clock,
  LogIn, LogOut, Navigation,
  Loader2, RefreshCw, Plus, Briefcase, UserPlus, FileText, X,
} from "lucide-react";
import { useLocation } from "wouter";

// Display maps imported from shared utils/visitDisplay.ts

// ── Job card ──

function JobCard({ visit, isNext, onTap }: { visit: TodayVisit; isNext: boolean; onTap: () => void }) {
  const isTerminal = visit.status === "completed" || visit.status === "on_hold" || visit.status === "cancelled";
  const isActive = visit.status === "en_route" || visit.status === "in_progress" || visit.status === "on_site";

  return (
    <button
      onClick={onTap}
      className={`w-full text-left rounded-xl border transition-all active:scale-[0.98] ${
        isNext && !isActive && !isTerminal
          ? "border-[#22c55e] bg-[#22c55e]/5 ring-1 ring-[#22c55e]/20"
          : isActive
            ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300/30"
            : isTerminal
              ? "border-slate-200 bg-slate-50 opacity-60"
              : "border-slate-200 bg-white"
      }`}
    >
      <div className="px-3 py-2.5 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-semibold ${isNext && !isActive ? "text-[#22c55e]" : "text-slate-500"}`}>
              {visit.scheduledTime}
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-sm text-slate-500 truncate">{visit.company}</span>
            {(isActive || isTerminal) && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[visit.status] || DEFAULT_STATUS_COLOR}`}>
                {STATUS_LABELS[visit.status] || visit.status}
              </span>
            )}
          </div>
          <div className="text-sm font-semibold text-slate-700 truncate mt-0.5">{visit.jobTitle}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin className="h-2.5 w-2.5 text-slate-400 shrink-0" />
            <span className="text-xs text-slate-400 truncate">{visit.address}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); }}
            className="p-1.5 rounded-md hover:bg-[rgba(118,176,84,0.08)] text-slate-400 hover:text-[#76B054] transition-colors"
          >
            <Navigation className="h-3.5 w-3.5" />
          </button>
          {isNext && !isActive && !isTerminal && (
            <span className="text-xs font-bold text-[#22c55e] bg-[#22c55e]/10 px-2 py-0.5 rounded-full">NEXT</span>
          )}
          <ChevronRight className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    </button>
  );
}

// ── Loading state ──

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="h-8 w-8 animate-spin mb-3 opacity-50" />
      <p className="text-sm font-medium">Loading today's schedule…</p>
    </div>
  );
}

// ── Error state ──

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <CalendarDays className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm font-medium mb-3">Failed to load schedule</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold active:bg-slate-200 transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        Retry
      </button>
    </div>
  );
}

// ── Empty state ──

function EmptyState({ dateLabel }: { dateLabel?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <CalendarDays className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm font-medium">No jobs scheduled{dateLabel ? ` for ${dateLabel}` : ""}</p>
    </div>
  );
}

// ── Main page ──

export function TodayPage({ onVisitTap }: { onVisitTap: (id: string) => void }) {
  const [, setLocation] = useLocation();

  // Date navigation state
  const [selectedDate, setSelectedDate] = useState(new Date());
  const isSelectedToday = toDateStr(selectedDate) === toDateStr(new Date());
  const dateParam = isSelectedToday ? undefined : toDateStr(selectedDate);

  const goToPrevDay = useCallback(() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; }), []);
  const goToNextDay = useCallback(() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; }), []);
  const goToToday = useCallback(() => setSelectedDate(new Date()), []);

  const { visits, isLoading, isError, refetch } = useTodayVisits(dateParam);
  const { isClockedIn, clockInAt, clockIn, clockOut } = useTechShift();
  const { formatted: elapsed } = useElapsedTimer(clockInAt, isClockedIn, 10_000);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [shiftSuccess, setShiftSuccess] = useState<string | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  const TERMINAL_STATUSES = ["completed", "on_hold", "cancelled"];
  const nextVisitId = visits.find(v => !TERMINAL_STATUSES.includes(v.status))?.id;

  const handleClockIn = async () => {
    setShiftError(null);
    try { await clockIn.mutateAsync(); setShiftSuccess("Clocked in"); setTimeout(() => setShiftSuccess(null), 3000); } catch (err: any) { setShiftError(err?.message || "Failed to clock in"); }
  };

  const handleClockOut = async () => {
    setShiftError(null);
    try { await clockOut.mutateAsync(); setShiftSuccess("Clocked out"); setTimeout(() => setShiftSuccess(null), 3000); } catch (err: any) { setShiftError(err?.message || "Failed to clock out"); }
  };

  const shiftPending = clockIn.isPending || clockOut.isPending;

  return (
    <MobileShell showNav>
      {/* Date navigation */}
      <DaySelector selectedDate={selectedDate} onSelect={setSelectedDate} onPrev={goToPrevDay} onNext={goToNextDay} onToday={goToToday} />

      {/* Clock-in banner */}
      {!isClockedIn && (
        <div className="bg-slate-100 px-3 py-2.5 flex items-center justify-between border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-slate-400" />
            <span className="text-sm font-medium text-slate-600">Not Clocked In</span>
          </div>
          <button
            onClick={handleClockIn}
            disabled={shiftPending}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#22c55e] text-white text-sm font-bold active:scale-95 transition-transform disabled:opacity-60"
          >
            <LogIn className="h-3 w-3" />
            {clockIn.isPending ? "Clocking in…" : "Clock In"}
          </button>
        </div>
      )}

      {/* Active shift strip */}
      {isClockedIn && (
        <div className="px-3 py-2 flex items-center justify-between bg-[#22c55e]/5">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse" />
            <span className="text-sm font-semibold text-[#22c55e]">Working</span>
            {elapsed && <span className="text-sm text-slate-400 ml-1">{elapsed}</span>}
          </div>
          <button
            onClick={handleClockOut}
            disabled={shiftPending}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-semibold disabled:opacity-60"
          >
            <LogOut className="h-3 w-3" />
            {clockOut.isPending ? "Clocking out…" : "Out"}
          </button>
        </div>
      )}

      {/* Shift success */}
      {shiftSuccess && (
        <div className="px-3 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-1.5">
          <LogIn className="h-3 w-3 text-emerald-600" />
          <p className="text-xs font-medium text-emerald-700">{shiftSuccess}</p>
        </div>
      )}

      {/* Shift error */}
      {shiftError && (
        <div className="px-3 py-1.5 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-600">{shiftError}</p>
          <button onClick={() => setShiftError(null)} className="text-xs text-red-500 underline">Dismiss</button>
        </div>
      )}

      {/* Visit list */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : visits.length === 0 ? (
        <EmptyState dateLabel={isSelectedToday ? undefined : selectedDate.toLocaleDateString([], { month: "short", day: "numeric" })} />
      ) : (
        <div className="p-2.5 space-y-1.5">
          {visits.map(v => (
            <JobCard key={v.id} visit={v} isNext={v.id === nextVisitId} onTap={() => onVisitTap(v.id)} />
          ))}
        </div>
      )}

      {/* Create FAB */}
      <button onClick={() => setShowCreateMenu(true)}
        className="fixed bottom-20 right-4 h-12 w-12 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center active:scale-95 z-30">
        <Plus className="h-5 w-5" />
      </button>

      {/* Create action chooser */}
      {showCreateMenu && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setShowCreateMenu(false)}>
          <div className="w-full max-w-md bg-white rounded-t-2xl p-4 pb-6 shadow-xl space-y-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-slate-800">Create</h3>
              <button onClick={() => setShowCreateMenu(false)} className="p-1 rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <button
              onClick={() => { setShowCreateMenu(false); setLocation("/tech/create-job"); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <Briefcase className="h-4.5 w-4.5 text-emerald-600" style={{ width: 18, height: 18 }} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800">Create Job</p>
                <p className="text-xs text-slate-400">New work order with scheduling</p>
              </div>
            </button>
            <button
              onClick={() => { setShowCreateMenu(false); setLocation("/tech/create-lead"); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <FileText className="h-4.5 w-4.5 text-amber-600" style={{ width: 18, height: 18 }} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800">Create Lead</p>
                <p className="text-xs text-slate-400">Report an opportunity to the office</p>
              </div>
            </button>
            <button
              onClick={() => { setShowCreateMenu(false); setLocation("/tech/create-client"); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <UserPlus className="h-4.5 w-4.5 text-blue-600" style={{ width: 18, height: 18 }} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800">Create Client</p>
                <p className="text-xs text-slate-400">New client and service location</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
