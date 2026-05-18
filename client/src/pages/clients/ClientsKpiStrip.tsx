import { Users, MapPin, DollarSign, Activity } from "lucide-react";
import {
  WorkspaceKpiStrip,
  type WorkspaceKpiDescriptor,
} from "@/components/workspace/WorkspaceKpiStrip";
import type { CompanyGroup } from "@/lib/clientsWorkspaceConfig";

interface ClientsKpiStripProps {
  /** All company groups (unfiltered) — KPIs reflect the full tenant dataset. */
  companyGroups: CompanyGroup[];
  loading?: boolean;
}

/**
 * Clients-workspace KPI data adapter → WorkspaceKpiStrip.
 *
 * Phase 1: derives active-client count and multi-location count from the
 * already-fetched list data (zero extra network requests).
 *
 * Phase 3 TODO: add two more KPIs driven by GET /api/clients/workspace-kpis:
 *   - Clients with outstanding balance
 *   - Total outstanding balance across all clients
 */
export function ClientsKpiStrip({ companyGroups, loading }: ClientsKpiStripProps) {
  const activeCount = companyGroups.filter((g) => g.hasActiveLocation).length;
  const multiLocationCount = companyGroups.filter((g) => g.locationCount > 1).length;

  const kpis: WorkspaceKpiDescriptor[] = [
    {
      id: "active-clients",
      label: "Active Clients",
      value: loading ? "—" : String(activeCount),
      sub: "At least one active location",
      icon: Users,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-100",
      loading,
      testId: "kpi-active-clients",
    },
    {
      id: "multi-location",
      label: "Multiple Locations",
      value: loading ? "—" : String(multiLocationCount),
      sub: "Companies with 2+ properties",
      icon: MapPin,
      iconColor: "text-teal-600",
      iconBg: "bg-teal-100",
      loading,
      testId: "kpi-multi-location",
    },
    // TODO Phase 3 — requires GET /api/clients/workspace-kpis
    {
      id: "outstanding-balance",
      label: "Outstanding Balance",
      value: "—",
      sub: "Available in Phase 3",
      icon: DollarSign,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-100",
      testId: "kpi-outstanding-balance",
    },
    // TODO Phase 3 — requires GET /api/clients/workspace-kpis
    {
      id: "recent-jobs",
      label: "With Recent Jobs",
      value: "—",
      sub: "Available in Phase 3",
      icon: Activity,
      iconColor: "text-violet-600",
      iconBg: "bg-violet-100",
      testId: "kpi-recent-jobs",
    },
  ];

  return <WorkspaceKpiStrip kpis={kpis} data-testid="clients-kpi-strip" />;
}
