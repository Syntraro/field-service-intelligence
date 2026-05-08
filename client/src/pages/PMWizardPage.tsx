/**
 * PMWizardPage — Create Maintenance Plan wizard at /pm/new
 *
 * 2026-04-26 Redesign: Wide-layout 4-step flow (Basics → Schedule →
 * Pricing & Contract → Review) with a live "Plan Preview" sidebar.
 *
 * Replaces the previous 5-step flow. The Parts step and the
 * "Include location PM parts" option were removed — parts are managed
 * separately on the location detail page. The backend
 * `includeLocationPmParts` column still exists and defaults to false
 * server-side; this wizard simply does not surface it.
 *
 * Supports query-param prefill (set by CreateMaintenancePlanDialog):
 *   /pm/new?locationId=123        — prefill location + derive customer
 *   /pm/new?fromTemplateId=456    — prefill from a PM template (saved blueprint)
 *   /pm/new?duplicate=456         — copy an existing maintenance plan
 *
 * Creates plans via POST /api/recurring-templates.
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  CheckCircle2,
  Loader2,
  ClipboardList,
  Calendar,
  DollarSign,
  ClipboardCheck,
} from "lucide-react";
import type { Client, PmTemplate, RecurringJobTemplate } from "@shared/schema";

// ============================================================================
// Types & Constants
// ============================================================================

const STEPS = [
  { key: "basics", label: "Basics", icon: ClipboardList },
  { key: "schedule", label: "Schedule", icon: Calendar },
  { key: "pricing", label: "Pricing & Contract", icon: DollarSign },
  { key: "review", label: "Review", icon: ClipboardCheck },
] as const;

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

type FrequencyKey = "monthly" | "quarterly" | "biannual" | "annual" | "custom";

/** Rotate a 1..12 month forward by `offset` months, wrapping past Dec. */
function rotateMonth(start: number, offset: number): number {
  return ((start - 1 + offset) % 12) + 1;
}

/** Derive the months-of-year array for a frequency, anchored on the Start
 *  Date's month. `custom` returns `null` (caller keeps existing months).
 *  Examples (start = April):
 *    monthly   → [1,2,3,4,5,6,7,8,9,10,11,12]
 *    quarterly → [1,4,7,10]   (Apr, Jul, Oct, Jan, sorted ascending)
 *    biannual  → [4,10]
 *    annual    → [4]
 */
function frequencyDerivedMonths(startDate: string, freq: FrequencyKey): number[] | null {
  if (freq === "custom") return null;
  if (freq === "monthly") return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  if (!startDate) return null;
  const startMonth = new Date(startDate + "T00:00:00").getMonth() + 1;
  if (Number.isNaN(startMonth)) return null;
  if (freq === "annual") return [startMonth];
  if (freq === "biannual") return [0, 6].map((o) => rotateMonth(startMonth, o)).sort((a, b) => a - b);
  // quarterly
  return [0, 3, 6, 9].map((o) => rotateMonth(startMonth, o)).sort((a, b) => a - b);
}

/** Generation rule = "When should work orders be created?"
 *  2026-04-26 UX refinement: "days_before" was removed from both the UI and
 *  the backend — the Completion Window already covers before/after
 *  flexibility, so a separate creation mode confused users. Legacy templates
 *  with the deprecated mode (none in production — the migration was never
 *  applied) are normalized to "period_start" on prefill. */
type GenerationRule = "period_start" | "day_of_month";

/** Plan duration mode */
type DurationMode = "ongoing" | "1_year" | "custom" | "specific";

/** PM billing options surfaced in the wizard. Each id maps to the existing
 *  pm_billing_model enum value in `shared/schema.ts` (per_visit, monthly_fixed,
 *  annual_prepaid, do_not_bill). No new enum values are introduced — the
 *  redesigned UI just relabels existing ones in plainer language. */
type BillingOption =
  | "after_visit"        // → per_visit       — bill each completed job
  | "monthly_contract"   // → monthly_fixed   — fixed monthly amount
  | "annual_contract"    // → annual_prepaid  — one yearly amount
  | "no_contract";       // → do_not_bill    — track without preset billing

interface CustomerCompanyLite {
  id: string;
  name: string;
}

interface WizardState {
  // Step 1 — Basics
  customerCompanyId: string;
  customerName: string;
  locationId: string;
  locationName: string;
  title: string;
  description: string;
  // Step 2 — Schedule
  frequency: FrequencyKey;
  months: number[];
  generationRule: GenerationRule;
  generationDayOfMonth: number;
  serviceWindowDaysBefore: number;
  serviceWindowDaysAfter: number;
  // Service Plans (2026-05-07): when true the system creates an UNSCHEDULED
  // job (no visit, no tech, no calendar reservation) on the configured
  // generation date. When false the plan only creates pending instances
  // and a dispatcher manually generates jobs from the Work Due queue.
  autoGenerateJobs: boolean;
  // Step 3 — Pricing & Contract
  billingOption: BillingOption;
  contractAmount: string;
  startDate: string;
  durationMode: DurationMode;
  customDurationValue: number;
  customDurationUnit: "months" | "years";
  endDate: string;
  // Misc — preserved for prefill round-trip
  fromTemplateId: string | null;
}

function defaultStartDate(): string {
  return new Date().toISOString().split("T")[0];
}

/** 2026-04-26 UX: Plan Name defaults to a clean static value the user can
 *  edit. We no longer auto-insert customer/location/frequency/IDs into the
 *  title — that was noisy and surprised users on first edit. */
const DEFAULT_PLAN_NAME = "Service Plan";

function initialState(): WizardState {
  const startDate = defaultStartDate();
  const months = frequencyDerivedMonths(startDate, "quarterly") ?? [1, 4, 7, 10];
  return {
    customerCompanyId: "",
    customerName: "",
    locationId: "",
    locationName: "",
    title: DEFAULT_PLAN_NAME,
    description: "",
    frequency: "quarterly",
    months,
    generationRule: "period_start",
    generationDayOfMonth: 1,
    serviceWindowDaysBefore: 7,
    serviceWindowDaysAfter: 14,
    autoGenerateJobs: false,
    billingOption: "after_visit",
    contractAmount: "",
    startDate,
    durationMode: "ongoing",
    customDurationValue: 12,
    customDurationUnit: "months",
    endDate: "",
    fromTemplateId: null,
  };
}

