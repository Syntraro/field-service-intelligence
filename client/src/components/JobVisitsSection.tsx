import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar, Plus, ChevronDown, ChevronRight, Trash2, Clock, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { JobVisit } from "@shared/schema";
import { AddVisitDialog } from "./AddVisitDialog";

interface JobVisitsSectionProps {
  jobId: string;
  defaultOpen?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  dispatched: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  en_route: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  on_site: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  on_hold: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  en_route: "En Route",
  on_site: "On Site",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function JobVisitsSection({ jobId, defaultOpen = false }: JobVisitsSectionProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const { data: visits = [], isLoading } = useQuery<JobVisit[]>({
    queryKey: ["/api/jobs", jobId, "visits"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/visits`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job visits");
      return res.json();
    },
  });

  const { data: technicians = [] } = useQuery<any[]>({
    queryKey: ["/api/technicians"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (visitId: string) => {
      await apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "visits"] });
      toast({
        title: "Visit Deleted",
        description: "The visit has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete visit.",
        variant: "destructive",
      });
    },
  });

  const getTechnicianName = (techId: string | null) => {
    if (!techId) return "Unassigned";
    const tech = technicians.find((t: any) => t.id === techId);
    if (!tech) return "Unknown";
    return tech.firstName && tech.lastName
      ? `${tech.firstName} ${tech.lastName}`
      : tech.email;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Calendar className="h-4 w-4" />
            Visits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <Card data-testid="card-job-visits">
          <CollapsibleTrigger asChild>
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover-elevate"
              data-testid="trigger-visits"
            >
              <span className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                Visits {visits.length > 0 && `(${visits.length})`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-auto p-0 text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAddDialogOpen(true);
                  }}
                  data-testid="button-add-visit"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Visit
                </Button>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t px-4 pb-4 pt-3">
              {visits.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No visits scheduled</p>
                  <p className="text-xs mt-1">Click "+ Add Visit" to schedule a site visit.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date & Time</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Technician</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="w-16">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visits.map((visit) => (
                        <TableRow key={visit.id} data-testid={`row-visit-${visit.id}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {format(new Date(visit.scheduledDate), "MMM dd, yyyy")}
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(visit.scheduledDate), "h:mm a")}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS[visit.status] || ""}>
                              {STATUS_LABELS[visit.status] || visit.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              {getTechnicianName(visit.assignedTechnicianId)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              {visit.actualDurationMinutes
                                ? `${visit.actualDurationMinutes} min (actual)`
                                : visit.estimatedDurationMinutes
                                ? `${visit.estimatedDurationMinutes} min (est.)`
                                : "-"}
                            </div>
                          </TableCell>
                          <TableCell>
                            {visit.visitNotes ? (
                              <span className="text-sm truncate max-w-xs block">
                                {visit.visitNotes}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteMutation.mutate(visit.id)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-visit-${visit.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <AddVisitDialog
        jobId={jobId}
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        technicians={technicians}
      />
    </>
  );
}
