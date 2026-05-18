// 2026-04-20 Phase 2 Team Hub: shared type shapes.
// 2026-05-17 Phase 3: added skill library + member skill assignment types.
// Mirrors server/routes/team.ts response structures; keep in sync if they drift.

export interface TeamMemberRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  phone: string | null;
  role: string;
  roleId: string | null;
  status: string;
  disabled?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

// GET /api/team/technicians projection (server/routes/team.ts:273-282).
export interface TeamTechnicianRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  roleId: string | null;
  isSchedulable: boolean;
  color: string | null;
  laborCostPerHour: string | null;
}

export interface TeamMemberDetail extends TeamMemberRow {
  useCustomSchedule: boolean;
  isSchedulable: boolean;
  profile: {
    id: string;
    userId: string;
    laborCostPerHour: string | null;
    billableRatePerHour: string | null;
    color: string | null;
    phone: string | null;
    note: string | null;
  } | null;
  workingHours: Array<{
    id: string;
    userId: string;
    dayOfWeek: number;
    startTime: string | null;
    endTime: string | null;
    isWorking: boolean;
  }>;
  permissionOverrides: Array<{
    id: string;
    userId: string;
    permissionId: string;
    override: string;
  }>;
}

export interface Role {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  hierarchy: number;
  memberCount?: number;
  // 2026-05-04 PR 2: surfaces backend `roles.is_system_role`. The
  // server already includes this in `GET /api/roles`; the type was
  // missing it. UI uses this for the lock badge + clone-CTA branch.
  isSystemRole?: boolean;
}

export interface Permission {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
}

export type MetricsPeriod = "last_30_days" | "last_90_days" | "last_12_months";

export interface TeamMemberMetrics {
  userId: string;
  hoursWorked: number;
  scheduledHoursInPeriod: number;
  utilizationPct: number | null;
  jobsCompleted: number;
  allocatedRevenue: number;
  avgRevPerHour: number | null;
  leadsGenerated: number;
  leadRevenue: number;
}

export interface TeamMetricsResponse {
  period: MetricsPeriod;
  members: TeamMemberMetrics[];
}

export interface MonthlyPerformancePoint {
  month: string; // "YYYY-MM"
  hoursWorked: number;
  jobsCompleted: number;
  allocatedRevenue: number;
  avgRevPerHour: number | null;
}

export interface ScoreComponent {
  key: "utilization" | "revPerHour" | "throughput" | "leadContribution";
  label: string;
  score: number;
  hasData: boolean;
  raw: number | null;
  unit: string;
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface EfficiencyScore {
  overall: number;
  grade: Grade;
  components: ScoreComponent[];
  strengths: string[];
  opportunities: string[];
  hasData: boolean;
  methodNote: string;
}

export interface LeadConversionMetrics {
  leadsGenerated: number;
  leadsConvertedToQuote: number;
  leadsConvertedToJob: number;
  leadRevenue: number;
  quoteConversionRate: number | null;
  jobConversionRate: number | null;
  hasTracedRevenue: boolean;
}

export interface MemberPerformanceResponse {
  period: MetricsPeriod;
  metrics: TeamMemberMetrics;
  monthlyTrend: MonthlyPerformancePoint[];
  efficiencyScore: EfficiencyScore;
  leadConversion: LeadConversionMetrics;
}

// ── Phase 3: Skills & Licenses ────────────────────────────────────────────

export type ExpiryStatus = "valid" | "expiring_soon" | "expired";

/** One entry in the company-wide Skills & Licenses library. */
export interface TeamSkillLibraryItem {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  requiresCertification: boolean;
  hasExpiryTracking: boolean;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string | null;
}

// ── Workforce capacity + workload intelligence types ─────────────────────────

export type ForecastWindow = "today" | "tomorrow" | "week" | "next_week" | "30d";
export type WorkloadWindow = "today" | "this_week" | "last_30_days";

export interface WorkloadCategory {
  hours: number;
  pct: number;
}

export interface WorkloadBreakdown {
  window: WorkloadWindow;
  totalHours: number;
  billable: WorkloadCategory;
  drive: WorkloadCategory;
  general: WorkloadCategory;
}

export interface MemberCapacityRow {
  userId: string;
  name: string;
  role: string;
  todayAvailableHours: number;
  todayScheduledHours: number;
  todayUtilizationPct: number | null;
  workedHoursThisWeek: number;
  scheduledRemainingHoursThisWeek: number;
  forecastedWeekHours: number;
  targetWeeklyHours: number;
}

export interface TeamCapacitySnapshot {
  availableHours: number;
  scheduledHours: number;
  openHours: number;
  utilizationPct: number | null;
}

export interface TeamCapacityForecast {
  generatedAt: string;
  today: TeamCapacitySnapshot;
  members: MemberCapacityRow[];
}

export interface PmWindowForecast {
  pendingInstanceCount: number;
  estimatedTotalHours: number;
}

export interface PmForecast {
  generatedAt: string;
  thisWeek: PmWindowForecast;
  nextWeek: PmWindowForecast;
  next30Days: PmWindowForecast;
}

/** A skill/license assigned to a specific team member. */
export interface TeamMemberSkill {
  id: string;
  skillId: string;
  name: string;
  category: string | null;
  certificationName: string | null;
  certificationExpiresAt: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
  expiryStatus: ExpiryStatus | null;
}
