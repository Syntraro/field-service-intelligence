import { format } from "date-fns";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

function KpiCell({
  label,
  value,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 truncate leading-none mb-0.5">
        {label}
      </span>
      <span
        className={cn(
          "text-xs font-semibold tabular-nums truncate",
          muted ? "text-slate-400" : "text-slate-800",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export interface ClientKpiStripProps {
  openJobs: number;
  outstanding: number;
  overdueInvoices: number;
  activeMaintenance: number;
  totalLocations: number;
  lastServiceDate: Date | null;
}

export function ClientKpiStrip({
  openJobs,
  outstanding,
  overdueInvoices,
  activeMaintenance,
  totalLocations,
  lastServiceDate,
}: ClientKpiStripProps) {
  return (
    <div
      className="shrink-0 flex items-center gap-4 px-4 lg:px-6 py-2 border-b border-slate-100 bg-slate-50/60 flex-wrap"
      data-testid="client-kpi-strip"
    >
      <KpiCell label="Open Jobs" value={openJobs} muted={openJobs === 0} />
      <div className="h-5 w-px bg-slate-200 flex-shrink-0" />
      <KpiCell
        label="Outstanding"
        value={formatCurrency(outstanding)}
        muted={outstanding === 0}
      />
      <div className="h-5 w-px bg-slate-200 flex-shrink-0" />
      <KpiCell
        label="Overdue Invoices"
        value={
          overdueInvoices > 0 ? (
            <span className="text-red-600">{overdueInvoices}</span>
          ) : (
            "0"
          )
        }
        muted={overdueInvoices === 0}
      />
      <div className="h-5 w-px bg-slate-200 flex-shrink-0" />
      <KpiCell
        label="Active Maintenance"
        value={activeMaintenance}
        muted={activeMaintenance === 0}
      />
      <div className="h-5 w-px bg-slate-200 flex-shrink-0" />
      <KpiCell label="Total Locations" value={totalLocations} />
      {lastServiceDate && (
        <>
          <div className="h-5 w-px bg-slate-200 flex-shrink-0" />
          <KpiCell
            label="Last Service"
            value={format(lastServiceDate, "MMM dd, yyyy")}
          />
        </>
      )}
    </div>
  );
}
