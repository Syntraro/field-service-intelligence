import { useState, useMemo } from "react";
import type { Job, Client } from "@shared/schema";
import { isJobOverdue } from "@shared/schema";
import { getJobStatusMeta } from "@/lib/statusBadges";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { locationDisplayName } from "@/lib/clientHelpers";
import {
  EmptyState,
  FilterChips,
  type JobFilter,
} from "./tabShared";

function isJobActive(j: Job): boolean { return j.status === "open"; }
function isJobCompleted(j: Job): boolean { return j.status === "completed" || j.status === "invoiced"; }

export function ClientJobsTab({
  jobs,
  locations,
  showLocation,
  onNavigate,
}: {
  jobs: Job[];
  locations: Client[];
  showLocation: boolean;
  onNavigate: (p: string) => void;
}) {
  const [filter, setFilter] = useState<JobFilter>("all");
  const locMap = useMemo(
    () => new Map(locations.map((l) => [l.id, locationDisplayName(l)])),
    [locations],
  );
  const nonArchived = useMemo(
    () => jobs.filter((j) => j.status !== "archived"),
    [jobs],
  );
  const counts = useMemo(
    () => ({
      active: nonArchived.filter(isJobActive).length,
      all: nonArchived.length,
      completed: nonArchived.filter(isJobCompleted).length,
    }),
    [nonArchived],
  );
  const filtered = useMemo(() => {
    if (filter === "active") return nonArchived.filter(isJobActive);
    if (filter === "completed") return nonArchived.filter(isJobCompleted);
    return nonArchived;
  }, [nonArchived, filter]);

  const columns = useMemo<EntityListColumn<Job>[]>(
    () => [
      {
        id: "number",
        header: "Job #",
        kind: "badge",
        cell: { type: "entity-number", value: (j) => j.jobNumber },
        minWidthPx: 60,
        ratio: 0.5,
      },
      {
        id: "summary",
        header: "Title / Scope",
        kind: "primary",
        cell: {
          type: "entity-primary",
          value: (j) => j.summary || "Untitled",
          secondary: (j) => (j as any).jobType ?? null,
        },
        ratio: 2,
      },
      ...(showLocation
        ? [
            {
              id: "location",
              header: "Location",
              kind: "text" as const,
              cell: {
                type: "entity-text" as const,
                value: (j: Job) => locMap.get(j.locationId) ?? "—",
              },
              ratio: 1.5,
            },
          ]
        : []),
      {
        id: "status",
        header: "Status",
        kind: "status",
        cell: {
          type: "entity-status",
          getStatusMeta: (j) =>
            getJobStatusMeta({
              status: j.status,
              openSubStatus: (j as any).openSubStatus ?? null,
              _overdue: isJobOverdue(j),
              scheduledStart: j.scheduledStart ? String(j.scheduledStart) : null,
            }),
        },
        ratio: 1,
      },
      {
        id: "scheduled",
        header: "Scheduled",
        kind: "date",
        cell: {
          type: "entity-date",
          value: (j) => j.scheduledStart ?? null,
          overdueWhen: (j) => isJobOverdue(j),
        },
        ratio: 1,
      },
    ],
    [showLocation, locMap],
  );

  if (jobs.length === 0)
    return (
      <EmptyState
        label={showLocation ? "No jobs for this client" : "No jobs for this location"}
      />
    );

  return (
    <div>
      <FilterChips<JobFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "active", label: "Active", count: counts.active },
          { key: "all", label: "All", count: counts.all },
          { key: "completed", label: "Complete", count: counts.completed },
        ]}
      />
      <EntityListTable
        rows={filtered}
        columns={columns}
        rowKey={(j) => j.id}
        onRowClick={(j) => onNavigate(`/jobs/${j.id}`)}
        emptyState={{ kind: "no-results", title: "No jobs match this filter" }}
      />
    </div>
  );
}
