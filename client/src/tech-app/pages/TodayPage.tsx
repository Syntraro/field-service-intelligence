/** Technician PWA — Schedule screen
 *  2026-04-03: Added multi-tech team view, improved job cards with status tags,
 *  prominent clock-in banner, stronger next-job highlight. */

import { useState, useEffect, useRef } from "react";
import { MobileShell } from "../components/MobileShell";
import { JOB_TYPE_LABELS, JOB_TYPE_COLORS, STATUS_LABELS, STATUS_COLORS } from "../utils/visitDisplay";
import { MOCK_TECHNICIANS, TEAM_VISITS } from "../data/mockVisits";
import type { MockVisit, MockTechnician } from "../types";
import {
  CalendarDays, MapPin, ChevronRight, Clock, Coffee,
  LogIn, LogOut, Users, User, Navigation,
  Plus, X, Briefcase, FileText, Receipt, CheckSquare, UserPlus, Target,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Shift timer hook — ticks every 10 s while clocked in              */
/* ------------------------------------------------------------------ */
function useShiftTimer(clockedIn: boolean) {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (clockedIn && !startRef.current) startRef.current = Date.now();
    if (!clockedIn) { startRef.current = null; setElapsed(""); return; }
    const tick = () => {
      if (!startRef.current) return;
      const diff = Math.floor((Date.now() - startRef.current) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      setElapsed(h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`);
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [clockedIn]);
  return elapsed;
}

/* ------------------------------------------------------------------ */
/*  Team Schedule — time-grid view                                    */
/* ------------------------------------------------------------------ */
type ViewRange = "day" | "3day" | "week";

const HOUR_HEIGHT = 56;
const START_HOUR = 7;
const END_HOUR = 18;
const TOTAL_HOURS = END_HOUR - START_HOUR;

function parseTimeToHours(timeStr: string): number {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 8;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h + m / 60;
}

function TeamScheduleView({ onVisitTap }: { onVisitTap: (id: string) => void }) {
  const [range, setRange] = useState<ViewRange>("day");
  const [selectedTechs, setSelectedTechs] = useState<string[]>(MOCK_TECHNICIANS.map(t => t.id));

  const toggleTech = (id: string) => {
    setSelectedTechs(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const visibleTechs = MOCK_TECHNICIANS.filter(t => selectedTechs.includes(t.id));
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);

  return (
    <div className="flex flex-col flex-1">
      {/* Controls bar */}
      <div className="px-3 py-2 bg-white border-b border-slate-200 space-y-2">
        <div className="flex gap-1">
          {(["day", "3day", "week"] as ViewRange[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-full transition-colors ${
                range === r ? "bg-[#22c55e] text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              {r === "day" ? "Day" : r === "3day" ? "3 Day" : "Week"}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {MOCK_TECHNICIANS.map(tech => (
            <button
              key={tech.id}
              onClick={() => toggleTech(tech.id)}
              className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-full whitespace-nowrap transition-colors ${
                selectedTechs.includes(tech.id) ? "text-white" : "bg-slate-100 text-slate-400"
              }`}
              style={selectedTechs.includes(tech.id) ? { background: tech.color } : undefined}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
              {tech.name.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-auto">
        <div className="flex" style={{ minWidth: visibleTechs.length * 140 + 44 }}>
          {/* Time labels */}
          <div className="w-11 shrink-0 border-r border-slate-200 bg-slate-50">
            {hours.map(h => (
              <div key={h} className="flex items-start justify-end pr-1.5 text-[9px] text-slate-400 font-medium" style={{ height: HOUR_HEIGHT }}>
                {h > 12 ? `${h - 12}p` : h === 12 ? "12p" : `${h}a`}
              </div>
            ))}
          </div>
          {/* Tech columns */}
          {visibleTechs.map(tech => (
            <TechColumn
              key={tech.id}
              tech={tech}
              visits={TEAM_VISITS.filter(v => v.technicianId === tech.id)}
              hours={hours}
              onVisitTap={onVisitTap}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TechColumn({ tech, visits, hours, onVisitTap }: {
  tech: MockTechnician; visits: MockVisit[]; hours: number[]; onVisitTap: (id: string) => void;
}) {
  return (
    <div className="flex-1 min-w-[130px] border-r border-slate-100">
      <div className="sticky top-0 z-10 px-1.5 py-1 bg-white border-b border-slate-200 text-center">
        <div className="w-6 h-6 rounded-full mx-auto flex items-center justify-center text-[10px] font-bold text-white" style={{ background: tech.color }}>
          {tech.name.split(" ").map((n: string) => n[0]).join("")}
        </div>
        <div className="text-[9px] font-semibold text-slate-600 mt-0.5 truncate">{tech.name.split(" ")[0]}</div>
      </div>
      <div className="relative" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
        {hours.map((h, i) => (
          <div key={h} className="absolute w-full border-b border-slate-100" style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }} />
        ))}
        {visits.map(v => {
          const startH = parseTimeToHours(v.scheduledTime);
          const endH = parseTimeToHours(v.scheduledEnd);
          const top = (startH - START_HOUR) * HOUR_HEIGHT;
          const height = Math.max((endH - startH) * HOUR_HEIGHT - 2, 24);
          return (
            <button
              key={v.id}
              onClick={() => onVisitTap(v.id)}
              className="absolute left-1 right-1 rounded-md px-1.5 py-1 text-left overflow-hidden transition-transform active:scale-[0.97]"
              style={{ top, height, background: `${tech.color}18`, borderLeft: `3px solid ${tech.color}` }}
            >
              <div className="text-[9px] font-bold text-slate-700 truncate">{v.jobTitle}</div>
              <div className="text-[8px] text-slate-500 truncate">{v.company}</div>
              <div className="text-[8px] text-slate-400">{v.scheduledTime}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Job card for My Schedule list                                     */
/* ------------------------------------------------------------------ */
function JobCard({ visit, isNext, onTap }: { visit: MockVisit; isNext: boolean; onTap: () => void }) {
  const isTerminal = visit.status === "completed" || visit.status === "on_hold";
  const isActive = visit.status === "en_route" || visit.status === "in_progress";

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
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${JOB_TYPE_COLORS[visit.jobType]}`}>
              {JOB_TYPE_LABELS[visit.jobType]}
            </span>
            {(isActive || isTerminal) && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[visit.status]}`}>
                {STATUS_LABELS[visit.status]}
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

/* ------------------------------------------------------------------ */
/*  FAB action definitions & permission filtering                     */
/* ------------------------------------------------------------------ */
type UserRole = "technician" | "dispatcher" | "manager" | "admin" | "owner";

/** Actions available in the FAB bottom sheet */
const FAB_ACTIONS = [
  { key: "job",     label: "Job",     icon: Briefcase,   minRole: "manager" as UserRole },
  { key: "quote",   label: "Quote",   icon: FileText,    minRole: "manager" as UserRole },
  { key: "invoice", label: "Invoice", icon: Receipt,     minRole: "manager" as UserRole },
  { key: "task",    label: "Task",    icon: CheckSquare, minRole: "technician" as UserRole },
  { key: "client",  label: "Client",  icon: UserPlus,    minRole: "manager" as UserRole },
  { key: "lead",    label: "Lead",    icon: Target,      minRole: "manager" as UserRole },
] as const;

/** Simple role hierarchy for UI-only permission gating */
const ROLE_LEVEL: Record<UserRole, number> = {
  technician: 1, dispatcher: 2, manager: 3, admin: 4, owner: 5,
};

function getVisibleActions(role: UserRole) {
  const level = ROLE_LEVEL[role];
  return FAB_ACTIONS.filter(a => level >= ROLE_LEVEL[a.minRole]);
}

/* ------------------------------------------------------------------ */
/*  FAB + Bottom Sheet                                                 */
/* ------------------------------------------------------------------ */
function FloatingActionButton({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);
  const actions = getVisibleActions(role);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/30 z-40 max-w-md mx-auto" onClick={() => setOpen(false)} />
      )}

      {/* Bottom sheet */}
      {open && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-md z-50 px-3 pb-3 animate-in slide-in-from-bottom-4 duration-200">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-3">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1 mb-2">Create New</div>
            <div className="grid grid-cols-3 gap-2">
              {actions.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => { setOpen(false); /* navigation handled by parent */ }}
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

      {/* FAB button */}
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

/* ------------------------------------------------------------------ */
/*  TodayPage — main export                                           */
/* ------------------------------------------------------------------ */
export function TodayPage({ visits, onVisitTap }: { visits: MockVisit[]; onVisitTap: (id: string) => void }) {
  const [clockedIn, setClockedIn] = useState(false);
  const [onBreak, setOnBreak] = useState(false);
  const elapsed = useShiftTimer(clockedIn);
  const [isManager] = useState(true);
  /** Mock permission flag — accept role prop in future */
  const [userRole] = useState<UserRole>("admin");
  const [viewMode, setViewMode] = useState<"my" | "team">("my");
  const nextVisitId = visits.find(v => v.status !== "completed" && v.status !== "on_hold")?.id;

  return (
    <MobileShell showNav>
      {/* Clock-in banner — neutral strip when not clocked in */}
      {!clockedIn && (
        <div className="bg-slate-100 px-3 py-2.5 flex items-center justify-between border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-slate-400" />
            <span className="text-[12px] font-medium text-slate-600">Not Clocked In</span>
          </div>
          <button
            onClick={() => setClockedIn(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#22c55e] text-white text-[11px] font-bold active:scale-95 transition-transform"
          >
            <LogIn className="h-3 w-3" />
            Clock In
          </button>
        </div>
      )}

      {/* Active shift strip */}
      {clockedIn && (
        <div className={`px-3 py-2 flex items-center justify-between ${onBreak ? "bg-amber-50" : "bg-[#22c55e]/5"}`}>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${onBreak ? "bg-amber-400" : "bg-[#22c55e] animate-pulse"}`} />
            <span className={`text-[11px] font-semibold ${onBreak ? "text-amber-700" : "text-[#22c55e]"}`}>
              {onBreak ? "On Break" : "Working"}
            </span>
            {elapsed && <span className="text-[11px] text-slate-400 ml-1">{elapsed}</span>}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setOnBreak(!onBreak)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                onBreak ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              <Coffee className="h-3 w-3" />
              {onBreak ? "Resume" : "Break"}
            </button>
            <button
              onClick={() => { setClockedIn(false); setOnBreak(false); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-semibold"
            >
              <LogOut className="h-3 w-3" />
              Out
            </button>
          </div>
        </div>
      )}

      {/* View toggle */}
      {isManager && (
        <div className="px-3 pt-2 pb-1 flex gap-1">
          <button
            onClick={() => setViewMode("my")}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              viewMode === "my" ? "bg-[#0f1a2e] text-white" : "bg-slate-100 text-slate-500"
            }`}
          >
            <User className="h-3 w-3" />
            My Schedule
          </button>
          <button
            onClick={() => setViewMode("team")}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              viewMode === "team" ? "bg-[#0f1a2e] text-white" : "bg-slate-100 text-slate-500"
            }`}
          >
            <Users className="h-3 w-3" />
            Team View
          </button>
        </div>
      )}

      {viewMode === "team" ? (
        <TeamScheduleView onVisitTap={onVisitTap} />
      ) : (
        <div className="p-2.5 space-y-1.5">
          {visits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <CalendarDays className="h-10 w-10 mb-2 opacity-40" />
              <p className="text-sm font-medium">No jobs scheduled today</p>
            </div>
          ) : (
            visits.map(v => (
              <JobCard key={v.id} visit={v} isNext={v.id === nextVisitId} onTap={() => onVisitTap(v.id)} />
            ))
          )}
        </div>
      )}

      {/* Floating action button — permission-filtered */}
      <FloatingActionButton role={userRole} />
    </MobileShell>
  );
}
