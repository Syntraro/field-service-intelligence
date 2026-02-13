import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Briefcase, Calendar, MapPin } from "lucide-react";
import { getJobStatusDisplay } from "@/components/job/jobUtils";
import type { Client } from "@shared/schema";
import type { JobFeedItem } from "@/hooks/useJobsFeed";
import { format } from "date-fns";

interface ClientJobsTabProps {
  clientId: string;
  companyId: string;
  parentCompanyId?: string;
  initialLocationId?: string;
  onCreateJob?: (locationId?: string) => void;
}

export default function ClientJobsTab({ 
  clientId, 
  companyId, 
  parentCompanyId, 
  initialLocationId,
  onCreateJob 
}: ClientJobsTabProps) {
  const [, setLocation] = useLocation();
  const [selectedLocationId, setSelectedLocationId] = useState<string>(initialLocationId || "all");

  useEffect(() => {
    if (initialLocationId) {
      setSelectedLocationId(initialLocationId);
    }
  }, [initialLocationId]);

  // Get all locations under the parent company for the filter dropdown
  const { data: locations = [], isLoading: locationsLoading } = useQuery<Client[]>({
    queryKey: ["/api/customer-companies", parentCompanyId, "locations"],
    enabled: Boolean(parentCompanyId),
  });

  // Build the locationId filter - if specific location selected, use it; otherwise get all jobs for all locations
  const locationIds = selectedLocationId !== "all" 
    ? [selectedLocationId] 
    : (parentCompanyId ? locations.map(l => l.id) : [clientId]);
  
  // Fetch jobs from the Jobs API with location filter
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<{ data: JobFeedItem[]; meta: { limit: number; hasMore: boolean; nextOffset?: number } }, Error, JobFeedItem[]>({
    queryKey: ["/api/jobs", { locationIds, offset: 0, limit: 200 }],
    queryFn: async () => {
      // If we have specific location IDs to filter, use the first one
      // The API supports single locationId filter
      if (selectedLocationId !== "all") {
        const res = await fetch(`/api/jobs?locationId=${encodeURIComponent(selectedLocationId)}&offset=0&limit=200`, { credentials: "include" });
        if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.statusText}`);
        return res.json();
      }
      
      // For "all locations", fetch all jobs and filter client-side
      const res = await fetch("/api/jobs?offset=0&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.statusText}`);
      return res.json();
    },
    select: (response) => {
      const allJobs = response.data;
      // Filter to only jobs for locations under this parent company
      if (parentCompanyId && locations.length > 0) {
        const locationIdSet = new Set(locations.map(l => l.id));
        return allJobs.filter(job => job.locationId && locationIdSet.has(job.locationId));
      }
      // If no parent company, filter to just this client's jobs
      return allJobs.filter(job => job.locationId === clientId);
    },
    enabled: !locationsLoading,
  });

  const getLocationName = (locationClientId: string | null) => {
    if (!locationClientId) return "Unknown Location";
    const location = locations.find(l => l.id === locationClientId);
    return location?.location || location?.companyName || "Unknown Location";
  };

  const handleCreateJob = () => {
    if (onCreateJob) {
      onCreateJob(selectedLocationId !== "all" ? selectedLocationId : undefined);
    }
  };

  if (!parentCompanyId && !clientId) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <Briefcase className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Unable to load jobs.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (locationsLoading || jobsLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-48 mt-2" />
          </div>
          <Skeleton className="h-9 w-28" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Jobs
          </CardTitle>
          <CardDescription>
            Maintenance jobs and scheduled work for this client
          </CardDescription>
        </div>
        <Button onClick={handleCreateJob} data-testid="button-create-job">
          <Plus className="h-4 w-4 mr-2" />
          Create Job
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {parentCompanyId && locations.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Location:</span>
            <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
              <SelectTrigger className="w-[200px]" data-testid="select-location-filter">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.location || location.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {jobs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Briefcase className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No jobs found{selectedLocationId !== "all" ? " for this location" : ""}.</p>
            <p className="text-sm mt-2">Create a job to get started.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Scheduled</TableHead>
                {parentCompanyId && locations.length > 1 && <TableHead>Location</TableHead>}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow
                  key={job.id}
                  data-testid={`row-job-${job.id}`}
                  className="cursor-pointer"
                  onClick={() => setLocation(`/jobs/${job.id}`)}
                >
                  <TableCell className="font-medium">
                    {job.jobNumber || `#${job.id.slice(0, 8)}`}
                  </TableCell>
                  <TableCell>
                    <span className="line-clamp-1">{job.summary || "No summary"}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      {job.scheduledStart 
                        ? format(new Date(job.scheduledStart), "MMM d, yyyy")
                        : "Not scheduled"}
                    </div>
                  </TableCell>
                  {parentCompanyId && locations.length > 1 && (
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        <MapPin className="h-3 w-3 mr-1" />
                        {job.locationName || getLocationName(job.locationId)}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell>
                    {(() => {
                      const s = getJobStatusDisplay(job);
                      const Icon = s.icon;
                      return (
                        <Badge variant={s.variant}>
                          <Icon className="h-3 w-3 mr-1" />
                          {s.label}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
