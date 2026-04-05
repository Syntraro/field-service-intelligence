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

import { useState } from "react";
import { MobileShell } from "../components/MobileShell";
import { useAuth } from "@/lib/auth";
import { useTodayVisits, type TodayVisit } from "../hooks/useTodayVisits";
import { useTechShift } from "../hooks/useTechShift";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import {
  JOB_TYPE_LABELS, JOB_TYPE_COLORS, DEFAULT_JOB_TYPE_COLOR,
  STATUS_LABELS, STATUS_COLORS, DEFAULT_STATUS_COLOR,
} from "../utils/visitDisplay";
import {
  CalendarDays, MapPin, ChevronRight, Clock,
  LogIn, LogOut, Navigation,
  Plus, X, Briefcase, FileText, Receipt, CheckSquare, UserPlus, Target,
  Loader2, RefreshCw,
} from "lucide-react";

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
            <span className={`text-[11px] font-semibold ${isNext && !isActive ? "text-[#22c55e]" : "text-slate-500"}`}>
              {visit.scheduledTime}
            </span>
            <span className="text-[10px] text-slate-400">·</span>
            <span className="text-[11px] text-slate-500 truncate">{visit.company}</span>
            {visit.jobType && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${JOB_TYPE_COLORS[visit.jobType] || DEFAULT_JOB_TYPE_COLOR}`}>
                {JOB_TYPE_LABELS[visit.jobType] || visit.jobType}
              </span>
            )}
            {(isActive || isTerminal) && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[visit.status] || DEFAULT_STATUS_COLOR}`}>
                {STATUS_LABELS[visit.status] || visit.status}
              </span>
            )}
          </div>
          <div className="text-[12px] font-semibold text-slate-700 truncate mt-0.5">{visit.jobTitle}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin className="h-2.5 w-2.5 text-slate-400 shrink-0" />
            <span className="text-[10px] text-slate-400 truncate">{visit.address}</span>
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
            <span className="text-[9px] font-bold text-[#22c55e] bg-[#22c55e]/10 px-2 py-0.5 rounded-full">NEXT</span>
          )}
          <ChevronRight className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    </button>
  );
}

// ── FAB ──

type UserRole = "technician" | "dispatcher" | "manager" | "admin" | "owner";

const FAB_ACTIONS = [
  { key: "job",     label: "Job",     icon: Briefcase,   minRole: "manager" as UserRole },
  { key: "quote",   label: "Quote",   icon: FileText,    minRole: "manager" as UserRole },
  { key: "invoice", label: "Invoice", icon: Receipt,     minRole: "manager" as UserRole },
  { key: "task",    label: "Task",    icon: CheckSquare, minRole: "technician" as UserRole },
  { key: "client",  label: "Client",  icon: UserPlus,    minRole: "manager" as UserRole },
  { key: "lead",    label: "Lead",    icon: Target,      minRole: "manager" as UserRole },
] as const;

const ROLE_LEVEL: Record<UserRole, number> = {
  technician: 1, dispatcher: 2, manager: 3, admin: 4, owner: 5,
};

function getVisibleActions(role: UserRole) {
  return FAB_ACTIONS.filter(a => ROLE_LEVEL[role] >= ROLE_LEVEL[a.minRole]);
}

function FloatingActionButton({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);
  const actions = getVisibleActions(role);

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/30 z-40 max-w-md mx-auto" onClick={() => setOpen(false)} />
      )}
      {open && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-md z-50 px-3 pb-3 animate-in slide-in-from-bottom-4 duration-200">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-3">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1 mb-2">Create New</div>
            <div className="grid grid-cols-3 gap-2">
              {actions.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setOpen(false)}
                  className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors"
                >
                  <div className="h-10 w-10 rounded-full bg-[#22c55e]/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-[#22c55e]" />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-700">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-[68px] right-4 z-50 h-12 w-12 rounded-full bg-[#22c55e] shadow-lg shadow-[#22c55e]/30 flex items-center justify-center active:scale-90 transition-transform max-w-md"
        style={{ right: "max(1rem, calc(50% - 224px + 1rem))" }}
      >
        {open ? <X className="h-5 w-5 text-white" /> : <Plus className="h-6 w-6 text-white stroke-[3]" />}
      </button>
    </>
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <CalendarDays className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm font-medium">No jobs scheduled today</p>
    </div>
  );
}

// ── Main page ──

export function TodayPage({ onVisitTap }: { onVisitTap: (id: string) => void }) {
  const { visits, isLoading, isError, refetch } = useTodayVisits();
  const { isClockedIn, clockInAt, clockIn, clockOut } = useTechShift();
  const { formatted: elapsed } = useElapsedTimer(clockInAt, isClockedIn, 10_000);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [shiftSuccess, setShiftSuccess] = useState<string | null>(null);
  const { user } = useAuth();

  const userRole = (user?.role || "technician") as UserRole;

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
      {/* Clock-in banner */}
      {!isClockedIn && (
        <div className="bg-slate-100 px-3 py-2.5 flex items-center justify-between border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-slate-400" />
            <span className="text-[12px] font-medium text-slate-600">Not Clocked In</span>
          </div>
          <button
            onClick={handleClockIn}
            disabled={shiftPending}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#22c55e] text-white text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-60"
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
            <span className="text-[11px] font-semibold text-[#22c55e]">Working</span>
            {elapsed && <span className="text-[11px] text-slate-400 ml-1">{elapsed}</span>}
          </div>
          <button
            onClick={handleClockOut}
            disabled={shiftPending}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-semibold disabled:opacity-60"
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
          <button onClick={() => setShiftError(null)} className="text-[10px] text-red-500 underline">Dismiss</button>
        </div>
      )}

      {/* Visit list */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : visits.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="p-2.5 space-y-1.5">
          {visits.map(v => (
            <JobCard key={v.id} visit={v} isNext={v.id === nextVisitId} onTap={() => onVisitTap(v.id)} />
          ))}
        </div>
      )}

      <FloatingActionButton role={userRole} />
    </MobileShell>
  );
}
