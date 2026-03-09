/**
 * PMWizardPage — Guided PM creation wizard at /pm/new
 *
 * PM Phase 2B: Step-by-step PM setup using the modern recurring template system.
 *
 * Steps:
 *   1. Target selection (customer company + location)
 *   2. Setup type (from scratch vs prefill from existing template)
 *   3. PM basics (name, recurrence, months, generation mode, scheduling)
 *   4. Equipment / parts options
 *   5. Review and create
 *
 * Supports query-param prefill:
 *   /pm/new?locationId=123           — prefill location + derive customer
 *   /pm/new?fromTemplateId=456       — prefill from existing template
 *   /pm/new?duplicate=456            — alias for fromTemplateId
 *
 * Creates templates via POST /api/recurring-templates (modern engine).
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { Card, CardContent } from "@/components/ui/card";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Check,
  Loader2,
  MapPin,
  Building2,
  Wrench,
  Package,
  ClipboardCheck,
} from "lucide-react";
import type { Client, RecurringJobTemplate } from "@shared/schema";

// ============================================================================
// Types & Constants
// ============================================================================

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const MONTH_PRESETS = [
  { label: "Quarterly", months: [1, 4, 7, 10] },
  { label: "Bi-Annual", months: [4, 10] },
  { label: "Annual", months: [4] },
  { label: "Monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
] as const;

const STEPS = [
  { key: "target", label: "Location", icon: MapPin },
  { key: "type", label: "Setup Type", icon: Building2 },
  { key: "basics", label: "PM Details", icon: Wrench },
  { key: "parts", label: "Parts", icon: Package },
  { key: "review", label: "Review", icon: ClipboardCheck },
] as const;

interface CustomerCompanyLite {
  id: string;
  companyName: string;
}

interface WizardState {
  // Step 1 — target
  customerCompanyId: string;
  locationId: string;
  locationName: string;
  customerName: string;
  // Step 2 — type
  fromTemplateId: string | null;
  // Step 3 — basics
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
  // Step 4 — parts
  includeLocationPmParts: boolean;
  // PM Phase 3: Service window
  serviceWindowDaysBefore: number;
  serviceWindowDaysAfter: number;
}

function initialState(): WizardState {
  return {
    customerCompanyId: "",
    locationId: "",
    locationName: "",
    customerName: "",
    fromTemplateId: null,
    title: "",
    description: "",
    months: [],
    generationMode: "period_start",
    generationDayOfMonth: 1,
    autoSchedule: false,
    scheduledTimeLocal: "09:00",
    defaultDurationMinutes: 120,
    startDate: new Date().toISOString().split("T")[0],
    endDate: "",
    preferredTechnicianId: "",
    includeLocationPmParts: true,
    serviceWindowDaysBefore: 7,
    serviceWindowDaysAfter: 14,
  };
}

// ============================================================================
// Stepper Component
// ============================================================================

function Stepper({ currentStep, steps }: { currentStep: number; steps: typeof STEPS }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((step, idx) => {
        const isActive = idx === currentStep;
        const isCompleted = idx < currentStep;
        const Icon = step.icon;
        return (
          <div key={step.key} className="flex items-center gap-1">
            {idx > 0 && (
              <div className={`h-px w-6 ${isCompleted ? "bg-primary" : "bg-border"}`} />
            )}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : isCompleted
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{step.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Step 1 — Target Selection
// ============================================================================

function StepTarget({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const [companyOpen, setCompanyOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);

  // Fetch customer companies
  const { data: companiesData } = useQuery<CustomerCompanyLite[]>({
    queryKey: ["/api/customer-companies"],
  });
  const companies = companiesData ?? [];

  // Fetch locations for selected company
  const { data: locationsData } = useQuery<Client[]>({
    queryKey: ["/api/clients", "pm-wizard-locations"],
    queryFn: () => apiRequest("/api/clients?limit=500"),
    select: (res: any) => (res?.data || res || []) as Client[],
  });

  const allLocations = (locationsData ?? []).filter((c: Client) => !c.inactive);

  // Filter locations by selected company
  const filteredLocations = state.customerCompanyId
    ? allLocations.filter((loc) => loc.parentCompanyId === state.customerCompanyId)
    : allLocations;

  const handleSelectCompany = (companyId: string) => {
    const company = companies.find((c) => c.id === companyId);
    onChange({
      customerCompanyId: companyId,
      customerName: company?.companyName ?? "",
      locationId: "",
      locationName: "",
    });
    setCompanyOpen(false);
  };

  const handleSelectLocation = (locationId: string) => {
    const loc = allLocations.find((c) => c.id === locationId);
    if (loc) {
      // Auto-fill customer if not already set
      const customerPatch: Partial<WizardState> = {
        locationId: loc.id,
        locationName: [loc.companyName, loc.location].filter(Boolean).join(" — "),
      };
      if (!state.customerCompanyId && loc.parentCompanyId) {
        const company = companies.find((c) => c.id === loc.parentCompanyId);
        customerPatch.customerCompanyId = loc.parentCompanyId;
        customerPatch.customerName = company?.companyName ?? loc.companyName;
      }
      onChange(customerPatch);
    }
    setLocationOpen(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Where is this PM for?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select the customer and service location for this maintenance schedule.
        </p>
      </div>

      {/* Customer Company Picker */}
      <div className="space-y-2">
        <Label>Customer Company</Label>
        <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              className="w-full justify-between font-normal"
              data-testid="pm-wizard-company-select"
            >
              {state.customerName || "Select a customer..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search customers..." />
              <CommandList>
                <CommandEmpty>No customers found.</CommandEmpty>
                <CommandGroup>
                  {companies.map((company) => (
                    <CommandItem
                      key={company.id}
                      value={company.companyName}
                      onSelect={() => handleSelectCompany(company.id)}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${
                          state.customerCompanyId === company.id ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {company.companyName}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <p className="text-xs text-muted-foreground">
          Optional — you can also pick a location directly.
        </p>
      </div>

      {/* Location Picker */}
      <div className="space-y-2">
        <Label>Service Location</Label>
        <Popover open={locationOpen} onOpenChange={setLocationOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              className="w-full justify-between font-normal"
              data-testid="pm-wizard-location-select"
            >
              {state.locationName || "Select a location..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[400px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search locations..." />
              <CommandList>
                <CommandEmpty>No locations found.</CommandEmpty>
                <CommandGroup>
                  {filteredLocations.map((loc) => (
                    <CommandItem
                      key={loc.id}
                      value={[loc.companyName, loc.location, loc.address, loc.city].filter(Boolean).join(" ")}
                      onSelect={() => handleSelectLocation(loc.id)}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 shrink-0 ${
                          state.locationId === loc.id ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{loc.companyName}</div>
                        {loc.location && (
                          <div className="text-xs text-muted-foreground truncate">{loc.location}</div>
                        )}
                        {loc.address && (
                          <div className="text-xs text-muted-foreground truncate">{loc.address}, {loc.city}</div>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// ============================================================================
// Step 2 — Setup Type
// ============================================================================

function StepType({
  state,
  onChange,
  templates,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  templates: RecurringJobTemplate[];
}) {
  const pmTemplates = templates.filter(
    (t) => t.jobType === "maintenance" || (t.monthsOfYear && t.monthsOfYear.length > 0)
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">How do you want to start?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Create from scratch or use an existing PM setup as a starting point.
        </p>
      </div>

      <div className="grid gap-3">
        {/* From scratch */}
        <button
          type="button"
          onClick={() => onChange({ fromTemplateId: null })}
          className={`text-left p-4 rounded-lg border-2 transition-colors ${
            state.fromTemplateId === null
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/30"
          }`}
          data-testid="pm-wizard-from-scratch"
        >
          <div className="font-medium">Start from scratch</div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure all PM settings manually.
          </p>
        </button>

        {/* From existing template */}
        {pmTemplates.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                if (!state.fromTemplateId) {
                  onChange({ fromTemplateId: pmTemplates[0].id });
                }
              }}
              className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                state.fromTemplateId
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/30"
              }`}
              data-testid="pm-wizard-from-existing"
            >
              <div className="font-medium">Copy from existing PM setup</div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Start with settings from another PM schedule, then adjust.
              </p>
            </button>

            {state.fromTemplateId && (
              <Select
                value={state.fromTemplateId}
                onValueChange={(id) => onChange({ fromTemplateId: id })}
              >
                <SelectTrigger className="ml-4 w-auto" data-testid="pm-wizard-template-select">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  {pmTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title} {t.isActive ? "" : "(Paused)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Step 3 — PM Basics
// ============================================================================

function StepBasics({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const { teamMembers } = useTechniciansDirectory();
  const schedulableTechs = teamMembers.filter((t) => t.isSchedulable);

  const toggleMonth = (m: number) => {
    const newMonths = state.months.includes(m)
      ? state.months.filter((v) => v !== m)
      : [...state.months, m].sort((a, b) => a - b);
    onChange({ months: newMonths });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">PM schedule details</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure when and how maintenance jobs are created.
        </p>
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label>PM Name</Label>
        <Input
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Quarterly HVAC PM — Warehouse"
          data-testid="pm-wizard-title"
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label>Internal Notes (optional)</Label>
        <Textarea
          value={state.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Any special instructions for this PM..."
          rows={2}
          data-testid="pm-wizard-description"
        />
      </div>

      {/* Month Picker */}
      <div className="space-y-2">
        <Label>Which months should this run?</Label>
        <div className="flex flex-wrap gap-1.5">
          {MONTH_LABELS.map((label, idx) => {
            const monthNum = idx + 1;
            const selected = state.months.includes(monthNum);
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
                data-testid={`pm-wizard-month-${monthNum}`}
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
              checked={state.generationMode === "period_start"}
              onChange={() => onChange({ generationMode: "period_start" })}
              className="accent-primary"
            />
            Start of each scheduled month
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="generationMode"
              checked={state.generationMode === "day_of_month"}
              onChange={() => onChange({ generationMode: "day_of_month" })}
              className="accent-primary"
            />
            <span>Specific day:</span>
            <Input
              type="number"
              min={1}
              max={31}
              className="w-16 h-7 text-sm"
              value={state.generationDayOfMonth}
              onChange={(e) => onChange({ generationDayOfMonth: parseInt(e.target.value, 10) || 1 })}
              disabled={state.generationMode !== "day_of_month"}
              data-testid="pm-wizard-day-of-month"
            />
          </label>
        </div>
      </div>

      {/* Auto Schedule */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="pm-wizard-auto"
            checked={state.autoSchedule}
            onCheckedChange={(v) => onChange({ autoSchedule: Boolean(v) })}
            data-testid="pm-wizard-auto-schedule"
          />
          <Label htmlFor="pm-wizard-auto" className="cursor-pointer">
            Automatically assign a scheduled time
          </Label>
        </div>
        {state.autoSchedule && (
          <div className="flex items-center gap-3 pl-6">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Time</Label>
              <Input
                type="time"
                className="w-28 h-7 text-sm"
                value={state.scheduledTimeLocal}
                onChange={(e) => onChange({ scheduledTimeLocal: e.target.value })}
                data-testid="pm-wizard-time"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Duration (min)</Label>
              <Input
                type="number"
                min={1}
                className="w-20 h-7 text-sm"
                value={state.defaultDurationMinutes}
                onChange={(e) => onChange({ defaultDurationMinutes: parseInt(e.target.value, 10) || 120 })}
                data-testid="pm-wizard-duration"
              />
            </div>
          </div>
        )}
      </div>

      {/* PM Phase 3: Service Window */}
      <div className="space-y-2">
        <Label>Service window</Label>
        <p className="text-xs text-muted-foreground">
          How many days before/after the ideal date is acceptable for this PM?
        </p>
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Days before</Label>
            <Input
              type="number"
              min={0}
              max={90}
              className="w-20 h-7 text-sm"
              value={state.serviceWindowDaysBefore}
              onChange={(e) => onChange({ serviceWindowDaysBefore: parseInt(e.target.value, 10) || 0 })}
              data-testid="pm-wizard-window-before"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Days after</Label>
            <Input
              type="number"
              min={0}
              max={90}
              className="w-20 h-7 text-sm"
              value={state.serviceWindowDaysAfter}
              onChange={(e) => onChange({ serviceWindowDaysAfter: parseInt(e.target.value, 10) || 0 })}
              data-testid="pm-wizard-window-after"
            />
          </div>
        </div>
      </div>

      {/* Start Date */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start date</Label>
          <Input
            type="date"
            value={state.startDate}
            onChange={(e) => onChange({ startDate: e.target.value })}
            data-testid="pm-wizard-start-date"
          />
        </div>
        <div className="space-y-2">
          <Label>End date (optional)</Label>
          <Input
            type="date"
            value={state.endDate}
            onChange={(e) => onChange({ endDate: e.target.value })}
            data-testid="pm-wizard-end-date"
          />
        </div>
      </div>

      {/* Preferred Technician */}
      {schedulableTechs.length > 0 && (
        <div className="space-y-2">
          <Label>Default assigned technician (optional)</Label>
          <Select
            value={state.preferredTechnicianId || "none"}
            onValueChange={(v) => onChange({ preferredTechnicianId: v === "none" ? "" : v })}
          >
            <SelectTrigger data-testid="pm-wizard-technician">
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
    </div>
  );
}

// ============================================================================
// Step 4 — Equipment / Parts
// ============================================================================

function StepParts({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  // Fetch PM parts count for the selected location
  const { data: pmParts = [] } = useQuery<{ id: string }[]>({
    queryKey: ["/api/locations", state.locationId, "pm-parts"],
    queryFn: () => apiRequest(`/api/locations/${state.locationId}/pm-parts`),
    enabled: Boolean(state.locationId),
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Parts and equipment</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how parts are handled when PM jobs are generated.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="pm-wizard-parts"
              checked={state.includeLocationPmParts}
              onCheckedChange={(v) => onChange({ includeLocationPmParts: Boolean(v) })}
              className="mt-0.5"
              data-testid="pm-wizard-include-parts"
            />
            <div>
              <Label htmlFor="pm-wizard-parts" className="cursor-pointer font-medium">
                Include location PM parts on generated jobs
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                When enabled, each generated PM job automatically gets the parts
                configured on this location's PM parts list (filters, belts, etc.).
              </p>
              {state.locationId && (
                <p className="text-xs text-muted-foreground mt-2">
                  This location has <span className="font-medium">{pmParts.length}</span> PM part{pmParts.length !== 1 ? "s" : ""} configured.
                  {pmParts.length === 0 && " You can add parts on the location detail page later."}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Equipment and detailed part editing can be managed from the location detail page after setup.
      </p>
    </div>
  );
}

// ============================================================================
// Step 5 — Review
// ============================================================================

function StepReview({ state }: { state: WizardState }) {
  const monthNames = state.months.map((m) => MONTH_LABELS[m - 1]).join(", ");
  const genLabel =
    state.generationMode === "period_start"
      ? "Start of each month"
      : `Day ${state.generationDayOfMonth} of each month`;
  const schedLabel = state.autoSchedule
    ? `Auto at ${state.scheduledTimeLocal}, ${state.defaultDurationMinutes} min`
    : "Manual (unscheduled)";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Review your PM setup</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Confirm everything looks right before creating.
        </p>
      </div>

      <div className="rounded-lg border divide-y text-sm">
        <Row label="Customer" value={state.customerName || "—"} />
        <Row label="Location" value={state.locationName || "—"} />
        <Row label="PM Name" value={state.title || "—"} />
        {state.description && <Row label="Notes" value={state.description} />}
        <Row label="Months" value={monthNames || "None selected"} />
        <Row label="Job creation" value={genLabel} />
        <Row label="Scheduling" value={schedLabel} />
        <Row label="Start date" value={state.startDate || "Today"} />
        {state.endDate && <Row label="End date" value={state.endDate} />}
        <Row label="Service window" value={`${state.serviceWindowDaysBefore}d before — ${state.serviceWindowDaysAfter}d after`} />
        <Row label="Location PM parts" value={state.includeLocationPmParts ? "Included" : "Not included"} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right max-w-[60%]">{value}</span>
    </div>
  );
}

// ============================================================================
// Main Wizard Page
// ============================================================================

export default function PMWizardPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);

  // Parse query params
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const prefillLocationId = params.get("locationId");
  const prefillTemplateId = params.get("fromTemplateId") || params.get("duplicate");

  // Fetch all templates for prefill/type step
  const { data: templates = [] } = useQuery<RecurringJobTemplate[]>({
    queryKey: ["/api/recurring-templates"],
  });

  // Fetch all locations for prefill
  const { data: locationsData } = useQuery<Client[]>({
    queryKey: ["/api/clients", "pm-wizard-locations"],
    queryFn: () => apiRequest("/api/clients?limit=500"),
    select: (res: any) => (res?.data || res || []) as Client[],
  });
  const allLocations = locationsData ?? [];

  // Fetch customer companies for name resolution
  const { data: companiesData } = useQuery<CustomerCompanyLite[]>({
    queryKey: ["/api/customer-companies"],
  });
  const companies = companiesData ?? [];

  // Prefill from query params (once data is available)
  useEffect(() => {
    if (prefillLocationId && allLocations.length > 0) {
      const loc = allLocations.find((c) => c.id === prefillLocationId);
      if (loc) {
        const company = companies.find((c) => c.id === loc.parentCompanyId);
        setState((prev) => ({
          ...prev,
          locationId: loc.id,
          locationName: [loc.companyName, loc.location].filter(Boolean).join(" — "),
          customerCompanyId: loc.parentCompanyId ?? "",
          customerName: company?.companyName ?? loc.companyName,
          title: prev.title || `PM - ${loc.companyName}${loc.location ? ` — ${loc.location}` : ""}`,
        }));
        // Skip target step if location is prefilled
        if (step === 0) setStep(1);
      }
    }
  }, [prefillLocationId, allLocations.length, companies.length]);

  // Prefill from existing template
  useEffect(() => {
    if (prefillTemplateId && templates.length > 0) {
      const tpl = templates.find((t) => t.id === prefillTemplateId);
      if (tpl) {
        applyTemplateToState(tpl);
      }
    }
  }, [prefillTemplateId, templates.length]);

  function applyTemplateToState(tpl: RecurringJobTemplate) {
    const loc = allLocations.find((c) => c.id === tpl.locationId);
    const company = companies.find((c) => c.id === loc?.parentCompanyId);

    setState((prev) => ({
      ...prev,
      // Don't override location if already set by prefill
      customerCompanyId: prev.customerCompanyId || loc?.parentCompanyId || "",
      customerName: prev.customerName || company?.companyName || loc?.companyName || "",
      locationId: prev.locationId || tpl.locationId || "",
      locationName: prev.locationName || (loc ? [loc.companyName, loc.location].filter(Boolean).join(" — ") : ""),
      fromTemplateId: tpl.id,
      title: `${tpl.title} (Copy)`,
      description: tpl.description ?? "",
      months: tpl.monthsOfYear ?? [],
      generationMode: tpl.generationMode === "day_of_month" ? "day_of_month" : "period_start",
      generationDayOfMonth: tpl.generationDayOfMonth ?? 1,
      autoSchedule: tpl.autoSchedule ?? false,
      scheduledTimeLocal: tpl.scheduledTimeLocal ?? "09:00",
      defaultDurationMinutes: tpl.defaultDurationMinutes ?? 120,
      startDate: new Date().toISOString().split("T")[0],
      endDate: tpl.endDate ?? "",
      preferredTechnicianId: tpl.preferredTechnicianId ?? "",
      includeLocationPmParts: tpl.includeLocationPmParts ?? true,
      serviceWindowDaysBefore: tpl.serviceWindowDaysBefore ?? 7,
      serviceWindowDaysAfter: tpl.serviceWindowDaysAfter ?? 14,
    }));
  }

  function onChange(patch: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  // When user selects a template in Step 2, prefill state
  function handleTypeChange(patch: Partial<WizardState>) {
    onChange(patch);
    if (patch.fromTemplateId) {
      const tpl = templates.find((t) => t.id === patch.fromTemplateId);
      if (tpl) applyTemplateToState(tpl);
    }
  }

  // Auto-generate title if empty when entering step 3
  useEffect(() => {
    if (step === 2 && !state.title && state.locationName) {
      onChange({ title: `PM - ${state.locationName}` });
    }
  }, [step]);

  // Step validation
  function canProceed(): boolean {
    switch (step) {
      case 0: return Boolean(state.locationId);
      case 1: return true; // from-scratch is default
      case 2: return Boolean(state.title.trim()) && state.months.length > 0;
      case 3: return true;
      case 4: return true;
      default: return false;
    }
  }

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: state.title.trim(),
        description: state.description.trim() || null,
        notes: null,
        locationId: state.locationId || null,
        clientId: state.customerCompanyId || null, // FK to customer_companies
        jobType: "maintenance" as const,
        recurrenceKind: "monthly" as const,
        interval: 1,
        startDate: state.startDate || new Date().toISOString().split("T")[0],
        endDate: state.endDate || null,
        monthsOfYear: state.months,
        generationMode: state.generationMode,
        generationDayOfMonth: state.generationMode === "day_of_month" ? state.generationDayOfMonth : null,
        autoSchedule: state.autoSchedule,
        scheduledTimeLocal: state.autoSchedule ? state.scheduledTimeLocal : null,
        defaultDurationMinutes: state.autoSchedule ? state.defaultDurationMinutes : null,
        includeLocationPmParts: state.includeLocationPmParts,
        serviceWindowDaysBefore: state.serviceWindowDaysBefore,
        serviceWindowDaysAfter: state.serviceWindowDaysAfter,
        preferredTechnicianId: state.preferredTechnicianId || null,
        isActive: true,
      };
      return apiRequest<RecurringJobTemplate>("/api/recurring-templates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (savedTemplate) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });

      // Auto-generate current month job if applicable
      const currentMonth = new Date().getMonth() + 1;
      if (savedTemplate?.id && state.months.includes(currentMonth)) {
        try {
          await apiRequest(
            `/api/recurring-templates/${savedTemplate.id}/generate?scope=current_month`,
            { method: "POST" }
          );
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
        } catch {
          // Non-fatal
        }
      }

      toast({
        title: "PM setup created",
        description: `"${state.title}" is now active and will generate jobs automatically.`,
      });
      setLocation("/pm");
    },
    onError: (err: Error) => {
      toast({ title: "Error creating PM setup", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 lg:p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/pm")} data-testid="pm-wizard-back">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">New PM Setup</h1>
      </div>

      {/* Stepper */}
      <Stepper currentStep={step} steps={STEPS} />

      {/* Step Content */}
      <Card>
        <CardContent className="pt-6">
          {step === 0 && <StepTarget state={state} onChange={onChange} />}
          {step === 1 && <StepType state={state} onChange={handleTypeChange} templates={templates} />}
          {step === 2 && <StepBasics state={state} onChange={onChange} />}
          {step === 3 && <StepParts state={state} onChange={onChange} />}
          {step === 4 && <StepReview state={state} />}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1) as any)}
          disabled={step === 0}
          data-testid="pm-wizard-prev"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        {step < 4 ? (
          <Button
            onClick={() => setStep((s) => Math.min(4, s + 1) as any)}
            disabled={!canProceed()}
            data-testid="pm-wizard-next"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            data-testid="pm-wizard-create"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              "Create PM Setup"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
