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

import { useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Upload, Users, Briefcase, Package } from "lucide-react";
import { ImportWizard } from "@/components/imports/ImportWizard";
import { clientImportConfig } from "@/components/imports/configs/clientImportConfig";
import { jobImportConfig } from "@/components/imports/configs/jobImportConfig";
import { productImportConfig } from "@/components/imports/configs/productImportConfig";
import type { ImportWizardConfig } from "@/components/imports/types";

// ---------------------------------------------------------------------------
// Entity catalog (the three options on the selector)
// ---------------------------------------------------------------------------

const TYPE_KEYS = ["clients", "jobs", "products"] as const;
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

  return (
    <div className="min-h-screen bg-[#F4F8F4]" data-testid="import-center-page">
      <main className="mx-auto max-w-6xl px-4 sm:px-5 lg:px-6 py-6 space-y-5">
        {/* Page header — stays constant as the user switches types. */}
        <header className="flex items-start justify-between gap-4 pb-3 border-b border-[#e5e7eb]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-white border border-[#e2e8f0]">
              <Upload className="h-5 w-5 text-[#76B054]" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#111827] tracking-tight">Import Center</h1>
              <p className="text-xs text-[#4b5563] mt-0.5">
                Bring data into Syntraro — one wizard, three record types.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setLocation("/settings")}>
            Back to Settings
          </Button>
        </header>

        {/* Type selector — always visible so switching is one click. */}
        <TypeSelector active={activeType} onSelect={setType} />

        {/* Wizard body. Remount on type change so state resets cleanly. */}
        <div className="pt-2 border-t border-[#e2e8f0]">
          <ActiveTypeHeader type={active} />
          <ImportWizard key={active.key} config={active.config} variant="embedded" />
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type selector
// ---------------------------------------------------------------------------

function TypeSelector({
  active,
  onSelect,
}: {
  active: TypeKey;
  onSelect: (key: TypeKey) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap" role="tablist" aria-label="Import type">
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
            className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-md border text-xs font-semibold transition-colors ${
              isActive
                ? "bg-[#76B054] border-[#76B054] text-white"
                : "bg-white border-[#e2e8f0] text-[#4b5563] hover:border-[#76B054] hover:text-[#111827]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.tabLabel}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active-type header — shown above the embedded wizard body
// ---------------------------------------------------------------------------

function ActiveTypeHeader({ type }: { type: TypeDef }) {
  const Icon = type.icon;
  return (
    <div className="flex items-center gap-3 pt-4 pb-3">
      <div className="p-1.5 rounded-md bg-white border border-[#e2e8f0]">
        <Icon className="h-4 w-4 text-[#76B054]" />
      </div>
      <div>
        <div className="text-sm font-semibold text-[#111827]">{type.config.title}</div>
        <div className="text-xs text-[#4b5563] mt-0.5">{type.config.description}</div>
      </div>
    </div>
  );
}
