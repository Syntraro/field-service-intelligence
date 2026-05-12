/**
 * PMDetailPage — unified plan detail screen at `/pm/:id` (view) and
 * `/pm/:id/edit` (same component, edit mode pre-selected).
 *
 * 2026-04-26 redesign: replaces the prior split detail + edit pages with one
 * compact, two-column screen. The edit route is preserved for deep-link
 * compatibility but renders the SAME component with `mode="edit"` on first
 * render. Clicking Edit toggles in place and does not navigate.
 *
 * Removed surfaces (per UX brief):
 *   - "Parts & Options" card and the "Include location PM parts" toggle —
 *     parts are managed on the location detail page now. The DB column
 *     `include_location_pm_parts` is intentionally NOT sent on save, so
 *     existing values are preserved.
 *   - Big middle "Actions" card with Duplicate / Open Location / Open
 *     Customer. These were demoted; customer + location are still linked
 *     inline in the Plan Details card.
 *
 * Language cleanup:
 *   "Create Due Instances"  → "Generate Due Work"
 *   "Due — Awaiting…"       → "Work Queue" / "Work Ready to Generate"
 *   "Generated — In Progress" → "Generated Work"
 *   "Instance"              → "Service date" / "Scheduled work"
 *   "No Job"                → "Not generated"
 *   "PM Billing"            → "Billing"
 *   "PM History"            → "Completed Work"
 *
 * Logic intentionally untouched:
 *   - PM generation rules, recurrence math, cron / background workers.
 *   - Save endpoint (`PATCH /api/recurring-templates/:id`) and its Zod
 *     payload contract.
 *   - Smart-delete fallback (hard delete vs. archive when jobs exist).
 *   - Tenant scoping + role gates (route-level `requireAdmin` unchanged).
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, useRoute, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel, FormRow } from "@/components/ui/form-field";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft, Pencil, Play, Pause, Zap, Loader2, AlertCircle,
  Calendar, Wrench, DollarSign, Trash2, Save, FileBox, ListChecks,
  CheckCircle2, MapPin, Building2, Clock, X,
} from "lucide-react";

import { PmMonthPicker } from "@/components/pm/PmMonthPicker";
import { PmGenerationModeSelector } from "@/components/pm/PmGenerationModeSelector";
import { PmBillingFields } from "@/components/pm/PmBillingFields";

import type { RecurringJobTemplate, Client } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

interface InstanceWithJob {
  id: string;
  instanceDate: string;
  status: string;
  generatedJobId: string | null;
  claimedAt: string | null;
  createdAt: string;
  job: {
    id: string;
    jobNumber: number;
    summary: string;
    status: string;
  } | null;
}

interface UpcomingQueueItem {
  instanceId: string;
  instanceDate: string;
  complianceStatus: string;
  schedulingState: string;
  templateId?: string;
  job: { id: string; jobNumber: number; status: string } | null;
  visit: { scheduledDate: string | null; completedAt: string | null } | null;
}

interface CustomerCompanyLite {
  id: string;
  name: string;
}

interface EditFormState {
  title: string;
  description: string;
  isActive: boolean;
  months: number[];
  generationMode: "period_start" | "day_of_month";
  generationDayOfMonth: number;
  startDate: string;
  endDate: string;
  serviceWindowDaysBefore: number;
  serviceWindowDaysAfter: number;
  pmBillingModel: string;
  pmBillingLabel: string;
  pmContractAmount: string;
  // Service Plans (2026-05-07): explicit "Automatically generate work" toggle
  autoGenerateJobs: boolean;
}

function templateToFormState(tpl: RecurringJobTemplate): EditFormState {
  // Defensive normalization: collapse any legacy generation mode (e.g. the
  // briefly-introduced "days_before") to "period_start" since the editor
  // surfaces only period_start / day_of_month.
  const generationMode: EditFormState["generationMode"] =
    tpl.generationMode === "day_of_month" ? "day_of_month" : "period_start";
  return {
    title: tpl.title,
    description: tpl.description ?? "",
    isActive: tpl.isActive,
    months: tpl.monthsOfYear ?? [],
    generationMode,
    generationDayOfMonth: tpl.generationDayOfMonth ?? 1,
    startDate: tpl.startDate ?? "",
    endDate: tpl.endDate ?? "",
    serviceWindowDaysBefore: tpl.serviceWindowDaysBefore ?? 7,
    serviceWindowDaysAfter: tpl.serviceWindowDaysAfter ?? 14,
    pmBillingModel: (tpl as any).pmBillingModel ?? "",
    pmBillingLabel: (tpl as any).pmBillingLabel ?? "",
    pmContractAmount: (tpl as any).pmContractAmount ?? "",
    autoGenerateJobs: (tpl as { autoGenerateJobs?: boolean | null }).autoGenerateJobs ?? false,
  };
}

// ============================================================================
// Helpers / formatters
// ============================================================================

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMonths(months: number[] | null): string {
  if (!months || months.length === 0) return "All year";
  if (months.length === 12) return "All year";
  return months.slice().sort((a, b) => a - b).map((m) => MONTH_ABBR[m - 1]).join(", ");
}

function formatGenerationMode(mode: string | null, dayOfMonth: number | null): string {
  if (mode === "period_start") return "1st of each scheduled month";
  if (mode === "day_of_month" && dayOfMonth) return `Day ${dayOfMonth} of each scheduled month`;
  if (mode === "phase") return "Phase-based";
  return "—";
}

function formatBillingModel(model: string | null): string {
  switch (model) {
    case "per_visit": return "Per visit — invoice each completed job";
    case "monthly_fixed": return "Monthly fixed — covered by contract";
    case "annual_prepaid": return "Annual prepaid — covered by contract";
    case "do_not_bill": return "Do not bill — no invoice expected";
    default: return "Not set";
  }
}

function jobStatusBadge(status: string) {
  const map: Record<string, { className: string; label: string }> = {
    open: { className: "border-blue-300 bg-blue-50 text-blue-700", label: "Open" },
    in_progress: { className: "border-yellow-300 bg-yellow-50 text-yellow-700", label: "In progress" },
    completed: { className: "border-green-300 bg-green-50 text-green-700", label: "Completed" },
    cancelled: { className: "border-red-300 bg-red-50 text-red-700", label: "Cancelled" },
    invoiced: { className: "border-purple-300 bg-purple-50 text-purple-700", label: "Invoiced" },
  };
  const cfg = map[status] ?? { className: "", label: status };
  return <Badge variant="outline" className={`text-[11px] ${cfg.className}`}>{cfg.label}</Badge>;
}

// ============================================================================
// Card primitives
// ============================================================================

function SectionCard({
  icon: Icon, title, children, action,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        {action}
      </div>
      <CardContent className="px-4 py-3">{children}</CardContent>
    </Card>
  );
}

function DetailRow({ label, children, value }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-right text-slate-900 font-medium min-w-0 break-words">
        {children ?? value ?? "—"}
      </span>
    </div>
  );
}

// ============================================================================
// Identity card (view mode) — single compact customer + location row.
// Replaces the previous "Plan Details" card so customer/location data is
// surfaced once at the top and never repeated in another card. Job type
// and priority are intentionally NOT shown per the 2026-04-26 IA brief.
// ============================================================================

function IdentityCard({
  template, customerName, location, locationName, notes,
}: {
  template: RecurringJobTemplate;
  customerName: string;
  location: Client | undefined;
  locationName: string;
  notes: string | null | undefined;
}) {
  // Compose the location's full street address from its parts.
  const addressLine = location
    ? [location.address, location.address2].filter(Boolean).join(" ")
    : "";
  const cityLine = location
    ? [location.city, location.province, location.postalCode].filter(Boolean).join(", ")
    : "";
  const fullAddress = [addressLine, cityLine].filter(Boolean).join(" · ");

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="px-4 py-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <Building2 className="h-3 w-3 text-slate-400" />
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Customer</span>
            </div>
            {template.clientId ? (
              <Link
                href={`/clients/${template.clientId}`}
                className="text-sm font-semibold text-slate-900 hover:text-primary hover:underline truncate block"
                data-testid="pm-detail-customer-link"
              >
                {customerName}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-slate-500">—</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin className="h-3 w-3 text-slate-400" />
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Location</span>
            </div>
            {template.locationId ? (
              <Link
                href={template.clientId ? `/clients/${template.clientId}?location=${template.locationId}` : "/clients"}
                className="text-sm font-semibold text-slate-900 hover:text-primary hover:underline truncate block"
                data-testid="pm-detail-location-link"
              >
                {locationName}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-slate-500">—</span>
            )}
            {fullAddress && (
              <p className="text-xs text-slate-500 truncate mt-0.5">{fullAddress}</p>
            )}
          </div>
        </div>
        {notes && (
          <p className="text-xs text-slate-500 italic mt-3 pt-3 border-t border-slate-100">
            {notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Plan basics edit card (edit mode) — replaces IdentityCard while editing.
// Customer + location are immutable on this screen, so they're not surfaced
// here. Plan name + notes + active toggle are the only editable plan-level
// metadata; job type and priority are intentionally not editable any more.
// ============================================================================

function PlanBasicsEditCard({
  form, onChange,
}: {
  form: EditFormState;
  onChange: (patch: Partial<EditFormState>) => void;
}) {
  return (
    <SectionCard icon={Wrench} title="Plan">
      <div className="space-y-3">
        <FormField>
          <FormLabel srOnly>Plan name</FormLabel>
          <Input
            placeholder="Plan name"
            value={form.title}
            onChange={(e) => onChange({ title: e.target.value })}
            data-testid="pm-detail-title"
          />
        </FormField>
        <FormField>
          <FormLabel srOnly>Internal notes (optional)</FormLabel>
          <Textarea
            placeholder="Internal notes (optional)"
            value={form.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={2}
            data-testid="pm-detail-description"
          />
        </FormField>
        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            id="pm-detail-active"
            checked={form.isActive}
            onCheckedChange={(v) => onChange({ isActive: Boolean(v) })}
            data-testid="pm-detail-active"
          />
          <Label htmlFor="pm-detail-active" className="cursor-pointer text-sm">
            Active — generates due work automatically
          </Label>
        </div>
      </div>
    </SectionCard>
  );
}

// ============================================================================
// Schedule card
// ============================================================================

function ScheduleCard({
  mode, template, form, onChange,
}: {
  mode: "view" | "edit";
  template: RecurringJobTemplate;
  form: EditFormState | null;
  onChange: (patch: Partial<EditFormState>) => void;
}) {
  if (mode === "edit" && form) {
    return (
      <SectionCard icon={Calendar} title="Schedule">
        <div className="space-y-4">
          <PmMonthPicker
            months={form.months}
            onChange={(months) => onChange({ months })}
            testIdPrefix="pm-detail"
          />
          <PmGenerationModeSelector
            generationMode={form.generationMode}
            generationDayOfMonth={form.generationDayOfMonth}
            onModeChange={(generationMode) => onChange({ generationMode })}
            onDayChange={(generationDayOfMonth) => onChange({ generationDayOfMonth })}
            testIdPrefix="pm-detail"
          />
          {/* Service Generation (2026-05-09): one card, two selectable rows.
              autoGenerateJobs: true → auto create; false → notify + window. */}
          <div className="rounded-md border border-border bg-card overflow-hidden" data-testid="pm-detail-service-generation">
            <div className="px-3 pt-3 pb-2 border-b border-border">
              <h3 className="text-sm font-semibold">Service Generation</h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                Choose how this plan is handled when service is due.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onChange({ autoGenerateJobs: true })}
              className={`w-full text-left px-3 py-2.5 transition-colors ${
                form.autoGenerateJobs ? "bg-primary/5" : "hover:bg-muted/40"
              }`}
              data-testid="pm-detail-service-gen-auto"
            >
              <div className="flex items-start gap-2.5">
                <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                  form.autoGenerateJobs ? "border-primary" : "border-muted-foreground/40"
                }`}>
                  {form.autoGenerateJobs && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm">Automatically create work orders</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    An unscheduled work order will be created automatically on the job creation date.
                  </div>
                  {form.autoGenerateJobs && (
                    <div className="text-xs text-primary mt-1 leading-snug">
                      Dispatch can then schedule and assign the work.
                    </div>
                  )}
                </div>
              </div>
            </button>

            <div className="flex items-center gap-2 px-3 py-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">OR</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className={!form.autoGenerateJobs ? "bg-primary/5" : ""}>
              <button
                type="button"
                onClick={() => onChange({ autoGenerateJobs: false })}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  !form.autoGenerateJobs ? "" : "hover:bg-muted/40"
                }`}
                data-testid="pm-detail-service-gen-manual"
              >
                <div className="flex items-start gap-2.5">
                  <div className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                    !form.autoGenerateJobs ? "border-primary" : "border-muted-foreground/40"
                  }`}>
                    {!form.autoGenerateJobs && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm">Notify me to create the work order</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      You'll be notified so you can manually create the work order.
                    </div>
                  </div>
                </div>
              </button>

              {!form.autoGenerateJobs && (
                <div className="px-3 pb-3 ml-6 space-y-2.5">
                  <div>
                    <div className="text-xs font-semibold">Notification window</div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      You'll be notified this many days before the work order is created. The work order should be completed within the specified days of creation or it will be marked overdue.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={90}
                        className="w-16 h-8 text-sm"
                        value={form.serviceWindowDaysBefore}
                        onChange={(e) =>
                          onChange({ serviceWindowDaysBefore: Math.max(0, parseInt(e.target.value, 10) || 0) })
                        }
                        data-testid="pm-detail-window-before"
                      />
                      <Label className="text-xs text-muted-foreground">days before job creation</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={90}
                        className="w-16 h-8 text-sm"
                        value={form.serviceWindowDaysAfter}
                        onChange={(e) =>
                          onChange({ serviceWindowDaysAfter: Math.max(0, parseInt(e.target.value, 10) || 0) })
                        }
                        data-testid="pm-detail-window-after"
                      />
                      <Label className="text-xs text-muted-foreground">days after job creation</Label>
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                    Example: You'll be notified{" "}
                    <span className="font-medium text-foreground">{form.serviceWindowDaysBefore}</span>{" "}
                    days before the work order is created. The work order should be completed within{" "}
                    <span className="font-medium text-foreground">{form.serviceWindowDaysAfter}</span>{" "}
                    days of creation or it will be marked overdue.
                  </div>
                </div>
              )}
            </div>
          </div>
          <FormRow className="grid-cols-2">
            <FormField>
              <FormLabel>Start date</FormLabel>
              <CanonicalDatePicker
                value={form.startDate}
                onChange={(next) => onChange({ startDate: next ?? "" })}
                className="w-full h-9 text-sm"
                data-testid="pm-detail-start-date"
              />
            </FormField>
            <FormField>
              <FormLabel>End date (optional)</FormLabel>
              <CanonicalDatePicker
                value={form.endDate}
                onChange={(next) => onChange({ endDate: next ?? "" })}
                placeholder="Optional"
                clearable
                className="w-full h-9 text-sm"
                data-testid="pm-detail-end-date"
              />
            </FormField>
          </FormRow>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard icon={Calendar} title="Schedule">
      <div className="divide-y divide-slate-100">
        <DetailRow label="Months" value={formatMonths(template.monthsOfYear)} />
        <DetailRow label="Due timing" value={formatGenerationMode(template.generationMode, template.generationDayOfMonth)} />
        <DetailRow label="Start date" value={template.startDate ?? "—"} />
        {template.endDate && <DetailRow label="End date" value={template.endDate} />}
        <DetailRow
          label="Service generation"
          value={(template as { autoGenerateJobs?: boolean | null }).autoGenerateJobs
            ? "Automatically create work orders"
            : `Notify manually — ${template.serviceWindowDaysBefore ?? 7}d before / ${template.serviceWindowDaysAfter ?? 14}d after`}
        />
      </div>
    </SectionCard>
  );
}

// ============================================================================
// Billing card
// ============================================================================

function BillingCard({
  mode, template, form, onChange,
}: {
  mode: "view" | "edit";
  template: RecurringJobTemplate;
  form: EditFormState | null;
  onChange: (patch: Partial<EditFormState>) => void;
}) {
  if (mode === "edit" && form) {
    return (
      <SectionCard icon={DollarSign} title="Billing">
        <PmBillingFields
          billingModel={form.pmBillingModel}
          billingLabel={form.pmBillingLabel}
          contractAmount={form.pmContractAmount}
          onBillingModelChange={(pmBillingModel) => onChange({ pmBillingModel })}
          onBillingLabelChange={(pmBillingLabel) => onChange({ pmBillingLabel })}
          onContractAmountChange={(pmContractAmount) => onChange({ pmContractAmount })}
          testIdPrefix="pm-detail"
        />
      </SectionCard>
    );
  }

  // 2026-04-26 polish: always render in view mode, even with no billing
  // configured — the user wants visibility into "Not set" so they know
  // the plan won't bill automatically.
  const billingModel = (template as any).pmBillingModel as string | null;
  const billingLabel = (template as any).pmBillingLabel as string | null;
  const contractAmount = (template as any).pmContractAmount as string | null;
  const hasAnyBilling = Boolean(billingModel || billingLabel || contractAmount);

  return (
    <SectionCard icon={DollarSign} title="Billing">
      <div className="divide-y divide-slate-100">
        <DetailRow label="Billing model" value={formatBillingModel(billingModel)} />
        {billingLabel && <DetailRow label="Billing label" value={billingLabel} />}
        {contractAmount && <DetailRow label="Contract amount" value={`$${contractAmount}`} />}
      </div>
      {!hasAnyBilling && (
        <p className="text-xs text-slate-500 mt-2">
          This plan won&apos;t bill automatically. You can set a billing model if needed.
        </p>
      )}
    </SectionCard>
  );
}

// ============================================================================
// Right column work cards
// ============================================================================

function WorkQueueCard({
  pending, isGenerating, isActive, onGenerate,
}: {
  pending: InstanceWithJob[];
  isGenerating: boolean;
  isActive: boolean;
  onGenerate: () => void;
}) {
  return (
    <SectionCard
      icon={ListChecks}
      title="Work Queue"
      action={
        pending.length > 0 ? (
          <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-[11px]">
            {pending.length}
          </Badge>
        ) : undefined
      }
    >
      {pending.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-2">No work waiting to be generated.</p>
      ) : (
        <div className="space-y-1">
          {pending.map((inst) => (
            <div
              key={inst.id}
              className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 tabular-nums">{inst.instanceDate}</div>
                <div className="text-[11px] text-slate-500">Not generated</div>
              </div>
              <Button
                size="sm"
                onClick={onGenerate}
                disabled={isGenerating || !isActive}
                data-testid={`pm-detail-row-generate-${inst.id}`}
                className="h-7 px-2.5 text-xs"
              >
                {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
                Generate
              </Button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function GeneratedWorkCard({ generated }: { generated: InstanceWithJob[] }) {
  return (
    <SectionCard
      icon={FileBox}
      title="Generated Work"
      action={
        generated.length > 0 ? (
          <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700 text-[11px]">
            {generated.length}
          </Badge>
        ) : undefined
      }
    >
      {generated.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-2">No active jobs from this plan right now.</p>
      ) : (
        <div className="space-y-1">
          {generated.map((inst) => (
            <Link
              key={inst.id}
              href={inst.job ? `/jobs/${inst.job.id}` : "#"}
              className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 tabular-nums">{inst.instanceDate}</div>
                <div className="text-[11px] text-primary">
                  {inst.job ? `Job #${inst.job.jobNumber}` : "—"}
                </div>
              </div>
              {inst.job && jobStatusBadge(inst.job.status)}
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function CompletedWorkCard({ history }: { history: InstanceWithJob[] }) {
  return (
    <SectionCard
      icon={CheckCircle2}
      title="Completed Work"
      action={
        history.length > 0 ? (
          <Badge variant="secondary" className="text-[11px]">{history.length}</Badge>
        ) : undefined
      }
    >
      {history.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-2">No completed work yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-slate-100 hover:bg-transparent">
              <TableHead className="h-7 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Date</TableHead>
              <TableHead className="h-7 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Job</TableHead>
              <TableHead className="h-7 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((inst) => (
              <TableRow key={inst.id} className="border-slate-100 hover:bg-slate-50">
                <TableCell className="text-xs tabular-nums py-1.5">{inst.instanceDate}</TableCell>
                <TableCell className="text-xs py-1.5">
                  {inst.job ? (
                    <Link href={`/jobs/${inst.job.id}`} className="text-primary hover:underline">#{inst.job.jobNumber}</Link>
                  ) : "—"}
                </TableCell>
                <TableCell className="py-1.5">
                  {inst.status === "skipped" ? (
                    <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-600 text-[11px]">Skipped</Badge>
                  ) : inst.status === "canceled" ? (
                    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-600 text-[11px]">Canceled</Badge>
                  ) : inst.job ? jobStatusBadge(inst.job.status) : (
                    <span className="text-[11px] text-slate-400">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}

// ============================================================================
// Main component — view + edit unified
// ============================================================================

export default function PMDetailPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const templateId = params.id;
  const { toast } = useToast();

  // Detect /pm/:id/edit and pre-select edit mode. The component lives at
  // both routes; the edit URL is preserved for deep-link compatibility.
  const [editRouteMatch] = useRoute("/pm/:id/edit");
  const [mode, setMode] = useState<"view" | "edit">(editRouteMatch ? "edit" : "view");
  const [form, setForm] = useState<EditFormState | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────
  const {
    data: template,
    isLoading,
    isError,
  } = useQuery<RecurringJobTemplate>({
    queryKey: ["/api/recurring-templates", templateId],
    queryFn: () => apiRequest(`/api/recurring-templates/${templateId}`),
    enabled: Boolean(templateId),
  });

  const { data: instances = [] } = useQuery<InstanceWithJob[]>({
    queryKey: ["/api/recurring-templates", templateId, "instances"],
    queryFn: () => apiRequest(`/api/recurring-templates/${templateId}/instances?limit=20`),
    enabled: Boolean(templateId),
  });

  const { data: allUpcoming = [] } = useQuery<UpcomingQueueItem[]>({
    queryKey: ["/api/recurring-templates/upcoming"],
    queryFn: () => apiRequest("/api/recurring-templates/upcoming"),
    enabled: Boolean(templateId),
  });
  const upcomingForTemplate = useMemo(
    () =>
      allUpcoming.filter(
        (i) =>
          i.templateId === templateId ||
          instances.some((inst) => inst.id === i.instanceId),
      ),
    [allUpcoming, instances, templateId],
  );

  const { data: locationsData } = useQuery<Client[]>({
    queryKey: ["/api/clients", "pm-detail-locations"],
    queryFn: () => apiRequest("/api/clients?limit=500"),
    select: (res: any) => (res?.data || res || []) as Client[],
    enabled: Boolean(template?.locationId),
  });
  const location = useMemo(
    () => (locationsData ?? []).find((c) => c.id === template?.locationId),
    [locationsData, template?.locationId],
  );

  const { data: companiesData } = useQuery<CustomerCompanyLite[]>({
    queryKey: ["/api/customer-companies"],
    enabled: Boolean(template?.clientId),
  });
  const customerCompany = useMemo(
    () => (companiesData ?? []).find((c) => c.id === template?.clientId),
    [companiesData, template?.clientId],
  );

  // ── Form initialization (edit mode) ───────────────────────────────────
  useEffect(() => {
    if (mode === "edit" && template && !form) {
      setForm(templateToFormState(template));
    }
  }, [mode, template, form]);

  function onChange(patch: Partial<EditFormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  // ── Mutations ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form || !template) return;
      // Note: includeLocationPmParts is intentionally OMITTED from the
      // payload. PATCH only updates supplied fields; the existing DB value
      // is preserved. The user-facing toggle for it has been removed.
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        isActive: form.isActive,
        monthsOfYear: form.months,
        generationMode: form.generationMode,
        generationDayOfMonth: form.generationMode === "day_of_month" ? form.generationDayOfMonth : null,
        serviceWindowDaysBefore: form.serviceWindowDaysBefore,
        serviceWindowDaysAfter: form.serviceWindowDaysAfter,
        startDate: form.startDate || undefined,
        endDate: form.endDate || null,
        pmBillingModel: form.pmBillingModel || null,
        pmBillingLabel: form.pmBillingLabel.trim() || null,
        pmContractAmount: form.pmContractAmount || null,
        autoGenerateJobs: form.autoGenerateJobs,
      };
      return apiRequest(`/api/recurring-templates/${template.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", templateId] });
      toast({ title: "Plan saved" });
      setMode("view");
      setForm(null);
      // If we arrived via /pm/:id/edit, normalize the URL after save.
      if (editRouteMatch) setLocation(`/pm/${templateId}`, { replace: true });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async () => {
      if (!template) return;
      return apiRequest(`/api/recurring-templates/${template.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !template.isActive }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", templateId] });
      toast({ title: template?.isActive ? "Plan paused" : "Plan resumed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () =>
      apiRequest(`/api/recurring-templates/${templateId}/generate?scope=current_month`, { method: "POST" }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", templateId, "instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      const created = data?.instancesCreated ?? 0;
      toast({
        title: created > 0 ? `${created} due item${created === 1 ? "" : "s"} added` : "Nothing to generate",
        description:
          created > 0
            ? "Open the Work Queue tab to turn them into jobs."
            : "All upcoming work already exists.",
      });
    },
    onError: (err: Error) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const deleteContractMutation = useMutation({
    mutationFn: async () =>
      apiRequest<{ action: "deleted" | "archived"; instancesCanceled?: number }>(
        `/api/recurring-templates/${templateId}`,
        { method: "DELETE" },
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      const wasArchived = data?.action === "archived";
      const canceledCount = data?.instancesCanceled ?? 0;
      toast({
        title: wasArchived ? "Plan archived" : "Plan deleted",
        description: wasArchived
          ? `Plan deactivated (has job history).${canceledCount > 0 ? ` ${canceledCount} pending due item(s) canceled.` : ""}`
          : "Plan and all instances permanently removed.",
      });
      setLocation("/pm");
    },
    onError: (err: Error) => toast({ title: "Failed to delete plan", description: err.message, variant: "destructive" }),
  });

  // ── Derive grouped instances for right column ─────────────────────────
  const { pending, generated, history } = useMemo(() => {
    const p: InstanceWithJob[] = [];
    const g: InstanceWithJob[] = [];
    const h: InstanceWithJob[] = [];
    for (const inst of instances) {
      if (inst.status === "skipped" || inst.status === "canceled") h.push(inst);
      else if (!inst.generatedJobId) p.push(inst);
      else if (inst.job && (inst.job.status === "completed" || inst.job.status === "invoiced")) h.push(inst);
      else g.push(inst);
    }
    return { pending: p, generated: g, history: h };
  }, [instances]);

  // ── Validation (edit mode) ────────────────────────────────────────────
  const errors: string[] = [];
  if (mode === "edit" && form) {
    if (!form.title.trim()) errors.push("Plan name is required.");
    if (form.months.length === 0) errors.push("Select at least 1 month.");
    if (form.generationMode === "day_of_month" && (form.generationDayOfMonth < 1 || form.generationDayOfMonth > 31)) {
      errors.push("Day of month must be 1–31.");
    }
  }
  const isValid = mode !== "edit" || (form !== null && errors.length === 0);

  // ── Render guards ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !template) {
    return (
      <div className="min-h-screen bg-app-bg flex flex-col items-center gap-4 py-24">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">Plan not found.</p>
        <Button variant="outline" onClick={() => setLocation("/pm")}>Back to Plans</Button>
      </div>
    );
  }

  const locationName = location
    ? [location.companyName, location.location].filter(Boolean).join(" — ")
    : template.locationId ?? "—";
  const customerName = customerCompany?.name ?? "—";

  // Handlers
  const enterEdit = () => {
    setForm(templateToFormState(template));
    setMode("edit");
  };
  const cancelEdit = () => {
    setForm(null);
    setMode("view");
    if (editRouteMatch) setLocation(`/pm/${templateId}`, { replace: true });
  };

  const workReadyCount = upcomingForTemplate.filter(
    (i) =>
      i.schedulingState === "not_generated" &&
      ["in_window", "due_soon", "overdue"].includes(i.complianceStatus),
  ).length;

  // Header title format: "Service Plan — {customer name}", falling back
  // to the plan title when no customer is linked. The plan title moves
  // to the subtitle so it stays visible when the title shows the
  // customer instead. (2026-05-07 module rename: Maintenance → Service
  // Plans; the route, jobType="maintenance" enum, and recurrence
  // mechanics are unchanged.)
  const hasCustomer = customerName && customerName !== "—";
  const headerTitle = hasCustomer ? `Service Plan — ${customerName}` : template.title;
  const subtitleParts: string[] = [];
  if (hasCustomer) subtitleParts.push(template.title);
  if (locationName && locationName !== "—") subtitleParts.push(locationName);
  const subtitle = subtitleParts.join(" · ");

  return (
    <div className="min-h-screen bg-app-bg" data-testid="pm-detail-page">
      <div className="max-w-7xl mx-auto px-4 sm:px-5 lg:px-6 py-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2" onClick={() => setLocation("/pm")} data-testid="pm-detail-back">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold text-slate-900 truncate">{headerTitle}</h1>
                {template.isActive ? (
                  <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">Active</Badge>
                ) : (
                  <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700">Paused</Badge>
                )}
              </div>
              {subtitle && (
                <p className="text-xs text-slate-500 truncate mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>

          {/* Header actions — view vs edit */}
          <div className="flex items-center gap-2 shrink-0">
            {mode === "view" ? (
              <>
                <Button variant="outline" size="sm" className="h-8" onClick={enterEdit} data-testid="pm-detail-edit">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => toggleActiveMutation.mutate()}
                  disabled={toggleActiveMutation.isPending}
                  data-testid="pm-detail-toggle"
                >
                  {template.isActive ? <Pause className="h-3.5 w-3.5 mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                  {template.isActive ? "Pause" : "Resume"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete plan "${template.title}"?\n\nIf this plan has generated jobs, it will be archived instead.`)) {
                      deleteContractMutation.mutate();
                    }
                  }}
                  disabled={deleteContractMutation.isPending}
                  data-testid="pm-detail-delete"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
                </Button>
                {workReadyCount > 0 && template.isActive && (
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => generateMutation.mutate()}
                    disabled={generateMutation.isPending}
                    data-testid="pm-detail-generate"
                  >
                    {generateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                    Generate Due Work ({workReadyCount})
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={cancelEdit}
                  disabled={saveMutation.isPending}
                  data-testid="pm-detail-cancel"
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => saveMutation.mutate()}
                  disabled={!isValid || saveMutation.isPending}
                  data-testid="pm-detail-save"
                >
                  {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                  Save Changes
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Identity card (view) OR Plan basics (edit) — single, compact, always
            below the header. Replaces the old summary strip + Plan Details
            card so customer/location data appears once and only once. */}
        {mode === "view" ? (
          <IdentityCard
            template={template}
            customerName={customerName}
            location={location}
            locationName={locationName}
            notes={template.description}
          />
        ) : null}

        {/* Validation errors (edit mode) */}
        {mode === "edit" && errors.length > 0 && (
          <div className="text-sm text-destructive bg-red-50 border border-red-200 rounded-md px-3 py-2 space-y-0.5">
            {errors.map((e) => <p key={e}>{e}</p>)}
          </div>
        )}

        {/* Two-column body */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 space-y-3">
            {mode === "edit" && form && (
              <PlanBasicsEditCard form={form} onChange={onChange} />
            )}
            <ScheduleCard mode={mode} template={template} form={form} onChange={onChange} />
            <BillingCard mode={mode} template={template} form={form} onChange={onChange} />
          </div>
          <div className="space-y-3">
            <WorkQueueCard
              pending={pending}
              isGenerating={generateMutation.isPending}
              isActive={template.isActive}
              onGenerate={() => generateMutation.mutate()}
            />
            <GeneratedWorkCard generated={generated} />
            <CompletedWorkCard history={history} />
          </div>
        </div>

        {/* Footer hint that completion / scheduling lives on each job */}
        <p className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1">
          <Clock className="h-3 w-3" />
          Schedule and complete work from each generated job.
        </p>
      </div>
    </div>
  );
}
