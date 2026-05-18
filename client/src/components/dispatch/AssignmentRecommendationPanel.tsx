/**
 * AssignmentRecommendationPanel — compact, explainable technician recommendations.
 *
 * Shown inside the VisitTeamAssignment popover when a jobId is available.
 * Never auto-assigns — the dispatcher always clicks to add a technician.
 *
 * Compact display rules:
 *   - Max 5 recommendations (configurable via limit prop)
 *   - Each recommendation: name + score badge + icons for issues
 *   - Expandable reasons/warnings on hover or tap (tooltip)
 *   - Empty state when no job has skill requirements
 */
import { useQuery } from "@tanstack/react-query";
import { jobKeys } from "@/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  TrendingUp,
  User,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types (mirrors server/lib/assignmentIntelligence.ts) ──────────────────

interface SkillMatchDetail {
  skillId: string;
  skillName: string;
  minimumLevel: string | null;
  memberLevel: string | null;
  levelMet: boolean;
  isRequired: boolean;
  expiryStatus: "valid" | "expiring_soon" | "expired" | null;
  certificationName: string | null;
}

interface RecommendationItem {
  userId: string;
  name: string;
  role: string;
  matchScore: number;
  skillMatchCount: number;
  skillPartialCount: number;
  totalRequiredSkills: number;
  skillMatchDetails: SkillMatchDetail[];
  isAvailable: boolean;
  timeOffConflict: { reason: string; startsAt: string; endsAt: string } | null;
  utilizationPct: number | null;
  reasons: string[];
  warnings: string[];
  workedHoursThisWeek: number;
  forecastedWeekHours: number;
  targetWeeklyHours: number;
}

interface RecommendationsResponse {
  jobId: string;
  date: string;
  recommendations: RecommendationItem[];
}

// ── Score badge ───────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 80 ? "bg-green-100 text-green-700" :
    score >= 60 ? "bg-blue-100 text-blue-700" :
    score >= 40 ? "bg-amber-100 text-amber-700" :
    "bg-red-100 text-red-700";
  return (
    <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5", cls)}>
      {score}%
    </span>
  );
}

// ── Warning icons strip ───────────────────────────────────────────────────

function WarningIcons({ rec }: { rec: RecommendationItem }) {
  const hasMissingSkills = rec.skillMatchCount < rec.totalRequiredSkills && rec.totalRequiredSkills > 0;
  const hasExpiring = rec.skillMatchDetails.some((d) => d.expiryStatus === "expiring_soon" || d.expiryStatus === "expired");
  const isUnavailable = !rec.isAvailable;
  const highUtil = rec.utilizationPct !== null && rec.utilizationPct > 80;

  return (
    <span className="flex items-center gap-0.5">
      {hasMissingSkills && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span><XCircle className="h-3.5 w-3.5 text-red-500" /></span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[200px] text-xs">
            Missing {rec.totalRequiredSkills - rec.skillMatchCount} required skill(s)
          </TooltipContent>
        </Tooltip>
      )}
      {hasExpiring && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[200px] text-xs">
            Certification expiry issue
          </TooltipContent>
        </Tooltip>
      )}
      {isUnavailable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span><Clock className="h-3.5 w-3.5 text-orange-500" /></span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[200px] text-xs">
            {rec.timeOffConflict
              ? `On time-off: ${rec.timeOffConflict.reason.replace(/_/g, " ")}`
              : "Unavailable"}
          </TooltipContent>
        </Tooltip>
      )}
      {highUtil && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span><TrendingUp className="h-3.5 w-3.5 text-purple-500" /></span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[200px] text-xs">
            High utilization ({Math.round(rec.utilizationPct!)}%)
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

// ── Skill match summary ───────────────────────────────────────────────────

function SkillSummary({ rec }: { rec: RecommendationItem }) {
  if (rec.totalRequiredSkills === 0) return null;
  const allMet = rec.skillMatchCount === rec.totalRequiredSkills;
  return (
    <span className={cn("text-[10px]", allMet ? "text-green-600" : "text-amber-600")}>
      {rec.skillMatchCount}/{rec.totalRequiredSkills} skills
    </span>
  );
}

// ── Reasons tooltip content ───────────────────────────────────────────────

function ReasonTooltip({ rec }: { rec: RecommendationItem }) {
  const all = [
    ...rec.reasons.map((r) => ({ type: "reason" as const, text: r })),
    ...rec.warnings.map((w) => ({ type: "warning" as const, text: w })),
  ];
  if (all.length === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-[10px] text-muted-foreground underline decoration-dotted">
          details
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px]">
        <ul className="space-y-0.5 text-xs">
          {all.map((item, i) => (
            <li key={i} className={cn("flex items-start gap-1", item.type === "warning" ? "text-amber-200" : "text-green-200")}>
              <span className="shrink-0 mt-0.5">{item.type === "warning" ? "⚠" : "✓"}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────

interface AssignmentRecommendationPanelProps {
  jobId: string;
  /** Target date for availability checking (defaults to today) */
  date?: string;
  /** Max recommendations to show (default 5) */
  limit?: number;
  /** Called when user clicks a recommendation to add them */
  onSelect: (userId: string) => void;
  /** Currently selected technician IDs (already in crew — greyed out) */
  selectedIds: string[];
}

export function AssignmentRecommendationPanel({
  jobId,
  date,
  limit = 5,
  onSelect,
  selectedIds,
}: AssignmentRecommendationPanelProps) {
  const queryKey = jobKeys.assignmentRecs(jobId, date ?? "today");

  const { data, isLoading, isError } = useQuery<RecommendationsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      const res = await fetch(`/api/jobs/${jobId}/assignment-recommendations?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load recommendations");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="px-2 py-2 text-[10px] text-slate-400">Loading recommendations…</div>
    );
  }

  if (isError || !data) return null;

  const recs = data.recommendations.slice(0, limit);
  if (recs.length === 0) return null;

  return (
    <div className="border-b border-slate-100 pb-1 mb-1">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Sparkles className="h-3 w-3 text-amber-500" />
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
          Recommended
        </span>
      </div>
      {recs.map((rec) => {
        const alreadySelected = selectedIds.includes(rec.userId);
        return (
          <button
            key={rec.userId}
            type="button"
            disabled={alreadySelected}
            onClick={() => !alreadySelected && onSelect(rec.userId)}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded flex items-center gap-1.5",
              alreadySelected
                ? "opacity-40 cursor-default"
                : "hover:bg-slate-100 cursor-pointer",
            )}
            data-testid={`recommendation-${rec.userId}`}
          >
            <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="text-sm text-slate-700 truncate block">{rec.name}</span>
              <span className="flex items-center gap-1">
                <SkillSummary rec={rec} />
                <ReasonTooltip rec={rec} />
              </span>
              <span className="text-[10px] text-slate-400 tabular-nums">
                {rec.workedHoursThisWeek.toFixed(1)}h worked
                {" · "}
                {rec.forecastedWeekHours.toFixed(1)}h fcst
                {rec.targetWeeklyHours > 0 && ` / ${rec.targetWeeklyHours}h`}
              </span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <WarningIcons rec={rec} />
              <ScoreBadge score={rec.matchScore} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
