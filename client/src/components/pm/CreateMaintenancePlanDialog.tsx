/**
 * CreateMaintenancePlanDialog — Chooser modal for creating a maintenance plan.
 *
 * 2026-04-26: Replaces the direct-to-blank-wizard navigation that used to
 * fire from every "+New" / "Create Maintenance Plan" entry point. The user
 * now picks one of three frictionless starting modes:
 *
 *   1. From Scratch              → /pm/new
 *   2. Use Template              → pick a PM template, then /pm/new?fromTemplateId=:id
 *   3. Duplicate Existing Plan   → pick a maintenance plan, then /pm/new?duplicate=:id
 *
 * The canonical wizard at /pm/new remains the SOLE create surface — this
 * dialog only forwards into it with the right query-param prefill.
 *
 * Architecture:
 *   - Single Dialog with three internal "view" states (mode | template | plan).
 *   - Reuses the existing endpoints `/api/pm/templates` and
 *     `/api/recurring-templates`. No new endpoints are required.
 *   - Search is client-side over the already-cached lists (the same data
 *     PMWorkspacePage uses). Both lists are small (per-tenant), so this is
 *     fine without a server-side search API.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  FilePlus,
  Copy,
  Plus,
  Search,
  Sparkles,
  Loader2,
} from "lucide-react";
import type { PmTemplate, RecurringJobTemplate } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

type ChooserView = "mode" | "template" | "plan";

interface CreateMaintenancePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Recurring templates list response. PMWorkspacePage uses a richer shape with
// joined client/location names; we narrow to what the picker needs.
interface PlanRow {
  id: string;
  title: string;
  isActive: boolean;
  jobType: string | null;
  monthsOfYear: number[] | null;
  generationMode: string | null;
  clientName?: string | null;
  locationName?: string | null;
  locationCity?: string | null;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ============================================================================
// Helpers
// ============================================================================

function formatFrequency(months: number[] | null | undefined): string {
  if (!months || months.length === 0) return "—";
  if (months.length === 12) return "Monthly";
  const sorted = [...months].sort((a, b) => a - b);
  if (sorted.length === 4) {
    const gaps = [sorted[1] - sorted[0], sorted[2] - sorted[1], sorted[3] - sorted[2]];
    if (gaps.every((g) => g === 3)) return "Quarterly";
  }
  if (sorted.length === 2 && sorted[1] - sorted[0] === 6) return "Bi-Annual";
  if (sorted.length === 1) return `Annual (${MONTH_LABELS[sorted[0] - 1]})`;
  return sorted.map((m) => MONTH_LABELS[m - 1]).join(", ");
}

function formatBillingMode(mode: string | null | undefined): string | null {
  if (!mode) return null;
  switch (mode) {
    case "per_visit": return "Per visit";
    case "monthly": return "Monthly";
    case "annually": return "Annual";
    case "none": return "No billing";
    default: return null;
  }
}

function formatPrice(price: string | null | undefined): string | null {
  if (!price) return null;
  const v = parseFloat(price);
  if (Number.isNaN(v) || v <= 0) return null;
  return `$${v.toFixed(2)}`;
}

// ============================================================================
// Mode picker — initial view
// ============================================================================

function ModePicker({
  onPickFromScratch,
  onPickTemplate,
  onPickDuplicate,
}: {
  onPickFromScratch: () => void;
  onPickTemplate: () => void;
  onPickDuplicate: () => void;
}) {
  const cards: Array<{
    id: string;
    title: string;
    description: string;
    cta: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    testId: string;
  }> = [
    {
      id: "scratch",
      title: "From Scratch",
      description: "Create a brand-new maintenance plan.",
      cta: "Start Fresh",
      icon: FilePlus,
      onClick: onPickFromScratch,
      testId: "create-pm-mode-scratch",
    },
    {
      id: "template",
      title: "Use Template",
      description: "Start from a saved reusable template.",
      cta: "Choose Template",
      icon: Sparkles,
      onClick: onPickTemplate,
      testId: "create-pm-mode-template",
    },
    {
      id: "duplicate",
      title: "Duplicate Existing Plan",
      description: "Copy an existing maintenance plan and edit it.",
      cta: "Duplicate Plan",
      icon: Copy,
      onClick: onPickDuplicate,
      testId: "create-pm-mode-duplicate",
    },
  ];

  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.id}
            type="button"
            onClick={c.onClick}
            className="group flex flex-col text-left p-4 rounded-md border-2 border-border hover:border-primary hover:bg-primary/5 transition-colors"
            data-testid={c.testId}
          >
            <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-3">
              <Icon className="h-5 w-5" />
            </div>
            <div className="font-semibold text-sm">{c.title}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-snug flex-1">
              {c.description}
            </div>
            <div className="mt-3 inline-flex items-center text-xs font-medium text-primary group-hover:underline">
              {c.cta}
              <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Template picker — view 2
// ============================================================================

function TemplatePicker({
  onPick,
  onCreateNew,
}: {
  onPick: (templateId: string) => void;
  onCreateNew: () => void;
}) {
  const [search, setSearch] = useState("");

  const { data: templates = [], isLoading } = useQuery<PmTemplate[]>({
    queryKey: ["/api/pm/templates"],
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      return (
        t.name.toLowerCase().includes(q) ||
        (t.summary ?? "").toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [templates, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-10 gap-3">
        <FileText className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <div className="font-semibold text-sm">No templates yet</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Save a reusable PM template to start plans faster.
          </div>
        </div>
        <Button onClick={onCreateNew} size="sm" data-testid="create-pm-template-empty-cta">
          <Plus className="h-4 w-4 mr-1.5" />
          Create Template
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="pl-9 h-9"
          data-testid="create-pm-template-search"
        />
      </div>

      <div className="max-h-[360px] overflow-y-auto rounded-md border divide-y">
        {filtered.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            No templates match "{search}".
          </div>
        ) : (
          filtered.map((t) => {
            const freq = formatFrequency(t.defaultMonthsOfYear);
            const billing = formatBillingMode(t.billingMode);
            const price = formatPrice(t.defaultPrice as string | null);
            const subtitleParts = [t.summary, billing, price].filter(Boolean) as string[];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t.id)}
                className="flex items-center justify-between gap-3 w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                data-testid={`create-pm-template-pick-${t.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{t.name}</div>
                  {subtitleParts.length > 0 && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {subtitleParts.join(" · ")}
                    </div>
                  )}
                  {freq !== "—" && (
                    <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                      Frequency: {freq}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="outline" tabIndex={-1}>
                  Use Template
                </Button>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Plan picker — view 3
// ============================================================================

function PlanPicker({ onPick }: { onPick: (planId: string) => void }) {
  const [search, setSearch] = useState("");

  // Reuse the canonical recurring-templates endpoint with the PM type filter.
  // Same data shape PMWorkspacePage's Plans tab consumes — we narrow to PlanRow.
  const { data: plans = [], isLoading } = useQuery<PlanRow[]>({
    queryKey: ["/api/recurring-templates", { type: "pm" }],
    queryFn: () => apiRequest("/api/recurring-templates?type=pm"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((p) => {
      return (
        p.title.toLowerCase().includes(q) ||
        (p.clientName ?? "").toLowerCase().includes(q) ||
        (p.locationName ?? "").toLowerCase().includes(q) ||
        (p.locationCity ?? "").toLowerCase().includes(q)
      );
    });
  }, [plans, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-10 gap-2">
        <FileText className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <div className="font-semibold text-sm">No maintenance plans yet</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Once you create your first plan, you can duplicate it from here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client, location, or plan name..."
          className="pl-9 h-9"
          data-testid="create-pm-plan-search"
        />
      </div>

      <div className="max-h-[360px] overflow-y-auto rounded-md border divide-y">
        {filtered.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            No plans match "{search}".
          </div>
        ) : (
          filtered.map((p) => {
            const freq = formatFrequency(p.monthsOfYear);
            const locParts = [p.locationName, p.locationCity].filter(Boolean) as string[];
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                className="flex items-center justify-between gap-3 w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                data-testid={`create-pm-plan-pick-${p.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate flex items-center gap-2">
                    {p.title}
                    {!p.isActive && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        Paused
                      </span>
                    )}
                  </div>
                  {p.clientName && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {p.clientName}
                      {locParts.length > 0 ? ` · ${locParts.join(", ")}` : ""}
                    </div>
                  )}
                  {freq !== "—" && (
                    <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                      Frequency: {freq}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="outline" tabIndex={-1}>
                  Duplicate
                </Button>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main dialog
// ============================================================================

export default function CreateMaintenancePlanDialog({
  open,
  onOpenChange,
}: CreateMaintenancePlanDialogProps) {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<ChooserView>("mode");

  // Reset to the mode picker every time the dialog reopens so users always
  // see the three options first (not the last sub-view).
  function handleOpenChange(next: boolean) {
    if (next) setView("mode");
    onOpenChange(next);
  }

  function close() {
    onOpenChange(false);
  }

  function go(path: string) {
    close();
    // Defer navigation a tick so the dialog close animation doesn't fight
    // with the wouter route change.
    queueMicrotask(() => setLocation(path));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        data-testid="create-pm-dialog"
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            {view !== "mode" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setView("mode")}
                data-testid="create-pm-dialog-back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>
              {view === "mode" && "Create Maintenance Plan"}
              {view === "template" && "Choose a Template"}
              {view === "plan" && "Duplicate a Plan"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {view === "mode" && "Choose how you want to start."}
            {view === "template" && "Pick a saved template to prefill schedule and pricing defaults."}
            {view === "plan" && "Pick an existing plan. Client and location will be copied — review them before saving."}
          </DialogDescription>
        </DialogHeader>

        {view === "mode" && (
          <ModePicker
            onPickFromScratch={() => go("/pm/new")}
            onPickTemplate={() => setView("template")}
            onPickDuplicate={() => setView("plan")}
          />
        )}

        {view === "template" && (
          <TemplatePicker
            onPick={(templateId) => go(`/pm/new?fromTemplateId=${encodeURIComponent(templateId)}`)}
            onCreateNew={() => go("/pm/templates/new")}
          />
        )}

        {view === "plan" && (
          <PlanPicker
            onPick={(planId) => go(`/pm/new?duplicate=${encodeURIComponent(planId)}`)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
