import React, { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { BookOpen, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OperationalWorkspace } from "@/components/workspace/OperationalWorkspace";
import { OperationalWorkspaceHeader } from "@/components/workspace/OperationalWorkspaceHeader";
import {
  WorkspaceFilterBar,
  WorkspaceViewChip,
} from "@/components/workspace/WorkspaceFilterBar";
import { PriceBookCatalogTab } from "./price-book/PriceBookCatalogTab";
import { PriceBookKpiStrip } from "./price-book/PriceBookKpiStrip";
import { PriceBookBundlesTab } from "./price-book/PriceBookBundlesTab";
import { PriceBookCategoriesTab } from "./price-book/PriceBookCategoriesTab";
import { PriceBookItemRail } from "./price-book/PriceBookItemRail";
import { PriceBookBundleRail } from "./price-book/PriceBookBundleRail";
import { PriceBookServiceTemplatesTab } from "./price-book/PriceBookServiceTemplatesTab";
import { PriceBookServiceTemplateRail } from "./price-book/PriceBookServiceTemplateRail";
import type { Part } from "@/components/products-services/types";
import type { PricebookGroupSummaryDto } from "@/components/line-items/pricebookHelpers";
import type { ServiceTemplateDto } from "@/lib/serviceTemplates/serviceTemplateTypes";

// ─── View types ────────────────────────────────────────────────────────────────

type PriceBookView = "services" | "materials" | "bundles" | "categories" | "flat_rate_services";

function readView(search: string): PriceBookView {
  const v = new URLSearchParams(search).get("view");
  if (
    v === "services" ||
    v === "materials" ||
    v === "bundles" ||
    v === "categories" ||
    v === "flat_rate_services"
  )
    return v;
  return "services";
}

const ADD_LABELS: Record<PriceBookView, string> = {
  services: "New Service",
  materials: "New Material",
  bundles: "New Bundle",
  categories: "New Category",
  flat_rate_services: "New Template",
};

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PriceBookPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const activeView = readView(search);

  const [searchQuery, setSearchQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // Right rail: selected catalog item (Services or Materials), bundle, or service template
  const [selectedItem, setSelectedItem] = useState<Part | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<PricebookGroupSummaryDto | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ServiceTemplateDto | null>(null);

  const isCatalogView = activeView === "services" || activeView === "materials";
  const railExpanded =
    (selectedItem !== null && isCatalogView) ||
    (selectedBundle !== null && activeView === "bundles") ||
    (selectedTemplate !== null && activeView === "flat_rate_services");

  function navigate(view: PriceBookView) {
    const params = new URLSearchParams(search);
    if (view === "services") params.delete("view");
    else params.set("view", view);
    const qs = params.toString();
    setLocation(`/price-book${qs ? `?${qs}` : ""}`);
    setSearchQuery("");
    setSelectedItem(null);
    setSelectedBundle(null);
    setSelectedTemplate(null);
  }

  const centerContent = (
    <>
      <OperationalWorkspaceHeader
        icon={BookOpen}
        iconColor="text-emerald-600"
        iconBg="bg-emerald-50"
        title="Price Book"
        subtitle="Manage services, materials, bundles, and categories."
        search={
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              placeholder={
                activeView === "services" ? "Search services…"
                  : activeView === "materials" ? "Search materials…"
                  : activeView === "bundles" ? "Search bundles…"
                  : activeView === "flat_rate_services" ? "Search templates…"
                  : "Search categories…"
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-52 h-8 rounded-lg border-slate-200 bg-white text-sm"
              data-testid="input-search-pricebook"
            />
          </div>
        }
        primaryAction={
          <Button
            size="sm"
            className="rounded-lg px-3.5"
            onClick={() => setAddOpen(true)}
            data-testid="button-add-pricebook"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {ADD_LABELS[activeView]}
          </Button>
        }
        kpis={<PriceBookKpiStrip />}
        testId="pricebook-workspace-header"
      />

      {/* View filter bar */}
      <div className="shrink-0 px-4 py-2">
        <WorkspaceFilterBar variant="flat" data-testid="pricebook-filter-bar">
          <WorkspaceViewChip
            active={activeView === "services"}
            onClick={() => navigate("services")}
            data-testid="pricebook-view-services"
          >
            Services
          </WorkspaceViewChip>
          <WorkspaceViewChip
            active={activeView === "materials"}
            onClick={() => navigate("materials")}
            data-testid="pricebook-view-materials"
          >
            Materials
          </WorkspaceViewChip>
          <WorkspaceViewChip
            active={activeView === "bundles"}
            onClick={() => navigate("bundles")}
            data-testid="pricebook-view-bundles"
          >
            Bundles
          </WorkspaceViewChip>
          <WorkspaceViewChip
            active={activeView === "categories"}
            onClick={() => navigate("categories")}
            data-testid="pricebook-view-categories"
          >
            Categories
          </WorkspaceViewChip>
          <WorkspaceViewChip
            active={activeView === "flat_rate_services"}
            onClick={() => navigate("flat_rate_services")}
            data-testid="pricebook-view-flat-rate-services"
          >
            Flat-Rate Services
          </WorkspaceViewChip>
        </WorkspaceFilterBar>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeView === "services" && (
          <PriceBookCatalogTab
            typeFilter="service"
            searchQuery={searchQuery}
            addOpen={addOpen}
            onAddOpenChange={setAddOpen}
            selectedItemId={selectedItem?.id ?? null}
            onSelectedItemChange={setSelectedItem}
          />
        )}
        {activeView === "materials" && (
          <PriceBookCatalogTab
            typeFilter="product"
            searchQuery={searchQuery}
            addOpen={addOpen}
            onAddOpenChange={setAddOpen}
            selectedItemId={selectedItem?.id ?? null}
            onSelectedItemChange={setSelectedItem}
          />
        )}
        {activeView === "bundles" && (
          <PriceBookBundlesTab
            searchQuery={searchQuery}
            addOpen={addOpen}
            onAddOpenChange={setAddOpen}
            selectedBundleId={selectedBundle?.id ?? null}
            onSelectedBundleChange={setSelectedBundle}
          />
        )}
        {activeView === "categories" && (
          <PriceBookCategoriesTab
            searchQuery={searchQuery}
            addOpen={addOpen}
            onAddOpenChange={setAddOpen}
          />
        )}
        {activeView === "flat_rate_services" && (
          <PriceBookServiceTemplatesTab
            searchQuery={searchQuery}
            addOpen={addOpen}
            onAddOpenChange={setAddOpen}
            selectedTemplateId={selectedTemplate?.id ?? null}
            onSelectedTemplateChange={setSelectedTemplate}
          />
        )}
      </div>
    </>
  );

  // Rail node: catalog views use item rail, bundles view uses bundle rail, flat_rate_services uses template rail
  let railNode: React.ReactNode | undefined;
  if (isCatalogView) {
    railNode = selectedItem ? (
      <PriceBookItemRail
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onSaved={(updated) => setSelectedItem(updated)}
      />
    ) : (
      <></>
    );
  } else if (activeView === "bundles") {
    railNode = selectedBundle ? (
      <PriceBookBundleRail
        group={selectedBundle}
        onClose={() => setSelectedBundle(null)}
        onSaved={(updated) => setSelectedBundle(updated)}
      />
    ) : (
      <></>
    );
  } else if (activeView === "flat_rate_services") {
    railNode = selectedTemplate ? (
      <PriceBookServiceTemplateRail
        template={selectedTemplate}
        onClose={() => setSelectedTemplate(null)}
        onSaved={(updated) => setSelectedTemplate(updated)}
      />
    ) : (
      <></>
    );
  }

  return (
    <div className="h-full bg-app-bg overflow-hidden" data-testid="pricebook-workspace-page">
      <OperationalWorkspace
        center={centerContent}
        rightRailExpanded={railExpanded}
        rightRail={railNode}
        rightExpandedWidth={380}
        rightCollapsedWidth={0}
        rightRailClassName={cn(
          railExpanded && "border-l border-border shadow-[-8px_0_18px_rgba(15,23,42,0.06)]",
        )}
        showRailDivider={false}
        rightRailTestId="pricebook-item-rail"
        data-testid="pricebook-workspace"
      />
    </div>
  );
}
