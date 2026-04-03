/**
 * Payroll Page — Simplified weekly summary + approval (2026-04-03)
 *
 * Shows Mon–Sun hours from time_entries only. No worked/tracked/billable/untracked.
 * Day cells link to the daily admin timesheet view for detail/editing.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addDays, subDays, startOfWeek, parseISO } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  CheckCircle2,
  Calendar,
  AlertTriangle,
  Clock,
  LockKeyhole,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { TechnicianWeeklySummary, DailyPayrollBreakdown } from "@shared/schema";

const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"];
const DAY_ABBREVS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0:00";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

function getMonday(date: Date): string {
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  return format(monday, "yyyy-MM-dd");
}

export default function PayrollPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [weekStart, setWeekStart] = useState<string>(() => getMonday(new Date()));

  const weekDates = useMemo(() => {
    const monday = parseISO(weekStart);
    return Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), "yyyy-MM-dd"));
  }, [weekStart]);

  const weekEnd = weekDates[6];
  const isManager = !!(user && MANAGER_ROLES.includes(user.role));

  // Fetch weekly payroll summary
  const { data: summaries = [], isLoading, error } = useQuery<TechnicianWeeklySummary[]>({
    queryKey: ["/api/payroll/weekly", { weekStart }],
    queryFn: async () => {
      const res = await fetch(`/api/payroll/weekly?weekStart=${weekStart}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch payroll summary");
      return res.json();
    },
    enabled: isManager,
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async ({ technicianId }: { technicianId: string }) => {
      return apiRequest("/api/payroll/approve", {
        method: "POST",
        body: JSON.stringify({ technicianId, weekStart }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/weekly"] });
      toast({ title: "Week Approved", description: "Payroll week has been approved and locked." });
    },
    onError: (error: Error) => {
      toast({ title: "Approval Failed", description: error.message || "Failed to approve week", variant: "destructive" });
    },
  });

  // Navigate weeks
  const goToPreviousWeek = () => setWeekStart(format(subDays(parseISO(weekStart), 7), "yyyy-MM-dd"));
  const goToNextWeek = () => setWeekStart(format(addDays(parseISO(weekStart), 7), "yyyy-MM-dd"));
  const goToCurrentWeek = () => setWeekStart(getMonday(new Date()));

  // CSV export
  const handleExportCsv = async () => {
    try {
      const res = await fetch(`/api/payroll/weekly.csv?weekStart=${weekStart}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to export CSV");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_${weekStart}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Export Complete", description: "Payroll CSV downloaded." });
    } catch {
      toast({ title: "Export Failed", description: "Failed to download CSV", variant: "destructive" });
    }
  };

  // Navigate to daily timesheet for a specific technician + day
  const openDayDetail = (technicianId: string, date: string) => {
    setLocation(`/settings/timesheets?userId=${technicianId}&date=${date}`);
  };

  if (!isManager) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-center">
              Only managers, admins, and owners can access payroll data.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Weekly total across all technicians
  const grandTotal = useMemo(
    () => summaries.reduce((acc, s) => acc + s.totalMinutes, 0),
    [summaries]
  );

  return (
    <div className="p-4 space-y-4" data-testid="payroll-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payroll</h1>
          <p className="text-muted-foreground">Weekly time summaries and approvals</p>
        </div>
        <Button onClick={handleExportCsv} variant="outline" disabled={summaries.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Week Navigation */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={goToPreviousWeek}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous Week
            </Button>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {format(parseISO(weekStart), "MMM d")} - {format(parseISO(weekEnd), "MMM d, yyyy")}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={goToCurrentWeek}>
                Today
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={goToNextWeek}>
              Next Week
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Weekly Summary</CardTitle>
          <CardDescription>
            {summaries.length} {summaries.length === 1 ? "technician" : "technicians"} with time records
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8 text-destructive">
              <AlertTriangle className="h-8 w-8 mb-2" />
              <p>Failed to load payroll data</p>
            </div>
          ) : summaries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No time records for this week.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Technician</TableHead>
                    {DAY_ABBREVS.map((day, i) => (
                      <TableHead key={day} className="text-center w-[70px] text-xs">
                        {day}
                        <br />
                        <span className="text-muted-foreground font-normal">
                          {format(parseISO(weekDates[i]), "M/d")}
                        </span>
                      </TableHead>
                    ))}
                    <TableHead className="text-right w-[80px]">Total</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.map((summary) => (
                    <TableRow key={summary.technicianId}>
                      <TableCell className="font-medium">{summary.technicianName}</TableCell>
                      {/* Day cells — clickable to drill into daily timesheet */}
                      {summary.daily.map((day: DailyPayrollBreakdown) => (
                        <TableCell
                          key={day.date}
                          className={cn(
                            "text-center text-xs font-mono cursor-pointer hover:bg-muted/60 transition-colors",
                            day.totalMinutes === 0 && "text-muted-foreground"
                          )}
                          onClick={() => openDayDetail(summary.technicianId, day.date)}
                          title={`Click to view ${day.dayOfWeek} detail`}
                        >
                          {day.totalMinutes === 0 ? "-" : formatMinutes(day.totalMinutes)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-mono text-sm font-medium">
                        {formatMinutes(summary.totalMinutes)}
                      </TableCell>
                      <TableCell>
                        {summary.approved ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            <LockKeyhole className="h-3 w-3 mr-1" />
                            Approved
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {!summary.approved && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => approveMutation.mutate({ technicianId: summary.technicianId })}
                            disabled={approveMutation.isPending}
                          >
                            {approveMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                            )}
                            Approve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell>Total ({summaries.length})</TableCell>
                    {weekDates.map((_, i) => {
                      const dayTotal = summaries.reduce((acc, s) => acc + (s.daily[i]?.totalMinutes ?? 0), 0);
                      return (
                        <TableCell key={i} className="text-center text-xs font-mono">
                          {dayTotal === 0 ? "-" : formatMinutes(dayTotal)}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-mono">{formatMinutes(grandTotal)}</TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <LockKeyhole className="h-4 w-4 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Approval Locks</p>
              <p>
                Once a week is approved, time entries are locked. Modifications require
                manager override with a reason. Click any day cell to view and edit entries.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
