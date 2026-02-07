/**
 * Time Analytics Page
 * Phase 5: Utilization + Leakage Analytics Dashboard
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { format, addDays, subDays, startOfWeek, parseISO } from "date-fns";
import { useAuth } from "@/lib/auth";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Calendar,
  AlertTriangle,
  Clock,
  DollarSign,
  AlertCircle,
  TrendingUp,
  Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  WeeklyAnalyticsResponse,
  WeeklyAnalyticsData,
  TechnicianAnalyticsResponse,
  TechnicianAnalytics,
} from "@shared/schema";

// Manager roles that can access this page
const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"];

// Format minutes as hours:minutes
function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0:00";
  const negative = minutes < 0;
  const absMinutes = Math.abs(minutes);
  const hrs = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  return `${negative ? "-" : ""}${hrs}:${mins.toString().padStart(2, "0")}`;
}

// Format minutes as decimal hours
function formatDecimalHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

// Get Monday of the current week
function getMonday(date: Date): string {
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  return format(monday, "yyyy-MM-dd");
}

// Type breakdown labels
const TYPE_LABELS: Record<string, string> = {
  travel_to_job: "Travel to Job",
  on_site: "On Site",
  travel_to_supplier: "To Supplier",
  supplier_run: "Supplier",
  travel_between_jobs: "Between Jobs",
  admin: "Admin",
  break: "Break",
  other: "Other",
};

// Type colors for the chart
const TYPE_COLORS: Record<string, string> = {
  on_site: "bg-green-500",
  travel_to_job: "bg-blue-500",
  travel_between_jobs: "bg-blue-400",
  travel_to_supplier: "bg-purple-400",
  supplier_run: "bg-purple-500",
  admin: "bg-orange-500",
  break: "bg-gray-400",
  other: "bg-gray-500",
};

interface Technician {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
}

export default function TimeAnalyticsPage() {
  const { user } = useAuth();

  // State
  const [numWeeks, setNumWeeks] = useState<number>(8);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<string>(() => getMonday(new Date()));

  // Check if user has manager access
  const isManager = !!(user && MANAGER_ROLES.includes(user.role));

  // Fetch technicians for dropdown
  const { teamMembers: technicians } = useTechniciansDirectory();

  // Fetch weekly analytics
  const { data: weeklyData, isLoading: weeklyLoading, error: weeklyError } = useQuery<WeeklyAnalyticsResponse>({
    queryKey: ["/api/analytics/time/weekly", { weeks: numWeeks, weekStart, technicianId: selectedTechnicianId }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("weeks", numWeeks.toString());
      params.set("weekStart", weekStart);
      if (selectedTechnicianId) {
        params.set("technicianId", selectedTechnicianId);
      }
      const res = await fetch(`/api/analytics/time/weekly?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch weekly analytics");
      return res.json();
    },
    enabled: isManager,
  });

  // Fetch technician analytics for selected week
  const { data: technicianData, isLoading: techLoading } = useQuery<TechnicianAnalyticsResponse>({
    queryKey: ["/api/analytics/time/technicians", { weekStart }],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/time/technicians?weekStart=${weekStart}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch technician analytics");
      return res.json();
    },
    enabled: isManager,
  });

  // Week navigation
  const goToPreviousWeek = () => {
    const monday = parseISO(weekStart);
    setWeekStart(format(subDays(monday, 7), "yyyy-MM-dd"));
  };

  const goToNextWeek = () => {
    const monday = parseISO(weekStart);
    setWeekStart(format(addDays(monday, 7), "yyyy-MM-dd"));
  };

  const goToCurrentWeek = () => {
    setWeekStart(getMonday(new Date()));
  };

  // Calculate selected week end for display
  const selectedWeekEnd = useMemo(() => {
    const monday = parseISO(weekStart);
    return format(addDays(monday, 6), "yyyy-MM-dd");
  }, [weekStart]);

  // Get most recent week data for breakdown chart
  const currentWeekData = useMemo(() => {
    if (!weeklyData?.weeks?.length) return null;
    // Find the week matching our selected weekStart
    return weeklyData.weeks.find(w => w.weekStart === weekStart) || weeklyData.weeks[weeklyData.weeks.length - 1];
  }, [weeklyData, weekStart]);

  // Calculate type breakdown for pie/bar display
  const typeBreakdown = useMemo(() => {
    if (!currentWeekData) return [];
    const { byTypeMinutes } = currentWeekData;
    const total = Object.values(byTypeMinutes).reduce((a, b) => a + b, 0);
    if (total === 0) return [];

    return Object.entries(byTypeMinutes)
      .filter(([_, mins]) => mins > 0)
      .map(([type, mins]) => ({
        type,
        label: TYPE_LABELS[type] || type,
        minutes: mins,
        percentage: Math.round((mins / total) * 100),
        color: TYPE_COLORS[type] || "bg-gray-500",
      }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [currentWeekData]);

  // Show forbidden message if not a manager
  if (!isManager) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-center">
              You do not have permission to view this page.
              <br />
              Only managers, admins, and owners can access time analytics.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" data-testid="time-analytics-page">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Time Analytics</h1>
        <p className="text-muted-foreground">
          Utilization trends, time breakdown, and leakage identification
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Week Navigation */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={goToPreviousWeek}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">
                  {format(parseISO(weekStart), "MMM d")} - {format(parseISO(selectedWeekEnd), "MMM d, yyyy")}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={goToNextWeek}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToCurrentWeek}>
                Today
              </Button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
              <Select
                value={numWeeks.toString()}
                onValueChange={(v) => setNumWeeks(parseInt(v, 10))}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">8 Weeks</SelectItem>
                  <SelectItem value="12">12 Weeks</SelectItem>
                  <SelectItem value="16">16 Weeks</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={selectedTechnicianId}
                onValueChange={setSelectedTechnicianId}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All Technicians" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Technicians</SelectItem>
                  {technicians.map((tech) => (
                    <SelectItem key={tech.id} value={tech.id}>
                      {tech.fullName || tech.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {weeklyLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : weeklyError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-destructive">
            <AlertTriangle className="h-8 w-8 mb-2" />
            <p>Failed to load analytics data</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Worked</span>
                </div>
                <div className="text-2xl font-bold">
                  {formatDecimalHours(weeklyData?.totals.workedMinutes ?? 0)}h
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatMinutes(weeklyData?.totals.workedMinutes ?? 0)} total
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Tracked</span>
                </div>
                <div className="text-2xl font-bold">
                  {formatDecimalHours(weeklyData?.totals.trackedMinutes ?? 0)}h
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatMinutes(weeklyData?.totals.trackedMinutes ?? 0)} total
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-muted-foreground">Billable</span>
                </div>
                <div className="text-2xl font-bold text-green-600">
                  {formatDecimalHours(weeklyData?.totals.billableMinutes ?? 0)}h
                </div>
                <p className="text-xs text-muted-foreground">
                  {weeklyData?.totals.trackedMinutes
                    ? Math.round((weeklyData.totals.billableMinutes / weeklyData.totals.trackedMinutes) * 100)
                    : 0}% of tracked
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span className="text-sm text-muted-foreground">Leakage</span>
                </div>
                <div className="text-2xl font-bold text-amber-600">
                  {formatDecimalHours(
                    Math.max(0, weeklyData?.totals.untrackedMinutesRaw ?? 0) +
                    (weeklyData?.totals.unassignedMinutes ?? 0)
                  )}h
                </div>
                <p className="text-xs text-muted-foreground">
                  Untracked: {formatMinutes(Math.max(0, weeklyData?.totals.untrackedMinutesRaw ?? 0))} |
                  Unassigned: {formatMinutes(weeklyData?.totals.unassignedMinutes ?? 0)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Weekly Trend Chart (Simple Bar Chart) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Weekly Trend</CardTitle>
                <CardDescription>Worked vs Tracked vs Billable hours</CardDescription>
              </CardHeader>
              <CardContent>
                {weeklyData?.weeks?.length ? (
                  <div className="space-y-2">
                    {weeklyData.weeks.slice(-8).map((week) => {
                      const maxMinutes = Math.max(week.workedMinutes, week.trackedMinutes, 1);
                      return (
                        <div key={week.weekStart} className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{format(parseISO(week.weekStart), "MMM d")}</span>
                            <span>
                              {formatDecimalHours(week.workedMinutes)}h / {formatDecimalHours(week.trackedMinutes)}h / {formatDecimalHours(week.billableMinutes)}h
                            </span>
                          </div>
                          <div className="flex gap-0.5 h-4">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="bg-slate-300 rounded-sm"
                                    style={{ width: `${(week.workedMinutes / maxMinutes) * 100}%` }}
                                  />
                                </TooltipTrigger>
                                <TooltipContent>Worked: {formatMinutes(week.workedMinutes)}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <div className="flex gap-0.5 h-4">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="bg-blue-400 rounded-sm"
                                    style={{ width: `${(week.trackedMinutes / maxMinutes) * 100}%` }}
                                  />
                                </TooltipTrigger>
                                <TooltipContent>Tracked: {formatMinutes(week.trackedMinutes)}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <div className="flex gap-0.5 h-4">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="bg-green-500 rounded-sm"
                                    style={{ width: `${(week.billableMinutes / maxMinutes) * 100}%` }}
                                  />
                                </TooltipTrigger>
                                <TooltipContent>Billable: {formatMinutes(week.billableMinutes)}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex gap-4 text-xs text-muted-foreground pt-2">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 bg-slate-300 rounded-sm" /> Worked</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-400 rounded-sm" /> Tracked</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded-sm" /> Billable</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No data for selected period</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Time Breakdown by Type (Horizontal Bar Chart) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Time by Type</CardTitle>
                <CardDescription>
                  Week of {format(parseISO(weekStart), "MMM d, yyyy")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {typeBreakdown.length > 0 ? (
                  <div className="space-y-2">
                    {typeBreakdown.map((item) => (
                      <div key={item.type} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>{item.label}</span>
                          <span className="text-muted-foreground">
                            {formatMinutes(item.minutes)} ({item.percentage}%)
                          </span>
                        </div>
                        <div className="h-4 bg-muted rounded-sm overflow-hidden">
                          <div
                            className={cn("h-full rounded-sm", item.color)}
                            style={{ width: `${item.percentage}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No tracked time for selected week</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Technician Breakdown Table */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <CardTitle className="text-sm">Technician Breakdown</CardTitle>
              </div>
              <CardDescription>
                Week of {format(parseISO(weekStart), "MMM d, yyyy")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {techLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : technicianData?.technicians?.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Technician</TableHead>
                        <TableHead className="text-right">Worked</TableHead>
                        <TableHead className="text-right">Tracked</TableHead>
                        <TableHead className="text-right">Billable</TableHead>
                        <TableHead className="text-right">Billable %</TableHead>
                        <TableHead className="text-right">Unassigned</TableHead>
                        <TableHead className="text-right">Untracked</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {technicianData.technicians.map((tech) => {
                        const hasLeakage = tech.unassignedMinutes > 0 || tech.untrackedMinutesRaw > 30;
                        return (
                          <TableRow key={tech.technicianId}>
                            <TableCell className="font-medium">
                              {tech.technicianName || "Unknown"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatMinutes(tech.workedMinutes)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatMinutes(tech.trackedMinutes)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-green-600">
                              {formatMinutes(tech.billableMinutes)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right font-mono text-sm",
                                tech.billablePct < 50 && "text-amber-600"
                              )}
                            >
                              {tech.billablePct}%
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right font-mono text-sm",
                                tech.unassignedMinutes > 0 && "text-amber-600"
                              )}
                            >
                              {formatMinutes(tech.unassignedMinutes)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right font-mono text-sm",
                                tech.untrackedMinutesRaw > 30 && "text-amber-600"
                              )}
                            >
                              {formatMinutes(Math.max(0, tech.untrackedMinutesRaw))}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No technician data for selected week</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card>
            <CardContent className="py-3">
              <div className="flex items-start gap-3 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Understanding the Metrics</p>
                  <ul className="list-disc list-inside space-y-1 mt-1">
                    <li><strong>Worked:</strong> Total clock-in to clock-out time minus breaks (from work sessions)</li>
                    <li><strong>Tracked:</strong> Sum of all completed time entries</li>
                    <li><strong>Billable:</strong> Time entries marked as billable</li>
                    <li><strong>Untracked:</strong> Worked time not accounted for in time entries (potential leakage)</li>
                    <li><strong>Unassigned:</strong> Time entries not linked to any job (review in Unassigned Time page)</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
