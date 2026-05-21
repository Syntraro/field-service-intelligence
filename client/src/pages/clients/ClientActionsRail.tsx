import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { WorkspaceRailEntityCard } from "@/components/workspace/WorkspaceRailEntityCard";
import { StatusChip } from "@/components/ui/chip";
import { getClientGroupStatusMeta } from "@/lib/statusBadges";
import type { SelectedClientContext } from "@/lib/clientsWorkspaceConfig";
import { ClientFinancialCard } from "./sections/ClientFinancialCard";
import type { BillingAggregates } from "./sections/ClientFinancialCard";
import { ClientContactsCard } from "./sections/ClientContactsCard";
import type { ClientContact } from "./sections/ClientContactsCard";
import { ClientLocationsCard } from "./sections/ClientLocationsCard";
import type { OverviewLocation } from "./sections/ClientLocationsCard";

// ── Local types ───────────────────────────────────────────────────────────────

interface OverviewJob {
  id: string;
  status: string;
  scheduledStart?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
}

interface OverviewResponse {
  company: Record<string, unknown>;
  locations: OverviewLocation[];
  jobs: OverviewJob[];
  stats: { totalLocations: number; openJobs: number; openInvoices: number };
  billingAggregates: BillingAggregates | null;
}

interface ContactsResponse {
  companyContacts: ClientContact[];
  locationContacts: ClientContact[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveLastServiceDate(jobs: OverviewJob[]): string {
  const dates = jobs
    .filter((j) => j.status === "completed" || j.status === "invoiced")
    .map((j) => j.scheduledStart ?? j.createdAt)
    .filter(Boolean) as string[];
  if (dates.length === 0) return "—";
  return formatDate(dates.reduce((a, b) => (a > b ? a : b)));
}

// ── ClientActionsRail ─────────────────────────────────────────────────────────

interface ClientActionsRailProps {
  context: SelectedClientContext;
}

/**
 * Client right rail — assembly-only.
 *
 * Queries:
 *   GET /api/clients/:primaryLocationId/overview — locations, jobs, billingAggregates
 *   GET /api/clients/:primaryLocationId/contacts — company contacts
 *
 * Section order: Top card (with metrics + badges) → Locations → Financials → Contacts
 */
export function ClientActionsRail({ context }: ClientActionsRailProps) {
  const [, setLocation] = useLocation();

  const locationId = context.primaryLocationId;

  // ── Overview fetch ─────────────────────────────────────────────────────────

  const { data: overview, isLoading: overviewLoading } = useQuery<OverviewResponse>({
    queryKey: ["/api/clients", locationId, "overview"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${locationId}/overview`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load client overview");
      return res.json();
    },
    enabled: !!locationId,
    staleTime: 30_000,
  });

  // ── Contacts fetch ─────────────────────────────────────────────────────────

  const { data: contactsData, isLoading: contactsLoading } = useQuery<ContactsResponse>({
    queryKey: ["/api/clients", locationId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${locationId}/contacts`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load client contacts");
      return res.json();
    },
    enabled: !!locationId,
    staleTime: 60_000,
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const contacts: ClientContact[] = contactsData?.companyContacts ?? [];
  const jobs: OverviewJob[] = overview?.jobs ?? [];
  const locations: OverviewLocation[] = overview?.locations ?? [];
  const billingAggregates = overview?.billingAggregates ?? null;

  const statusMeta = getClientGroupStatusMeta({
    hasActiveLocation: context.hasActiveLocation,
    allInactive: context.allInactive,
  });

  const hasBalance = billingAggregates && parseFloat(billingAggregates.outstanding.total) > 0;
  const isOverdue = billingAggregates && parseFloat(billingAggregates.outstanding.overdueTotal) > 0;
  const lastServiceDate = overviewLoading ? "—" : deriveLastServiceDate(jobs);

  // ── Operational badges ─────────────────────────────────────────────────────

  const badges: React.ReactNode[] = [];
  if (context.locationCount > 1) {
    badges.push(<StatusChip key="multi-site" tone="neutral">Multi-Site</StatusChip>);
  }
  if (!overviewLoading && billingAggregates) {
    if (isOverdue) {
      badges.push(<StatusChip key="past-due" tone="danger">Past Due</StatusChip>);
    } else if (parseFloat(billingAggregates.outstanding.total) === 0) {
      badges.push(<StatusChip key="good-standing" tone="success">Good Standing</StatusChip>);
    }
  }

  // ── Top card footer — 2×2 metrics grid + badges ───────────────────────────

  const topCardFooter = (
    <div className="mt-2.5 pt-2.5 border-t border-border space-y-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <p className="text-label text-muted-foreground">Open Jobs</p>
          <p className="text-helper text-foreground">
            {overviewLoading ? "—" : String(overview?.stats.openJobs ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-label text-muted-foreground">Open Invoices</p>
          <p className="text-helper text-foreground">
            {overviewLoading ? "—" : String(overview?.stats.openInvoices ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-label text-muted-foreground">Outstanding</p>
          <p className={cn("text-helper", hasBalance ? "text-amber-700" : "text-foreground")}>
            {overviewLoading
              ? "—"
              : billingAggregates
              ? formatCurrency(billingAggregates.outstanding.total)
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-label text-muted-foreground">Last Service</p>
          <p className="text-helper text-foreground">{lastServiceDate}</p>
        </div>
      </div>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1">{badges}</div>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div data-testid="client-actions-rail">

      {/* ── Top entity card ───────────────────────────────────────────────── */}
      <div className="pb-1">
        <WorkspaceRailEntityCard
          icon={Users}
          entityLabel={
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => setLocation(`/clients/${context.primaryLocationId}`)}
                className="text-row font-semibold text-foreground truncate min-w-0 hover:underline text-left"
              >
                {context.companyName}
              </button>
              <StatusChip tone={statusMeta.tone} className="shrink-0">
                {statusMeta.label}
              </StatusChip>
            </div>
          }
          clientName={
            context.locationCount > 1 ? (
              <p className="text-helper text-muted-foreground mt-0.5">
                {context.locationCount} locations
              </p>
            ) : context.address ? (
              <p className="text-helper text-muted-foreground mt-0.5 truncate">
                {context.address}
              </p>
            ) : null
          }
          footer={topCardFooter}
          testId="client-rail-entity-card"
        />
        <div className="-mx-3 mt-3 border-t border-slate-100" />
      </div>

      {/* ── Section cards ─────────────────────────────────────────────────── */}

      <ClientLocationsCard
        locations={locations}
        primaryLocationId={context.primaryLocationId}
        loading={overviewLoading}
      />

      <ClientFinancialCard
        billingAggregates={billingAggregates}
        loading={overviewLoading}
      />

      <ClientContactsCard
        contacts={contacts}
        loading={contactsLoading}
      />
    </div>
  );
}