/** Detect frequency intent from a months array, ignoring start-month
 *  alignment. Used by PM-template prefill where the template's stored
 *  months represent a cadence (e.g. [1,4,7,10] = quarterly) that we then
 *  re-anchor on the new plan's start date. */
function detectFrequencyIntent(months: number[]): FrequencyKey {
  if (months.length === 0) return "custom";
  if (months.length === 12) return "monthly";
  if (months.length === 1) return "annual";
  const sorted = [...months].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  // Wrap-around gap (Dec → next-year first month)
  gaps.push(12 - sorted[sorted.length - 1] + sorted[0]);
  const allSame = gaps.every((g) => g === gaps[0]);
  if (!allSame) return "custom";
  if (sorted.length === 4 && gaps[0] === 3) return "quarterly";
  if (sorted.length === 2 && gaps[0] === 6) return "biannual";
  return "custom";
}

/** Map a PM template's billing_mode (per_visit | monthly | annually | none)
 *  onto the wizard's BillingOption set. */
function pmTemplateBillingToWizardOption(mode: string | null | undefined): BillingOption {
  switch (mode) {
    case "per_visit": return "after_visit";
    case "monthly": return "monthly_contract";
    case "annually": return "annual_contract";
    case "none": return "no_contract";
    default: return "after_visit";
  }
}

/** Derive frequency key from a months array. Used when prefilling from an
 *  existing template — keeps the radio selection in sync. Months are matched
 *  against the rotated pattern derived from the template's start date so a
 *  June-anchored quarterly plan still reads as "Quarterly", not "Custom". */
function frequencyFromMonths(months: number[], startDate: string): FrequencyKey {
  if (months.length === 0) return "custom";
  const sorted = [...months].sort((a, b) => a - b);
  const sortedKey = sorted.join(",");
  if (sortedKey === "1,2,3,4,5,6,7,8,9,10,11,12") return "monthly";
  for (const freq of ["quarterly", "biannual", "annual"] as const) {
    const derived = frequencyDerivedMonths(startDate, freq);
    if (derived && derived.join(",") === sortedKey) return freq;
  }
  return "custom";
}

function frequencyLabel(key: FrequencyKey): string {
  return ({
    monthly: "Monthly",
    quarterly: "Quarterly",
    biannual: "Bi-Annual",
    annual: "Annual",
    custom: "Custom",
  } as const)[key];
}

function monthsLabel(months: number[]): string {
  if (!months.length) return "—";
  return [...months].sort((a, b) => a - b).map((m) => MONTH_LABELS[m - 1]).join(", ");
}

/** Compute end-date from duration mode (used for payload + summary display). */
function computeEndDate(state: WizardState): string {
  const { startDate, durationMode, customDurationValue, customDurationUnit, endDate } = state;
  if (durationMode === "ongoing") return "";
  if (durationMode === "specific") return endDate;
  if (!startDate) return "";
  const d = new Date(startDate + "T00:00:00");
  if (durationMode === "1_year") {
    d.setFullYear(d.getFullYear() + 1);
  } else if (customDurationUnit === "years") {
    d.setFullYear(d.getFullYear() + customDurationValue);
  } else {
    d.setMonth(d.getMonth() + customDurationValue);
  }
  return d.toISOString().split("T")[0];
}

function durationLabel(state: WizardState): string {
  switch (state.durationMode) {
    case "ongoing": return "Ongoing";
    case "1_year": return "1 year";
    case "custom": return `${state.customDurationValue} ${state.customDurationUnit}`;
    case "specific": return state.endDate ? `Until ${state.endDate}` : "Specific end date";
  }
}

function billingLabel(option: BillingOption): string {
  return ({
    after_visit: "After each visit",
    monthly_contract: "Monthly contract",
    annual_contract: "Annual contract",
    no_contract: "No contract amount",
  } as const)[option];
}

/** Short label used in the compact Plan Preview. */
function billingShortLabel(option: BillingOption): string {
  return ({
    after_visit: "Per visit",
    monthly_contract: "Monthly",
    annual_contract: "Annual",
    no_contract: "Not set",
  } as const)[option];
}

function billingOptionFromTemplate(tpl: RecurringJobTemplate): BillingOption {
  const m = (tpl as { pmBillingModel?: string | null }).pmBillingModel;
  if (m === "do_not_bill") return "no_contract";
  if (m === "monthly_fixed") return "monthly_contract";
  if (m === "annual_prepaid") return "annual_contract";
  // per_visit, quote_after_visit (legacy from prior session), or null all
  // surface as "After each visit" — the closest non-contract semantic.
  return "after_visit";
}

/** Map UI billing option → backend pm_billing_model column. All four targets
 *  are existing values in pmBillingModelEnum — no enum changes required. */
function billingOptionToBackend(option: BillingOption): string {
  switch (option) {
    case "after_visit": return "per_visit";
    case "monthly_contract": return "monthly_fixed";
    case "annual_contract": return "annual_prepaid";
    case "no_contract": return "do_not_bill";
  }
}

/** A contract amount field is shown for every option except No preset charge.
 *  2026-04-26 UX refinement: Per visit now also shows an amount labeled
 *  "Visit Rate" (formerly hidden). */
function contractAmountApplies(option: BillingOption): boolean {
  return option !== "no_contract";
}

/** Dynamic label for the amount input based on Charge Type.
 *  Returns null when no amount field should be shown.
 *  2026-04-26: amount is OPTIONAL — pricing is for reporting only and the
 *  system does not auto-invoice. The form appends "(optional)" to the label
 *  for clarity; the Review summary card uses the bare label. */
function amountLabelFor(option: BillingOption): string | null {
  switch (option) {
    case "after_visit": return "Visit Rate";
    case "monthly_contract": return "Monthly Contract Amount";
    case "annual_contract": return "Annual Contract Amount";
    case "no_contract": return null;
  }
}

function generationRuleLabel(state: WizardState): string {
  if (state.generationRule === "period_start") return "On the 1st of each service month";
  return `Day ${state.generationDayOfMonth} of each service month`;
}

// ============================================================================
// Stepper (shared header)
// ============================================================================

function Stepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {STEPS.map((step, idx) => {
        const isActive = idx === currentStep;
        const isCompleted = idx < currentStep;
        const Icon = isCompleted ? CheckCircle2 : step.icon;
        return (
          <div key={step.key} className="flex items-center gap-1.5">
            {idx > 0 && (
              <div
                className={`h-px w-4 ${isCompleted || isActive ? "bg-emerald-500" : "bg-border"}`}
              />
            )}
            <div
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                isActive
                  ? "bg-emerald-500 text-white border-emerald-500"
                  : isCompleted
                    ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900"
                    : "bg-muted text-muted-foreground border-transparent"
              }`}
              data-testid={`pm-wizard-step-${step.key}${isActive ? "-active" : ""}`}
            >
              <Icon className="h-3 w-3" />
              <span>{step.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Step 1 — Basics
// ============================================================================

function StepBasics({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const [companyOpen, setCompanyOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);

  const { data: companiesData } = useQuery<CustomerCompanyLite[]>({
    queryKey: ["/api/customer-companies"],
  });
  const companies = companiesData ?? [];

  const { data: locationsData } = useQuery<Client[]>({
    queryKey: ["/api/clients", "pm-wizard-locations"],
    queryFn: () => apiRequest("/api/clients?limit=500"),
    select: (res: any) => (res?.data || res || []) as Client[],
  });
  const allLocations = (locationsData ?? []).filter((c: Client) => !c.inactive);
  const filteredLocations = state.customerCompanyId
    ? allLocations.filter((loc) => loc.parentCompanyId === state.customerCompanyId)
    : [];

  // 2026-04-26 UX: Plan Name is no longer auto-filled with customer/location
  // text. The default value is the clean static "Maintenance Plan" set in
  // initialState; the user can edit it freely before saving.

  const handleSelectCompany = (companyId: string) => {
    const company = companies.find((c) => c.id === companyId);
    const locationStillValid =
      state.locationId &&
      allLocations.some((l) => l.id === state.locationId && l.parentCompanyId === companyId);
    onChange({
      customerCompanyId: companyId,
      customerName: company?.name ?? "",
      locationId: locationStillValid ? state.locationId : "",
      locationName: locationStillValid ? state.locationName : "",
    });
    setCompanyOpen(false);
  };

  const handleSelectLocation = (locationId: string) => {
    if (!state.customerCompanyId) return;
    const loc = filteredLocations.find((c) => c.id === locationId);
    if (loc) {
      const newLocationName = [loc.companyName, loc.location].filter(Boolean).join(" — ");
      onChange({
        locationId: loc.id,
        locationName: newLocationName,
      });
    }
    setLocationOpen(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-modal-title">Let's start with the basics</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Who is this service plan for?
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Customer</Label>
        <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              className="w-full justify-between font-normal h-9"
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
                      value={getClientDisplayName(company)}
                      onSelect={() => handleSelectCompany(company.id)}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${
                          state.customerCompanyId === company.id ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {getClientDisplayName(company)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Service Location</Label>
        <Popover
          open={locationOpen}
          onOpenChange={(open) => {
            if (state.customerCompanyId) setLocationOpen(open);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              className="w-full justify-between font-normal h-9"
              disabled={!state.customerCompanyId}
              data-testid="pm-wizard-location-select"
            >
              {state.locationName ||
                (state.customerCompanyId ? "Select a location..." : "Select a customer first")}
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
                      value={[loc.companyName, loc.location, loc.address, loc.city]
                        .filter(Boolean)
                        .join(" ")}
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
                          <div className="text-xs text-muted-foreground truncate">
                            {loc.address}, {loc.city}
                          </div>
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

      <div className="space-y-1.5">
        <Label className="text-sm">Plan Name</Label>
        <Input
          className="h-9"
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Quarterly HVAC Maintenance — Warehouse"
          data-testid="pm-wizard-title"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Internal Notes (optional)</Label>
        <Textarea
          value={state.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Any special instructions for this plan..."
          rows={2}
          data-testid="pm-wizard-description"
        />
      </div>

      <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        We'll show a full summary before you save.
      </div>
    </div>
  );
}

// ============================================================================
// Step 2 — Schedule
// ============================================================================

function FrequencyCard({
  selected,
  label,
  helper,
  onClick,
  testId,
}: {
  selected: boolean;
  label: string;
  helper?: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left px-3 py-2 rounded-md border-2 transition-colors ${
        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
      }`}
      data-testid={testId}
    >
      <div className="font-medium text-sm leading-tight">{label}</div>
      {helper && <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{helper}</div>}
    </button>
  );
}

