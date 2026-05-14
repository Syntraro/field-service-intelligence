/**
 * Import Center — canonical single page for every CSV import.
 *
 * 2026-04-22: Replaces the three legacy per-entity pages.
 * 2026-05-13: Landing screen refactored to a compact two-phase flow:
 *   Phase 1 — type selector (vertical card stack) + Next/Cancel footer.
 *   Phase 2 — StepIndicator + wizard body. Wizard's own source selector
 *              remains intact so provider presets (Jobber, etc.) can fire.
 *
 * Architecture:
 *   - Selected type lives in the `?type=…` query param so deep links +
 *     browser back/forward behave correctly. Missing/invalid → "clients".
 *   - `isConfirmed` local state gates the wizard; false = landing screen.
 *   - Type change while the wizard is active resets confirmation, returning
 *     the user to the landing with the new type pre-selected.
 *   - Wizard remounts on type change via `key={entity}` so all wizard state
 *     (CSV, mappings, preview, commit) resets cleanly.
 */

import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronRight, Upload, Users, Briefcase, Package, Receipt } from "lucide-react";
import { BRAND } from "@shared/branding";
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
// Entity catalog
// ---------------------------------------------------------------------------

const TYPE_KEYS = ["clients", "jobs", "products", "invoices"] as const;
type TypeKey = (typeof TYPE_KEYS)[number];

const DEFAULT_TYPE: TypeKey = "clients";

function isTypeKey(value: string | null): value is TypeKey {
  return value != null && (TYPE_KEYS as readonly string[]).includes(value);
}

interface TypeDef {
  key: TypeKey;
  label: string;
  description: string;
  icon: typeof Users;
  config: ImportWizardConfig;
}

// Display order: Clients → Jobs → Invoices → Price Book
const TYPES: TypeDef[] = [
  {
    key: "clients",
    label: "Clients",
    description: "Customer companies, locations, and contacts.",
    icon: Users,
    config: clientImportConfig,
  },
  {
    key: "jobs",
    label: "Jobs",
    description: "Past work orders and service history.",
    icon: Briefcase,
    config: jobImportConfig,
  },
  {
    key: "invoices",
    label: "Invoices",
    description: "Invoice history and balances.",
    icon: Receipt,
    config: invoiceImportConfig,
  },
  {
    key: "products",
    label: "Price Book",
    description: "Products and services for estimates and invoices.",
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

  // Phase 1 (false) = type selector + footer.
  // Phase 2 (true)  = wizard body.
  const [isConfirmed, setIsConfirmed] = useState(false);

  const setType = (key: TypeKey) => {
    // Changing type while wizard is active resets back to landing.
    setIsConfirmed(false);
    setLocation(`/settings/import?type=${key}`);
  };

  // Hoisted wizard step so StepIndicator can render above the wizard body.
  const [wizardStep, setWizardStep] = useState<Step>("upload");

  return (
    <div className="min-h-screen bg-app-bg" data-testid="import-center-page">
      <main className="mx-auto max-w-6xl px-4 sm:px-5 lg:px-6 py-6">

        {/* Page header — persistent across both phases. */}
        <header className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-white border border-[#e2e8f0]">
              <Upload className="h-5 w-5 text-[#76B054]" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#111827] tracking-tight">
                Import Center
              </h1>
              <p className="text-xs text-[#4b5563] mt-0.5">
                Bring your existing data into {BRAND.product} in a few steps.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/settings")}
          >
            Back to Settings
          </Button>
        </header>

        {!isConfirmed ? (
          /* ── Phase 1: type selector landing ─────────────────────────── */
          <div className="mx-auto max-w-xl">
            <TypeSelector active={activeType} onSelect={setType} />

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-[#e2e8f0]">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/settings")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => setIsConfirmed(true)}
                data-testid="import-next-button"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        ) : (
          /* ── Phase 2: wizard ─────────────────────────────────────────── */
          <div className="space-y-5">
            <section aria-label="Import progress">
              <StepIndicator step={wizardStep} />
            </section>

            <section aria-label="Import wizard">
              <ImportWizard
                key={active.key}
                config={active.config}
                variant="embedded"
                hideStepIndicator
                onStepChange={setWizardStep}
              />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type selector — compact vertical card stack
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
      className="flex flex-col gap-2"
      role="radiogroup"
      aria-label="Import type"
    >
      {TYPES.map((t) => {
        const isActive = t.key === active;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onSelect(t.key)}
            data-testid={`import-type-tab-${t.key}`}
            className={`group w-full flex items-center gap-3 text-left rounded-lg border-2 px-4 py-3 transition-all focus:outline-none focus:ring-2 focus:ring-[#76B054]/40 ${
              isActive
                ? "border-[#76B054] bg-white shadow-sm"
                : "border-[#e2e8f0] bg-white hover:border-[#76B054]/60 hover:shadow-sm"
            }`}
          >
            <div
              className={`shrink-0 p-1.5 rounded-md transition-colors ${
                isActive
                  ? "bg-[#76B054]"
                  : "bg-[#F0F5F0] group-hover:bg-[#76B054]/15"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${isActive ? "text-white" : "text-[#76B054]"}`}
              />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#111827]">
                {t.label}
              </div>
              <div className="text-xs text-[#4b5563] leading-snug mt-0.5">
                {t.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
