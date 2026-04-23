/**
 * Import Center — the canonical single page for every CSV import.
 *
 * 2026-04-22: Replaces the three legacy per-entity pages (`/settings/
 * import-clients`, `/settings/import-jobs`, `/settings/import-products`).
 * All three entities now share one URL (`/settings/import`) and one
 * wizard — switching entity types is a tab click, not a page navigation.
 *
 * 2026-04-22 (redundant-gateway fix): landing on `/settings/import` with
 * no `?type=` param used to render a three-card chooser that did nothing
 * the tab strip above the wizard doesn't already do — one wasted click.
 * Missing/invalid `?type=` now defaults to `clients`, and the page always
 * renders "tab strip + wizard". Deep links like `?type=jobs` still work.
 *
 * Architecture:
 *   - Selected type lives in the `?type=…` query param so deep links +
 *     browser back/forward behave correctly. Missing/invalid → "clients".
 *   - Type change remounts the wizard via `key={entity}` so wizard state
 *     (CSV text, mappings, preview, commit) resets cleanly on switch.
 *   - Zero entity-specific logic on this page — each config lives in
 *     `@/components/imports/configs/*` and all behavior is encapsulated
 *     in the shared ImportWizard (variant="embedded" for this surface).
 */

import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Upload, Users, Briefcase, Package, Receipt } from "lucide-react";
import {
  ImportWizard,
  StepIndicator,
  type Step,
} from "@/components/imports/ImportWizard";
import { clientImportConfig } from "@/components/imports/configs/clientImportConfig";
import { jobImportConfig } from "@/components/imports/configs/jobImportConfig";
import { productImportConfig } from "@/components/imports/configs/productImportConfig";
import { invoiceImportConfig } from "@/components/imports/configs/invoiceImportConfig";
import type { ImportWizardConfig } from "@/components/imports/types";

// ---------------------------------------------------------------------------
// Entity catalog (the three options on the selector)
// ---------------------------------------------------------------------------

const TYPE_KEYS = ["clients", "jobs", "products", "invoices"] as const;
type TypeKey = (typeof TYPE_KEYS)[number];

// Default when the URL has no (or an invalid) ?type= param. See the
// file header — this is what replaces the old card-chooser screen.
const DEFAULT_TYPE: TypeKey = "clients";

function isTypeKey(value: string | null): value is TypeKey {
  return value != null && (TYPE_KEYS as readonly string[]).includes(value);
}

interface TypeDef {
  key: TypeKey;
  label: string;
  tabLabel: string;
  description: string;
  icon: typeof Users;
  config: ImportWizardConfig;
}

const TYPES: TypeDef[] = [
  {
    key: "clients",
    label: "Clients",
    tabLabel: "Clients",
    description: "Customer companies, service locations, and contacts.",
    icon: Users,
    config: clientImportConfig,
  },
  {
    key: "jobs",
    label: "Historical Jobs",
    tabLabel: "Historical Jobs",
    description: "Backfill past work orders — archived on import.",
    icon: Briefcase,
    config: jobImportConfig,
  },
  {
    key: "products",
    label: "Products & Services",
    tabLabel: "Products & Services",
    description: "Line-item catalog for invoices and quotes.",
    icon: Package,
    config: productImportConfig,
  },
  {
    key: "invoices",
    label: "Invoices",
    tabLabel: "Invoices",
    description: "Historical invoices — summarized for reporting, raw detail in notes.",
    icon: Receipt,
    config: invoiceImportConfig,
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ImportCenterPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();

  const activeType: TypeKey = useMemo(() => {
    const raw = new URLSearchParams(search).get("type");
    return isTypeKey(raw) ? raw : DEFAULT_TYPE;
  }, [search]);

  const active = useMemo(
    () => TYPES.find((t) => t.key === activeType) ?? TYPES[0],
    [activeType],
  );

  const setType = (key: TypeKey) => {
    setLocation(`/settings/import?type=${key}`);
  };

  // 2026-04-23: step state hoisted up from ImportWizard so the canonical
  // Upload → Map → Preview → Done strip can render at the top of the
  // page, above the type chooser. The wizard reports its step via
  // `onStepChange` and suppresses its inline indicator via
  // `hideStepIndicator`. Remounting the wizard on type change resets
  // everything including this state (see `key={active.key}` below).
  const [wizardStep, setWizardStep] = useState<Step>("upload");

  return (
    <div className="min-h-screen bg-[#F4F8F4]" data-testid="import-center-page">
      <main className="mx-auto max-w-6xl px-4 sm:px-5 lg:px-6 py-6 space-y-6">
        {/* Page header — stays constant as the user switches types. */}
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-white border border-[#e2e8f0]">
              <Upload className="h-5 w-5 text-[#76B054]" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#111827] tracking-tight">Import Center</h1>
              <p className="text-xs text-[#4b5563] mt-0.5">
                Bring your existing data into Syntraro in a few clicks.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setLocation("/settings")}>
            Back to Settings
          </Button>
        </header>

        {/* 2026-04-23: canonical step strip hoisted above the type chooser.
            The wizard reports its step via onStepChange and suppresses its
            own inline indicator. */}
        <section aria-label="Import progress" className="pt-1">
          <StepIndicator step={wizardStep} />
        </section>

        {/* Primary record-type picker — "What do you want to import?" */}
        <section aria-labelledby="import-type-heading">
          <div className="flex items-baseline justify-between mb-2">
            <h2 id="import-type-heading" className="text-sm font-semibold text-[#111827]">
              What do you want to import?
            </h2>
          </div>
          <TypeSelector active={activeType} onSelect={setType} />
        </section>

        {/* Wizard body — Source picker + Upload/Map/Preview/Done steps.
            Remount on type change so state resets cleanly. */}
        <section aria-label="Import wizard">
          <ImportWizard
            key={active.key}
            config={active.config}
            variant="embedded"
            hideStepIndicator
            onStepChange={setWizardStep}
          />
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type selector — 2026-04-22 upgraded to dominant record-type cards
// ---------------------------------------------------------------------------

function TypeSelector({
  active,
  onSelect,
}: {
  active: TypeKey;
  onSelect: (key: TypeKey) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      role="tablist"
      aria-label="Import type"
    >
      {TYPES.map((t) => {
        const isActive = t.key === active;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.key)}
            data-testid={`import-type-tab-${t.key}`}
            className={`group text-left rounded-lg border-2 p-4 transition-all focus:outline-none focus:ring-2 focus:ring-[#76B054]/40 ${
              isActive
                ? "border-[#76B054] bg-white shadow-sm"
                : "border-[#e2e8f0] bg-white hover:border-[#76B054]/60 hover:shadow-sm"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className={`p-2 rounded-md transition-colors ${
                  isActive ? "bg-[#76B054]" : "bg-[#F0F5F0] group-hover:bg-[#76B054]/15"
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? "text-white" : "text-[#76B054]"}`} />
              </div>
              <span
                className={`text-base font-semibold ${
                  isActive ? "text-[#111827]" : "text-[#111827]"
                }`}
              >
                {t.label}
              </span>
            </div>
            <p className="text-xs text-[#4b5563] leading-snug">{t.description}</p>
          </button>
        );
      })}
    </div>
  );
}
