/**
 * PMEditPage — Edit an existing PM setup
 *
 * PM Phase 2C: Dedicated edit page at /pm/:id/edit
 *
 * Reuses the same field layout as the PM creation wizard (Step 3 + Step 4)
 * but loads existing template data and saves via PATCH.
 *
 * Route: /pm/:id/edit
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  Loader2,
  Save,
  Calendar,
  Wrench,
  Package,
  AlertCircle,
} from "lucide-react";
import type { RecurringJobTemplate, Client } from "@shared/schema";

// ============================================================================
// Constants
// ============================================================================

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const MONTH_PRESETS = [
  { label: "Quarterly", months: [1, 4, 7, 10] },
  { label: "Bi-Annual", months: [4, 10] },
  { label: "Annual", months: [4] },
  { label: "Monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
] as const;

// ============================================================================
// Form State
// ============================================================================

interface EditFormState {
  title: string;
  description: string;
  months: number[];
  generationMode: "period_start" | "day_of_month";
  generationDayOfMonth: number;
  autoSchedule: boolean;
  scheduledTimeLocal: string;
  defaultDurationMinutes: number;
  startDate: string;
  endDate: string;
  preferredTechnicianId: string;
  includeLocationPmParts: boolean;
  isActive: boolean;
  // PM Phase 3: Service window
  serviceWindowDaysBefore: number;
  serviceWindowDaysAfter: number;
  // PM Billing Disposition: Contract-level billing rules
  pmBillingModel: string;
  pmBillingLabel: string;
  pmContractAmount: string;
}

function templateToFormState(tpl: RecurringJobTemplate): EditFormState {
  return {
    title: tpl.title,
    description: tpl.description ?? "",
    months: tpl.monthsOfYear ?? [],
    generationMode: tpl.generationMode === "day_of_month" ? "day_of_month" : "period_start",
    generationDayOfMonth: tpl.generationDayOfMonth ?? 1,
    autoSchedule: tpl.autoSchedule ?? false,
    scheduledTimeLocal: tpl.scheduledTimeLocal ?? "09:00",
    defaultDurationMinutes: tpl.defaultDurationMinutes ?? 120,
    startDate: tpl.startDate ?? "",
    endDate: tpl.endDate ?? "",
    preferredTechnicianId: tpl.preferredTechnicianId ?? "",
    includeLocationPmParts: tpl.includeLocationPmParts ?? false,
    isActive: tpl.isActive,
    serviceWindowDaysBefore: tpl.serviceWindowDaysBefore ?? 7,
    serviceWindowDaysAfter: tpl.serviceWindowDaysAfter ?? 14,
    // PM Billing Disposition
    pmBillingModel: (tpl as any).pmBillingModel ?? "",
    pmBillingLabel: (tpl as any).pmBillingLabel ?? "",
    pmContractAmount: (tpl as any).pmContractAmount ?? "",
  };
}

// ============================================================================
// Main Component
// ============================================================================

export default function PMEditPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const templateId = params.id;
  const { toast } = useToast();
  const { teamMembers } = useTechniciansDirectory();
  const schedulableTechs = teamMembers.filter((t) => t.isSchedulable);

  const [form, setForm] = useState<EditFormState | null>(null);

  // Fetch existing template
  const {
    data: template,
    isLoading,
    isError,
  } = useQuery<RecurringJobTemplate>({
    queryKey: ["/api/recurring-templates", templateId],
    queryFn: () => apiRequest(`/api/recurring-templates/${templateId}`),
    enabled: Boolean(templateId),
  });

  // Fetch location for display
  const { data: locationsData } = useQuery<Client[]>({
    queryKey: ["/api/clients", "pm-edit-locations"],
    queryFn: () => apiRequest("/api/clients?limit=500"),
    select: (res: any) => (res?.data || res || []) as Client[],
    enabled: Boolean(template?.locationId),
  });
  const location = useMemo(
    () => (locationsData ?? []).find((c) => c.id === template?.locationId),
    [locationsData, template?.locationId]
  );
  const locationName = location
    ? [location.companyName, location.location].filter(Boolean).join(" — ")
    : template?.locationId ?? "—";

  // Fetch PM parts count for display
  const { data: pmParts = [] } = useQuery<{ id: string }[]>({
    queryKey: ["/api/locations", template?.locationId, "pm-parts"],
    queryFn: () => apiRequest(`/api/locations/${template!.locationId}/pm-parts`),
    enabled: Boolean(template?.locationId),
  });

  // Initialize form from template
  useEffect(() => {
    if (template && !form) {
      setForm(templateToFormState(template));
    }
  }, [template]);

  function onChange(patch: Partial<EditFormState>) {
    setForm((prev) => prev ? { ...prev, ...patch } : prev);
  }

  const toggleMonth = (m: number) => {
    if (!form) return;
    const newMonths = form.months.includes(m)
      ? form.months.filter((v) => v !== m)
      : [...form.months, m].sort((a, b) => a - b);
    onChange({ months: newMonths });
  };

  // Validation
  const errors: string[] = [];
  if (form) {
    if (!form.title.trim()) errors.push("PM name is required.");
    if (form.months.length === 0) errors.push("Select at least 1 month.");
    if (form.generationMode === "day_of_month" && (form.generationDayOfMonth < 1 || form.generationDayOfMonth > 31)) {
      errors.push("Day of month must be 1–31.");
    }
    if (form.autoSchedule && !/^\d{2}:\d{2}$/.test(form.scheduledTimeLocal)) {
      errors.push("Scheduled time must be HH:MM.");
    }
  }
  const isValid = form !== null && errors.length === 0;

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form || !template) return;
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        monthsOfYear: form.months,
        generationMode: form.generationMode,
        generationDayOfMonth: form.generationMode === "day_of_month" ? form.generationDayOfMonth : null,
        autoSchedule: form.autoSchedule,
        scheduledTimeLocal: form.autoSchedule ? form.scheduledTimeLocal : null,
        defaultDurationMinutes: form.autoSchedule ? form.defaultDurationMinutes : null,
        includeLocationPmParts: form.includeLocationPmParts,
        serviceWindowDaysBefore: form.serviceWindowDaysBefore,
        serviceWindowDaysAfter: form.serviceWindowDaysAfter,
        startDate: form.startDate || undefined,
        endDate: form.endDate || null,
        preferredTechnicianId: form.preferredTechnicianId || null,
        isActive: form.isActive,
        // PM Billing Disposition: Contract-level billing rules
        pmBillingModel: form.pmBillingModel || null,
        pmBillingLabel: form.pmBillingLabel.trim() || null,
        pmContractAmount: form.pmContractAmount || null,
      };
      return apiRequest(`/api/recurring-templates/${template.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", templateId] });
      toast({ title: "PM contract updated" });
      setLocation(`/pm/${templateId}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !template) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">PM setup not found.</p>
        <Button variant="outline" onClick={() => setLocation("/pm")}>Back to PM</Button>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/pm/${templateId}`)} data-testid="pm-edit-back">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Edit PM Setup</h1>
          <p className="text-sm text-muted-foreground">{locationName}</p>
        </div>
      </div>

      {/* PM Details Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            PM Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label>PM Name</Label>
            <Input
              value={form.title}
              onChange={(e) => onChange({ title: e.target.value })}
              data-testid="pm-edit-title"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Internal Notes (optional)</Label>
            <Textarea
              value={form.description}
              onChange={(e) => onChange({ description: e.target.value })}
              rows={2}
              data-testid="pm-edit-description"
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="pm-edit-active"
              checked={form.isActive}
              onCheckedChange={(v) => onChange({ isActive: Boolean(v) })}
              data-testid="pm-edit-active"
            />
            <Label htmlFor="pm-edit-active" className="cursor-pointer">
              Active (generates jobs when due)
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Schedule Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Month Picker */}
          <div className="space-y-2">
            <Label>Which months should this run?</Label>
            <div className="flex flex-wrap gap-1.5">
              {MONTH_LABELS.map((label, idx) => {
                const monthNum = idx + 1;
                const selected = form.months.includes(monthNum);
                return (
                  <button
                    key={monthNum}
                    type="button"
                    onClick={() => toggleMonth(monthNum)}
                    className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    }`}
                    data-testid={`pm-edit-month-${monthNum}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 mt-1">
              {MONTH_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onChange({ months: [...preset.months] })}
                  className="text-xs text-primary hover:underline"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Generation Mode */}
          <div className="space-y-2">
            <Label>When should jobs be created?</Label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="generationMode"
                  checked={form.generationMode === "period_start"}
                  onChange={() => onChange({ generationMode: "period_start" })}
                  className="accent-primary"
                />
                Start of each scheduled month
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="generationMode"
                  checked={form.generationMode === "day_of_month"}
                  onChange={() => onChange({ generationMode: "day_of_month" })}
                  className="accent-primary"
                />
                <span>Specific day:</span>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  className="w-16 h-7 text-sm"
                  value={form.generationDayOfMonth}
                  onChange={(e) => onChange({ generationDayOfMonth: parseInt(e.target.value, 10) || 1 })}
                  disabled={form.generationMode !== "day_of_month"}
                  data-testid="pm-edit-day-of-month"
                />
              </label>
            </div>
          </div>

          {/* Auto Schedule */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="pm-edit-auto"
                checked={form.autoSchedule}
                onCheckedChange={(v) => onChange({ autoSchedule: Boolean(v) })}
                data-testid="pm-edit-auto-schedule"
              />
              <Label htmlFor="pm-edit-auto" className="cursor-pointer">
                Automatically assign a scheduled time
              </Label>
            </div>
            {form.autoSchedule && (
              <div className="flex items-center gap-3 pl-6">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Time</Label>
                  <Input
                    type="time"
                    className="w-28 h-7 text-sm"
                    value={form.scheduledTimeLocal}
                    onChange={(e) => onChange({ scheduledTimeLocal: e.target.value })}
                    data-testid="pm-edit-time"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Duration (min)</Label>
                  <Input
                    type="number"
                    min={1}
                    className="w-20 h-7 text-sm"
                    value={form.defaultDurationMinutes}
                    onChange={(e) => onChange({ defaultDurationMinutes: parseInt(e.target.value, 10) || 120 })}
                    data-testid="pm-edit-duration"
                  />
                </div>
              </div>
            )}
          </div>

          {/* PM Phase 3: Service Window */}
          <div className="space-y-2">
            <Label>Service window</Label>
            <p className="text-xs text-muted-foreground">
              Acceptable date range around the ideal PM date.
            </p>
            <div className="flex items-center gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Days before</Label>
                <Input
                  type="number"
                  min={0}
                  max={90}
                  className="w-20 h-7 text-sm"
                  value={form.serviceWindowDaysBefore}
                  onChange={(e) => onChange({ serviceWindowDaysBefore: parseInt(e.target.value, 10) || 0 })}
                  data-testid="pm-edit-window-before"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Days after</Label>
                <Input
                  type="number"
                  min={0}
                  max={90}
                  className="w-20 h-7 text-sm"
                  value={form.serviceWindowDaysAfter}
                  onChange={(e) => onChange({ serviceWindowDaysAfter: parseInt(e.target.value, 10) || 0 })}
                  data-testid="pm-edit-window-after"
                />
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start date</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => onChange({ startDate: e.target.value })}
                data-testid="pm-edit-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label>End date (optional)</Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => onChange({ endDate: e.target.value })}
                data-testid="pm-edit-end-date"
              />
            </div>
          </div>

          {/* Preferred Technician */}
          {schedulableTechs.length > 0 && (
            <div className="space-y-2">
              <Label>Default assigned technician (optional)</Label>
              <Select
                value={form.preferredTechnicianId || "none"}
                onValueChange={(v) => onChange({ preferredTechnicianId: v === "none" ? "" : v })}
              >
                <SelectTrigger data-testid="pm-edit-technician">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {schedulableTechs.map((tech) => (
                    <SelectItem key={tech.id} value={tech.id}>
                      {tech.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* PM Billing Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            PM Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Billing model</Label>
            <Select
              value={form.pmBillingModel || "none"}
              onValueChange={(v) => onChange({ pmBillingModel: v === "none" ? "" : v })}
            >
              <SelectTrigger data-testid="pm-edit-billing-model">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                <SelectItem value="per_visit">Per Visit — Invoice each completed job</SelectItem>
                <SelectItem value="monthly_fixed">Monthly Fixed — Covered by monthly contract</SelectItem>
                <SelectItem value="annual_prepaid">Annual Prepaid — Covered by annual contract</SelectItem>
                <SelectItem value="do_not_bill">Do Not Bill — No invoice expected</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Determines how PM jobs are billed at completion. This is stamped onto each generated job.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Billing label (optional)</Label>
              <Input
                value={form.pmBillingLabel}
                onChange={(e) => onChange({ pmBillingLabel: e.target.value })}
                placeholder="e.g. Quarterly RTU PM"
                data-testid="pm-edit-billing-label"
              />
            </div>
            <div className="space-y-2">
              <Label>Contract amount (optional)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.pmContractAmount}
                onChange={(e) => onChange({ pmContractAmount: e.target.value })}
                placeholder="0.00"
                data-testid="pm-edit-contract-amount"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Parts Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            Parts & Options
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <Checkbox
              id="pm-edit-parts"
              checked={form.includeLocationPmParts}
              onCheckedChange={(v) => onChange({ includeLocationPmParts: Boolean(v) })}
              className="mt-0.5"
              data-testid="pm-edit-include-parts"
            />
            <div>
              <Label htmlFor="pm-edit-parts" className="cursor-pointer font-medium">
                Include location PM parts on generated jobs
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                Copies configured PM parts (filters, belts, etc.) to each generated job.
              </p>
              {template.locationId && (
                <p className="text-xs text-muted-foreground mt-1">
                  This location has <span className="font-medium">{pmParts.length}</span> PM part{pmParts.length !== 1 ? "s" : ""} configured.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="text-sm text-destructive space-y-1 px-1">
          {errors.map((e) => <p key={e}>{e}</p>)}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => setLocation(`/pm/${templateId}`)} data-testid="pm-edit-cancel">
          Cancel
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!isValid || saveMutation.isPending}
          data-testid="pm-edit-save"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