function StepSchedule({
  state,
  onChange,
  errors,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  errors: Record<string, string>;
}) {
  const monthList = state.months.length
    ? [...state.months].sort((a, b) => a - b).map((m) => MONTH_LABELS[m - 1]).join(", ")
    : "—";

  /** Helper text for the four non-custom frequency cards, derived from the
   *  current Start Date. Falls back to a sensible default when start date
   *  is empty. */
  function helperFor(freq: Exclude<FrequencyKey, "custom" | "monthly">): string {
    const months = frequencyDerivedMonths(state.startDate, freq);
    if (!months || months.length === 0) return "—";
    return months.map((m) => MONTH_LABELS[m - 1]).join(", ");
  }

  function setFrequency(freq: FrequencyKey) {
    if (freq === "custom") {
      onChange({ frequency: "custom" }); // keep current months
      return;
    }
    const months = frequencyDerivedMonths(state.startDate, freq);
    onChange({ frequency: freq, months: months ?? [] });
  }

  /** When Start Date changes and the user is not on Custom, recompute months
   *  so the schedule stays anchored on the new start month. */
  function setStartDate(startDate: string) {
    if (state.frequency === "custom") {
      onChange({ startDate });
      return;
    }
    const months = frequencyDerivedMonths(startDate, state.frequency);
    onChange({ startDate, months: months ?? state.months });
  }

  function toggleCustomMonth(m: number) {
    const next = state.months.includes(m)
      ? state.months.filter((v) => v !== m)
      : [...state.months, m].sort((a, b) => a - b);
    onChange({ frequency: "custom", months: next });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-modal-title">Set the schedule</h2>
        <p className="text-xs text-muted-foreground mt-0.5">How often should this plan run?</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">When does this plan start?</Label>
        <CanonicalDatePicker
          value={state.startDate}
          onChange={(next) => setStartDate(next ?? "")}
          className="h-9 w-48 text-sm"
          data-testid="pm-wizard-start-date"
        />
        <p className="text-xs text-muted-foreground leading-snug">
          This sets the first service month. Frequency options will be based on this month.
        </p>
        {errors.startDate && (
          <p className="text-xs text-destructive">{errors.startDate}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Frequency</Label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <FrequencyCard
            selected={state.frequency === "monthly"}
            label="Monthly"
            helper="Every month"
            onClick={() => setFrequency("monthly")}
            testId="pm-wizard-freq-monthly"
          />
          <FrequencyCard
            selected={state.frequency === "quarterly"}
            label="Quarterly"
            helper={helperFor("quarterly")}
            onClick={() => setFrequency("quarterly")}
            testId="pm-wizard-freq-quarterly"
          />
          <FrequencyCard
            selected={state.frequency === "biannual"}
            label="Bi-Annual"
            helper={helperFor("biannual")}
            onClick={() => setFrequency("biannual")}
            testId="pm-wizard-freq-biannual"
          />
          <FrequencyCard
            selected={state.frequency === "annual"}
            label="Annual"
            helper={helperFor("annual")}
            onClick={() => setFrequency("annual")}
            testId="pm-wizard-freq-annual"
          />
          <FrequencyCard
            selected={state.frequency === "custom"}
            label="Custom"
            helper="Pick months"
            onClick={() => setFrequency("custom")}
            testId="pm-wizard-freq-custom"
          />
        </div>
        {errors.months && (
          <p className="text-xs text-destructive">{errors.months}</p>
        )}
      </div>

      {state.frequency === "custom" && (
        <div className="space-y-2">
          <Label className="text-sm">Service months</Label>
          <div className="flex flex-wrap gap-1.5">
            {MONTH_LABELS.map((label, idx) => {
              const m = idx + 1;
              const selected = state.months.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleCustomMonth(m)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                  }`}
                  data-testid={`pm-wizard-month-${m}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1.5 pt-1">
        <Label className="text-sm font-medium">When should work orders be created?</Label>
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => onChange({ generationRule: "period_start" })}
            className={`text-left px-3 py-2 rounded-md border-2 transition-colors ${
              state.generationRule === "period_start"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
            data-testid="pm-wizard-gen-period-start"
          >
            <div className="font-medium text-sm">On the 1st of each service month</div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
              Work order appears on the 1st of {monthList}.
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChange({ generationRule: "day_of_month" })}
            className={`text-left px-3 py-2 rounded-md border-2 transition-colors ${
              state.generationRule === "day_of_month"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
            data-testid="pm-wizard-gen-day-of-month"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-medium text-sm">Specific day of each service month</div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  Choose a day of month to create the work order.
                </div>
              </div>
              {state.generationRule === "day_of_month" && (
                <div
                  className="flex items-center gap-1.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-xs text-muted-foreground">Day</span>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    className="w-16 h-7 text-sm"
                    value={state.generationDayOfMonth}
                    onChange={(e) =>
                      onChange({
                        generationDayOfMonth: Math.min(
                          31,
                          Math.max(1, parseInt(e.target.value, 10) || 1)
                        ),
                      })
                    }
                    data-testid="pm-wizard-day-of-month-input"
                  />
                </div>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Service Plans (2026-05-07): explicit auto-generate-work toggle.
          When ON, the system creates an UNSCHEDULED job (no visit, no
          tech assignment, no calendar reservation) on the configured
          generation date. When OFF, the plan only surfaces pending work
          on the Service Plans → Work Due queue and a dispatcher
          generates the job manually. Scheduling/dispatch are NEVER
          automated by this toggle. */}
      <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <Label
            htmlFor="pm-wizard-auto-generate-jobs"
            className="text-sm font-medium cursor-pointer"
          >
            Automatically generate work
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            Automatically creates an unscheduled job when service becomes due. The job lands on the Work Due queue — a dispatcher still assigns the technician and schedules it.
          </p>
        </div>
        <Switch
          id="pm-wizard-auto-generate-jobs"
          checked={state.autoGenerateJobs}
          onCheckedChange={(v) => onChange({ autoGenerateJobs: Boolean(v) })}
          data-testid="pm-wizard-auto-generate-jobs"
        />
      </div>

      <div className="space-y-2 pt-1">
        <div>
          <h3 className="text-sm font-semibold">Completion Window</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            This is the date range where the service visit should be completed.
            Example: 7 days before and 14 days after means the job can be scheduled
            anytime in that window. For an exact service date, set both numbers to 0.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Days before</Label>
            <Input
              type="number"
              min={0}
              max={90}
              className="w-20 h-8 text-sm"
              value={state.serviceWindowDaysBefore}
              onChange={(e) =>
                onChange({ serviceWindowDaysBefore: Math.max(0, parseInt(e.target.value, 10) || 0) })
              }
              data-testid="pm-wizard-window-before"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Days after</Label>
            <Input
              type="number"
              min={0}
              max={90}
              className="w-20 h-8 text-sm"
              value={state.serviceWindowDaysAfter}
              onChange={(e) =>
                onChange({ serviceWindowDaysAfter: Math.max(0, parseInt(e.target.value, 10) || 0) })
              }
              data-testid="pm-wizard-window-after"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step 3 — Pricing & Contract
// ============================================================================

function StepPricing({
  state,
  onChange,
  errors,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  errors: Record<string, string>;
}) {
  // 2026-04-26 UX refinement: Charge Type is now a compact dropdown rather
  // than a 4-card grid. Each option still maps to an existing
  // pmBillingModelEnum value via billingOptionToBackend — no new enums.
  const chargeTypeOptions: Array<{ id: BillingOption; label: string }> = [
    { id: "after_visit", label: "Per visit" },
    { id: "monthly_contract", label: "Monthly contract" },
    { id: "annual_contract", label: "Annual contract" },
    { id: "no_contract", label: "No preset charge" },
  ];

  const amountLabel = amountLabelFor(state.billingOption);
  const showContractAmount = amountLabel !== null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-modal-title">Pricing and contract</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          How will this plan be billed and how long does it run?
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-sm">Charge Type</Label>
          <Select
            value={state.billingOption}
            onValueChange={(v) => onChange({ billingOption: v as BillingOption })}
          >
            <SelectTrigger className="h-9" data-testid="pm-wizard-charge-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chargeTypeOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id} data-testid={`pm-wizard-charge-${opt.id}`}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground leading-snug">
            Used for reporting only. Invoices are not created automatically from this setting.
          </p>
        </div>

        {showContractAmount && amountLabel && (
          <div className="space-y-1.5">
            <Label className="text-sm">{amountLabel} (optional)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                $
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                className="pl-7 h-9"
                value={state.contractAmount}
                onChange={(e) => onChange({ contractAmount: e.target.value })}
                placeholder="0.00"
                data-testid="pm-wizard-contract-amount"
              />
            </div>
            {errors.contractAmount && (
              <p className="text-xs text-destructive">{errors.contractAmount}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Plan Duration</Label>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {(["ongoing", "1_year", "custom", "specific"] as const).map((m) => {
            const labels: Record<DurationMode, string> = {
              ongoing: "Ongoing",
              "1_year": "1 year",
              custom: "Custom",
              specific: "Specific date",
            };
            return (
              <label
                key={m}
                className={`flex items-center gap-2 px-3 py-2 rounded-md border-2 text-sm cursor-pointer transition-colors ${
                  state.durationMode === m
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
                data-testid={`pm-wizard-duration-${m}`}
              >
                <input
                  type="radio"
                  name="planDuration"
                  checked={state.durationMode === m}
                  onChange={() => onChange({ durationMode: m })}
                  className="accent-primary"
                />
                <span className="font-medium">{labels[m]}</span>
              </label>
            );
          })}
        </div>
        {state.durationMode === "custom" && (
          <div className="flex items-center gap-2 pt-1">
            <Input
              type="number"
              min={1}
              max={120}
              className="w-20 h-8 text-sm"
              value={state.customDurationValue}
              onChange={(e) =>
                onChange({ customDurationValue: Math.max(1, parseInt(e.target.value, 10) || 1) })
              }
              data-testid="pm-wizard-duration-value"
            />
            <select
              value={state.customDurationUnit}
              onChange={(e) =>
                onChange({ customDurationUnit: e.target.value as "months" | "years" })
              }
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="months">months</option>
              <option value="years">years</option>
            </select>
          </div>
        )}
        {state.durationMode === "specific" && (
          <div className="pt-1">
            <CanonicalDatePicker
              value={state.endDate}
              onChange={(next) => onChange({ endDate: next ?? "" })}
              className="w-48 h-8 text-sm"
              data-testid="pm-wizard-end-date"
            />
            {errors.endDate && (
              <p className="text-xs text-destructive mt-1">{errors.endDate}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Step 4 — Review
// ============================================================================

function ReviewSection({
  title,
  rows,
  testId,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-1 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3 leading-tight">
            <span className="text-muted-foreground text-xs">{r.label}</span>
            <span className="font-medium text-right text-xs max-w-[60%] truncate">
              {r.value || "—"}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StepReview({ state }: { state: WizardState }) {
  const locationOnly = state.locationName?.includes(" — ")
    ? state.locationName.split(" — ").slice(1).join(" — ")
    : state.locationName;

  // Pricing card: drop the amount row entirely for No preset charge so the
  // card stays compact; for the other three options show the row using the
  // dynamic label ("Visit Rate" / "Monthly Contract Amount" / "Annual
  // Contract Amount").
  const amountLabel = amountLabelFor(state.billingOption);
  const pricingRows: Array<{ label: string; value: string }> = [
    { label: "Charge Type", value: billingLabel(state.billingOption) },
  ];
  if (amountLabel) {
    pricingRows.push({
      label: amountLabel,
      value: state.contractAmount ? `$${state.contractAmount}` : "—",
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-modal-title">Review your service plan</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Please review the details below. You can go back to make changes.
        </p>
      </div>

      {/* 2x2 grid of compact summary cards — full width since the right
          sidebar Plan Preview is hidden on the Review step. */}
      <div className="grid sm:grid-cols-2 gap-3">
        <ReviewSection
          testId="pm-wizard-review-customer"
          title="Customer & Location"
          rows={[
            { label: "Customer", value: state.customerName },
            { label: "Location", value: locationOnly },
            { label: "Plan Name", value: state.title },
            { label: "Notes", value: state.description },
          ]}
        />

        <ReviewSection
          testId="pm-wizard-review-schedule"
          title="Schedule"
          rows={[
            { label: "Frequency", value: frequencyLabel(state.frequency) },
            { label: "Months", value: monthsLabel(state.months) },
            { label: "Work Orders", value: generationRuleLabel(state) },
            {
              label: "Completion Window",
              value: `${state.serviceWindowDaysBefore}d before — ${state.serviceWindowDaysAfter}d after`,
            },
          ]}
        />

        <ReviewSection
          testId="pm-wizard-review-pricing"
          title="Pricing"
          rows={pricingRows}
        />

        <ReviewSection
          testId="pm-wizard-review-duration"
          title="Duration"
          rows={[
            { label: "Start Date", value: state.startDate },
            { label: "Duration", value: durationLabel(state) },
          ]}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Right sidebar — Plan Preview / Final action
// ============================================================================

function PlanPreviewCard({ state }: { state: WizardState }) {
  const locationOnly = state.locationName?.includes(" — ")
    ? state.locationName.split(" — ").slice(1).join(" — ")
    : state.locationName;
  // Charge cell formats per spec:
  //   per_visit          → "Per visit — $X"      (or "Per visit"      if no amount)
  //   monthly_contract   → "Monthly — $X"        (or "Monthly contract"   if no amount)
  //   annual_contract    → "Annual — $X"         (or "Annual contract"    if no amount)
  //   no_contract        → "No preset charge"
  const charge = (() => {
    if (state.billingOption === "no_contract") return "No preset charge";
    const amt = state.contractAmount ? `$${state.contractAmount}` : "";
    const short = billingShortLabel(state.billingOption); // "Per visit" / "Monthly" / "Annual"
    return amt ? `${short} — ${amt}` : billingLabel(state.billingOption);
  })();

  const rows: Array<{ label: string; value: string }> = [
    { label: "Customer", value: state.customerName || "—" },
    { label: "Location", value: locationOnly || "—" },
    { label: "Start", value: state.startDate || "—" },
    { label: "Frequency", value: state.months.length ? frequencyLabel(state.frequency) : "—" },
    { label: "Months", value: monthsLabel(state.months) },
    {
      label: "Work Orders",
      value:
        state.generationRule === "period_start"
          ? "1st of service month"
          : `Day ${state.generationDayOfMonth}`,
    },
    {
      label: "Completion Window",
      value: `${state.serviceWindowDaysBefore}d / ${state.serviceWindowDaysAfter}d`,
    },
    { label: "Charge", value: charge },
    { label: "Duration", value: durationLabel(state) },
  ];

  return (
    <Card data-testid="pm-wizard-preview-card">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold">Plan Preview</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-2 leading-tight">
            <span className="text-muted-foreground text-xs">{r.label}</span>
            <span className="font-medium text-right text-xs max-w-[60%] truncate">{r.value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Neutral confirmation block shown only on the Review step.
 *  2026-04-26 UX refinement: copy now reflects that creation kicks off
 *  scheduled tracking (not a one-shot work-order generation), so users
 *  understand what happens next. */
function FinalActionBar({
  onCreate,
  isPending,
}: {
  onCreate: () => void;
  isPending: boolean;
}) {
  return (
    <Card data-testid="pm-wizard-final-action-card">
      <CardContent className="px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">Ready to create this service plan?</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Review the details above. When you create the plan, upcoming service work will appear on the Service Plans page when due.
          </div>
        </div>
        <Button
          size="sm"
          className="h-9"
          onClick={onCreate}
          disabled={isPending}
          data-testid="pm-wizard-create"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...
            </>
          ) : (
            "Create Plan"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Wizard Page
// ============================================================================

/** localStorage key for hiding the post-create explanation modal. */
const HIDE_EXPLANATION_KEY = "syntraro:pm-wizard:hide-explanation";

export default function PMWizardPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [showErrors, setShowErrors] = useState(false);
  // Post-create explanation modal — explains that the plan tracks upcoming
  // maintenance and the user creates work orders when they're due.
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [hideExplanationAgain, setHideExplanationAgain] = useState(false);

  // Parse query params for prefill (set by CreateMaintenancePlanDialog).
  // 2026-04-26: split semantics —
  //   ?fromTemplateId  →  PM template (reusable blueprint, /api/pm/templates)
  //   ?duplicate       →  existing maintenance plan (/api/recurring-templates)
  // Previously both params shared the same handler and ?fromTemplateId was
  // effectively unused; the chooser modal now distinguishes them.
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const prefillLocationId = params.get("locationId");
  const prefillPmTemplateId = params.get("fromTemplateId");
  const prefillDuplicateId = params.get("duplicate");

  // Fetch existing maintenance plans (for ?duplicate=)
  const { data: templates = [] } = useQuery<RecurringJobTemplate[]>({
    queryKey: ["/api/recurring-templates"],
  });

  // Fetch PM templates (for ?fromTemplateId=). Skipped unless the param is set.
  const { data: pmTemplates = [] } = useQuery<PmTemplate[]>({
    queryKey: ["/api/pm/templates"],
    enabled: Boolean(prefillPmTemplateId),
  });

  // Locations + customer-companies — used for prefill name resolution
  const { data: locationsData } = useQuery<Client[]>({
    queryKey: ["/api/clients", "pm-wizard-locations"],
    queryFn: () => apiRequest("/api/clients?limit=500"),
    select: (res: any) => (res?.data || res || []) as Client[],
  });
  const allLocations = locationsData ?? [];

  const { data: companiesData } = useQuery<CustomerCompanyLite[]>({
    queryKey: ["/api/customer-companies"],
  });
  const companies = companiesData ?? [];

  // Prefill from ?locationId — sets customer + location only.
  // 2026-04-26 UX: Plan Name is no longer derived from location; it stays
  // at the clean default ("Maintenance Plan") so the user starts from a
  // predictable value.
  useEffect(() => {
    if (prefillLocationId && allLocations.length > 0) {
      const loc = allLocations.find((c) => c.id === prefillLocationId);
      if (loc) {
        const company = companies.find((c) => c.id === loc.parentCompanyId);
        const customerName = company?.name ?? loc.companyName ?? "";
        const locationName = [loc.companyName, loc.location].filter(Boolean).join(" — ");
        setState((prev) => ({
          ...prev,
          locationId: loc.id,
          locationName,
          customerCompanyId: loc.parentCompanyId ?? "",
          customerName,
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillLocationId, allLocations.length, companies.length]);

  // Prefill from ?duplicate= — copies an existing maintenance plan.
  useEffect(() => {
    if (prefillDuplicateId && templates.length > 0 && allLocations.length > 0) {
      const tpl = templates.find((t) => t.id === prefillDuplicateId);
      if (tpl) applyDuplicateToState(tpl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillDuplicateId, templates.length, allLocations.length, companies.length]);

  // Prefill from ?fromTemplateId= — applies a PM template's safe defaults.
  // Does NOT set client/location (PM templates are blueprints, reusable
  // across customers).
  useEffect(() => {
    if (prefillPmTemplateId && pmTemplates.length > 0) {
      const tpl = pmTemplates.find((t) => t.id === prefillPmTemplateId);
      if (tpl) applyPmTemplateToState(tpl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillPmTemplateId, pmTemplates.length]);

  /** Copy a full maintenance plan (?duplicate=). All scheduling, billing,
   *  notes, and (importantly) client/location are copied — the user is
   *  expected to confirm or change client/location before saving. */
  function applyDuplicateToState(tpl: RecurringJobTemplate) {
    const loc = allLocations.find((c) => c.id === tpl.locationId);
    const company = loc?.parentCompanyId
      ? companies.find((c) => c.id === loc.parentCompanyId)
      : undefined;
    const months = tpl.monthsOfYear ?? [];
    const newStartDate = defaultStartDate();
    const freq = frequencyFromMonths(months, newStartDate);
    // Defensive: legacy "days_before" + "phase" values normalize to "period_start"
    // since the wizard only surfaces period_start / day_of_month now.
    const rule: GenerationRule =
      tpl.generationMode === "day_of_month" ? "day_of_month" : "period_start";
    setState((prev) => ({
      ...prev,
      customerCompanyId: prev.customerCompanyId || (loc?.parentCompanyId ?? ""),
      customerName: prev.customerName || (company?.name ?? loc?.companyName ?? ""),
      locationId: prev.locationId || (tpl.locationId ?? ""),
      locationName:
        prev.locationName ||
        (loc ? [loc.companyName, loc.location].filter(Boolean).join(" — ") : ""),
      fromTemplateId: tpl.id,
      title: `${tpl.title} (Copy)`,
      description: tpl.description ?? "",
      frequency: freq,
      months,
      generationRule: rule,
      generationDayOfMonth: tpl.generationDayOfMonth ?? 1,
      serviceWindowDaysBefore: tpl.serviceWindowDaysBefore ?? 7,
      serviceWindowDaysAfter: tpl.serviceWindowDaysAfter ?? 14,
      autoGenerateJobs: (tpl as { autoGenerateJobs?: boolean | null }).autoGenerateJobs ?? false,
      billingOption: billingOptionFromTemplate(tpl),
      contractAmount: (tpl as { pmContractAmount?: string | null }).pmContractAmount ?? "",
      startDate: newStartDate,
      durationMode: tpl.endDate ? "specific" : "ongoing",
      endDate: tpl.endDate ?? "",
    }));
  }

  /** Apply a PM template (?fromTemplateId=) to the wizard state.
   *
   *  Per spec: prefill ONLY name/summary/description and the saved scheduling
   *  + billing defaults. Do NOT touch client/location — PM templates are
   *  reusable blueprints, not per-customer plans.
   *
   *  PM templates store a generic months array (e.g. [1,4,7,10] for quarterly).
   *  We detect the frequency intent from that array and let the wizard
   *  recompute months from the user's start date — so a Quarterly template
   *  used in June produces [3, 6, 9, 12], not the literal stored months. */
  function applyPmTemplateToState(tpl: PmTemplate) {
    const newStartDate = state.startDate || defaultStartDate();
    const tplMonths = (tpl.defaultMonthsOfYear as number[] | null) ?? [];
    const detectedFrequency = detectFrequencyIntent(tplMonths);
    // Recompute months from the user's start date when frequency is one of
    // the well-known cadences. For "custom" intent fall back to the literal
    // months the template stored.
    const months =
      detectedFrequency === "custom"
        ? tplMonths
        : (frequencyDerivedMonths(newStartDate, detectedFrequency) ?? tplMonths);

    const rule: GenerationRule =
      tpl.defaultGenerationMode === "day_of_month" ? "day_of_month" : "period_start";

    setState((prev) => ({
      ...prev,
      // Plan name defaults to the template's PM summary (the customer-facing
      // title) or the template name as a fallback. Editable.
      title: prev.title || tpl.summary || tpl.name,
      description: prev.description || (tpl.description ?? ""),
      frequency: detectedFrequency,
      months,
      generationRule: rule,
      generationDayOfMonth: (tpl.defaultGenerationDayOfMonth as number | null) ?? 1,
      serviceWindowDaysBefore: (tpl.defaultServiceWindowDaysBefore as number | null) ?? prev.serviceWindowDaysBefore,
      serviceWindowDaysAfter: (tpl.defaultServiceWindowDaysAfter as number | null) ?? prev.serviceWindowDaysAfter,
      billingOption: pmTemplateBillingToWizardOption(tpl.billingMode as string | null),
      contractAmount:
        (tpl.defaultPrice as string | null) && parseFloat(tpl.defaultPrice as string) > 0
          ? String(tpl.defaultPrice)
          : prev.contractAmount,
      startDate: newStartDate,
      // Templates do not own a duration — keep whatever the wizard already had.
    }));
  }

  function onChange(patch: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  // ---------------- Validation ---------------------------------------------
  // 2026-04-26 UX pass:
  //   - Start Date moved to Schedule (step 1) — required there.
  //   - Contract amount is OPTIONAL (no required check). Only flagged if
  //     the user types something non-numeric or negative.
  function validateStep(s: number): Record<string, string> {
    const errs: Record<string, string> = {};
    if (s === 0) {
      if (!state.customerCompanyId) errs.customer = "Customer is required.";
      if (!state.locationId) errs.location = "Service location is required.";
    }
    if (s === 1) {
      if (!state.startDate) errs.startDate = "Start date is required.";
      if (state.months.length === 0) errs.months = "Select a frequency or at least one month.";
      if (
        state.generationRule === "day_of_month" &&
        (state.generationDayOfMonth < 1 || state.generationDayOfMonth > 31)
      ) {
        errs.generationDayOfMonth = "Day of month must be 1–31.";
      }
    }
    if (s === 2) {
      // Contract amount is optional — only flag if the user typed something
      // that isn't a non-negative number. Blank, "0", and "0.00" all pass.
      if (
        contractAmountApplies(state.billingOption) &&
        state.contractAmount.trim() !== ""
      ) {
        const v = parseFloat(state.contractAmount);
        if (Number.isNaN(v) || v < 0) {
          errs.contractAmount = "Enter a non-negative number, or leave blank.";
        }
      }
      if (state.durationMode === "specific" && !state.endDate) {
        errs.endDate = "Select an end date.";
      }
    }
    return errs;
  }

  const stepErrors = validateStep(step);
  const canProceed = Object.keys(stepErrors).length === 0;

  function handleNext() {
    if (!canProceed) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function handleBack() {
    setShowErrors(false);
    setStep((s) => Math.max(0, s - 1));
  }

  // ---------------- Submission ---------------------------------------------
  const createMutation = useMutation({
    mutationFn: async () => {
      const effectiveEndDate = computeEndDate(state);
      const payload = {
        title: state.title.trim() || DEFAULT_PLAN_NAME,
        description: state.description.trim() || null,
        notes: null,
        locationId: state.locationId || null,
        clientId: state.customerCompanyId || null,
        jobType: "maintenance" as const,
        recurrenceKind: "monthly" as const,
        interval: 1,
        startDate: state.startDate || new Date().toISOString().split("T")[0],
        endDate: effectiveEndDate || null,
        monthsOfYear: state.months,
        generationMode: state.generationRule,
        generationDayOfMonth:
          state.generationRule === "day_of_month" ? state.generationDayOfMonth : null,
        // generationDaysBefore was fully removed 2026-04-26 — no column,
        // no enum value, no payload field.
        serviceWindowDaysBefore: state.serviceWindowDaysBefore,
        serviceWindowDaysAfter: state.serviceWindowDaysAfter,
        // Parts step removed 2026-04-26: includeLocationPmParts is intentionally
        // omitted from the wizard payload. The DB column defaults to false
        // server-side. Parts are managed on the location detail page instead.
        pmBillingModel: billingOptionToBackend(state.billingOption),
        // Invoice Description was removed from the wizard 2026-04-26 (UX pass).
        // The pmBillingLabel column still exists on the backend; we send null.
        pmBillingLabel: null,
        // Amount is optional — store null when blank.
        pmContractAmount:
          contractAmountApplies(state.billingOption) && state.contractAmount.trim() !== ""
            ? state.contractAmount.trim()
            : null,
        // Service Plans (2026-05-07): forward the explicit auto-generate-work
        // flag. Server defaults to false when omitted; we always send the
        // wizard's current value to keep the wire shape predictable.
        autoGenerateJobs: state.autoGenerateJobs,
        isActive: true,
      };
      return apiRequest<RecurringJobTemplate>("/api/recurring-templates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      toast({
        title: "Service plan created",
        description: `"${state.title}" is now active. Upcoming service work will appear on the Service Plans page when due.`,
      });
      // Show the explanation modal unless the user opted out previously.
      const hidden = (() => {
        try { return localStorage.getItem(HIDE_EXPLANATION_KEY) === "1"; }
        catch { return false; }
      })();
      if (hidden) {
        setLocation("/pm");
      } else {
        setExplanationOpen(true);
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Error creating service plan",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function handleCreate() {
    // Final guard — re-validate every step before submit.
    const allErrs = { ...validateStep(0), ...validateStep(1), ...validateStep(2) };
    if (Object.keys(allErrs).length > 0) {
      // Jump back to the first step with an error
      const firstBad = [0, 1, 2].find((s) => Object.keys(validateStep(s)).length > 0) ?? 0;
      setStep(firstBad);
      setShowErrors(true);
      return;
    }
    createMutation.mutate();
  }

  /** Dismiss the post-create explanation modal: persist the opt-out
   *  preference if requested, then redirect to the plans list. */
  function handleExplanationDismiss() {
    if (hideExplanationAgain) {
      try { localStorage.setItem(HIDE_EXPLANATION_KEY, "1"); }
      catch { /* localStorage unavailable — opt-out doesn't persist this session */ }
    }
    setExplanationOpen(false);
    setLocation("/pm");
  }

  const isLastStep = step === STEPS.length - 1;

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 md:px-6 py-4 md:py-5 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setLocation("/pm")}
          data-testid="pm-wizard-back"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Create Service Plan</h1>
      </div>

      {/* Stepper */}
      <Stepper currentStep={step} />

      {/* Layout switches on the Review step: full-width grid (no sidebar)
          since the review IS the preview. Earlier steps keep the live
          Plan Preview on the right. */}
      {!isLastStep ? (
        <div className="grid gap-4 lg:grid-cols-10">
          <div className="lg:col-span-7 space-y-3">
            <Card>
              <CardContent className="px-4 py-4 md:px-5 md:py-5">
                {step === 0 && <StepBasics state={state} onChange={onChange} />}
                {step === 1 && (
                  <StepSchedule
                    state={state}
                    onChange={onChange}
                    errors={showErrors ? stepErrors : {}}
                  />
                )}
                {step === 2 && (
                  <StepPricing
                    state={state}
                    onChange={onChange}
                    errors={showErrors ? stepErrors : {}}
                  />
                )}

                {showErrors && Object.keys(stepErrors).length > 0 && (
                  <div
                    className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    data-testid="pm-wizard-error-summary"
                  >
                    <div className="font-medium mb-0.5">Please fix the following:</div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {Object.values(stepErrors).map((msg) => (
                        <li key={msg}>{msg}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBack}
                disabled={step === 0}
                data-testid="pm-wizard-prev"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <Button size="sm" onClick={handleNext} data-testid="pm-wizard-next">
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>

          <div className="lg:col-span-3">
            <PlanPreviewCard state={state} />
          </div>
        </div>
      ) : (
        // Review step — full width, 2x2 grid of summary cards + compact action bar
        <div className="space-y-3">
          <Card>
            <CardContent className="px-4 py-4 md:px-5 md:py-5">
              <StepReview state={state} />
            </CardContent>
          </Card>

          <FinalActionBar
            onCreate={handleCreate}
            isPending={createMutation.isPending}
          />

          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBack}
              data-testid="pm-wizard-prev"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </div>
        </div>
      )}

      {/* Post-create explanation modal — shown after a successful create
          unless the user has opted out via the "Don't show this again"
          checkbox (persisted in localStorage). Blocks the redirect until
          dismissed so users can read it before navigating away. */}
      <Dialog
        open={explanationOpen}
        onOpenChange={(open) => {
          // Only allow programmatic close via the Got it button so the
          // user can't accidentally lose the redirect step on outside-click.
          if (!open) handleExplanationDismiss();
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="pm-wizard-explanation-modal"
        >
          <DialogHeader>
            <DialogTitle>Service plan created</DialogTitle>
            <DialogDescription>
              This plan will track upcoming service work based on the schedule
              you selected. When service is due, it will appear on the
              Service Plans page so you can create the work order.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            We do this so you stay in control of what gets scheduled and when.
          </p>
          <div className="flex items-center gap-2">
            <Checkbox
              id="pm-wizard-hide-explanation"
              checked={hideExplanationAgain}
              onCheckedChange={(v) => setHideExplanationAgain(Boolean(v))}
              data-testid="pm-wizard-hide-explanation"
            />
            <Label
              htmlFor="pm-wizard-hide-explanation"
              className="text-sm font-normal cursor-pointer"
            >
              Don't show this again
            </Label>
          </div>
          <DialogFooter>
            <Button
              onClick={handleExplanationDismiss}
              data-testid="pm-wizard-explanation-got-it"
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
