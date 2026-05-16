import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";
import type { JobVisit } from "@shared/schema";

interface JobWarningsCardProps {
  job: JobHeaderDetail | undefined;
  visits: JobVisit[];
  loading: boolean;
}

interface Warning {
  key: string;
  message: string;
  severity: "high" | "medium";
}

function deriveWarnings(job: JobHeaderDetail, visits: JobVisit[]): Warning[] {
  const warnings: Warning[] = [];

  if (!job.assignedTechnicianIds || job.assignedTechnicianIds.length === 0) {
    warnings.push({ key: "no-tech", message: "No technician assigned", severity: "high" });
  }

  const now = new Date();
  const hasFutureVisit = visits.some(
    (v) => v.isActive && v.scheduledStart && new Date(v.scheduledStart) > now,
  );
  const isOpen = job.status === "open";
  if (isOpen && !hasFutureVisit) {
    warnings.push({ key: "no-future-visit", message: "No future visit scheduled", severity: "high" });
  }

  if (job.status === "open" && job.openSubStatus === "on_hold" && !job.holdReason) {
    warnings.push({ key: "hold-no-reason", message: "On hold — no reason recorded", severity: "medium" });
  }

  return warnings;
}

export function JobWarningsCard({ job, visits, loading }: JobWarningsCardProps) {
  const warnings = job ? deriveWarnings(job, visits) : [];
  const isEmpty = !loading && warnings.length === 0;

  if (isEmpty && !loading) return null;

  return (
    <WorkspaceSectionCard
      title="Warnings"
      loading={loading}
      empty={isEmpty}
      emptyText="No warnings."
      data-testid="job-warnings-card"
    >
      <div className="space-y-1.5">
        {warnings.map((w) => (
          <div
            key={w.key}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-1.5",
              w.severity === "high"
                ? "bg-red-50 text-red-700"
                : "bg-amber-50 text-amber-700",
            )}
            data-testid={`warning-${w.key}`}
          >
            <AlertTriangle
              className={cn(
                "h-3.5 w-3.5 shrink-0 mt-0.5",
                w.severity === "high" ? "text-red-600" : "text-amber-600",
              )}
            />
            <span className="text-helper">{w.message}</span>
          </div>
        ))}
      </div>
    </WorkspaceSectionCard>
  );
}
