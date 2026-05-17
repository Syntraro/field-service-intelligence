import { useQuery } from "@tanstack/react-query";
import { ServicePlanWarningsCard } from "./sections/ServicePlanWarningsCard";
import { ServicePlanNextServiceCard } from "./sections/ServicePlanNextServiceCard";
import { ServicePlanRenewalCard } from "./sections/ServicePlanRenewalCard";
import { ServicePlanBillingCard } from "./sections/ServicePlanBillingCard";
import { ServicePlanQuickActionsCard } from "./sections/ServicePlanQuickActionsCard";
import { ServicePlanSummaryCard } from "./sections/ServicePlanSummaryCard";
import { ServicePlanActivityCard } from "./sections/ServicePlanActivityCard";
import type { ServicePlanSelectionContext } from "./ServicePlanListPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecurringPlanDetail {
  id: string;
  title: string;
  description: string | null;
  notes: string | null;
  jobType: string;
  priority: string;
  isActive: boolean;
  startDate: string;
  endDate: string | null;
  timezone: string | null;
  recurrenceKind: string;
  interval: number;
  monthsOfYear: number[] | null;
  generationMode: string;
  generationDayOfMonth: number | null;
  serviceWindowDaysBefore: number;
  serviceWindowDaysAfter: number;
  pmBillingModel: string | null;
  pmBillingLabel: string | null;
  pmContractAmount: string | null;
  autoGenerateJobs: boolean;
  clientId: string | null;
  locationId: string | null;
  clientName?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationCity?: string | null;
  nextOccurrence?: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface PlanInstanceWithJob {
  id: string;
  instanceDate: string;
  status: string;
  generatedJobId: string | null;
  claimedAt: string | null;
  createdAt: string;
  job: {
    id: string;
    jobNumber: number;
    summary: string;
    status: string;
  } | null;
}

// ── ServicePlanActionsRail ────────────────────────────────────────────────────

interface ServicePlanActionsRailProps {
  context: ServicePlanSelectionContext | null;
  onDeleted?: () => void;
}

/**
 * Service plan right rail — assembly-only.
 *
 * Query ownership:
 * - GET /api/recurring-templates/:id  → plan detail (shared by all cards)
 * - GET /api/recurring-templates/:id/instances → instances (shared by all cards)
 *
 * Section cards receive data via props; they own only their own mutations.
 * No modal state here — section cards own their modal state.
 */
export function ServicePlanActionsRail({ context, onDeleted }: ServicePlanActionsRailProps) {
  const planId = context?.planId ?? null;

  // ── Shared rail-root fetches ───────────────────────────────────────────────

  const { data: plan, isLoading: planLoading } = useQuery<RecurringPlanDetail>({
    queryKey: ["/api/recurring-templates", planId],
    queryFn: async () => {
      const res = await fetch(`/api/recurring-templates/${planId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load plan");
      return res.json();
    },
    enabled: !!planId,
    staleTime: 30_000,
  });

  const { data: instances = [], isLoading: instancesLoading } = useQuery<PlanInstanceWithJob[]>({
    queryKey: ["/api/recurring-templates", planId, "instances"],
    queryFn: async () => {
      const res = await fetch(
        `/api/recurring-templates/${planId}/instances?limit=10`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load instances");
      return res.json();
    },
    enabled: !!planId,
    staleTime: 30_000,
  });

  if (!context) return null;

  // ── Render — urgency-first ordering ──────────────────────────────────────

  const railLoading = planLoading || instancesLoading;

  // The detail endpoint returns the raw template without joined names.
  // Merge names from the selection context (sourced from the list query which does join).
  const enrichedPlan: RecurringPlanDetail | undefined = plan
    ? {
        ...plan,
        clientName: plan.clientName ?? context.clientName,
        locationName: plan.locationName ?? context.locationName,
        locationAddress: plan.locationAddress ?? context.locationAddress,
      }
    : undefined;

  return (
    <div data-testid="service-plans-actions-rail">
      <ServicePlanWarningsCard plan={enrichedPlan} instances={instances} loading={railLoading} />
      <ServicePlanNextServiceCard plan={enrichedPlan} instances={instances} loading={railLoading} />
      <ServicePlanRenewalCard plan={enrichedPlan} loading={planLoading} />
      <ServicePlanBillingCard plan={enrichedPlan} loading={planLoading} />
      <ServicePlanQuickActionsCard plan={enrichedPlan} loading={planLoading} onDeleted={onDeleted} />
      <ServicePlanSummaryCard plan={enrichedPlan} loading={planLoading} />
      <ServicePlanActivityCard plan={enrichedPlan} loading={planLoading} />
    </div>
  );
}
