import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  ClipboardList,
  MapPin,
  Package,
  UserX,
} from "lucide-react";
import type { PartsForecastResponse } from "@shared/reports/partsForecast";

// ---------------------------------------------------------------------------
// Reports → Parts Forecast deep-report (`/reports/parts-forecast`)
// Standalone forward-looking page. Forecasts parts demand for the next
// 30 days by joining scheduled `job_visits` (jobType='maintenance')
// to active `location_pm_part_templates`. Per the spec, visits are
// NOT deduplicated by location — a location with 2 PM visits in
// window contributes its template parts twice.
// ---------------------------------------------------------------------------

type RangeKey = "next_30_days";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string; disabled?: boolean }> = [
  { value: "next_30_days", label: "Next 30 days" },
];

// ---------------------------------------------------------------------------
// SectionCard / SectionEmpty — same primitives as the other deep-reports
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  icon: Icon,
  testId,
  children,
}: {
  title: string;
  icon: React.ElementType;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden" data-testid={testId}>
      <CardHeader className="px-4 py-2.5 border-b">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

function SectionEmpty({ testId }: { testId: string }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
      Not enough data yet
    </p>
  );
}

// ---------------------------------------------------------------------------
// KPI strip — forward-looking forecast has NO comparison windows, so
// the tile is a simple label/value pair (no MetricCard / ComparisonRow).
// ---------------------------------------------------------------------------

function ForecastKPITile({
  label,
  value,
  testId,
  formatter,
}: {
  label: string;
  value: number;
  testId: string;
  formatter?: (n: number) => string;
}) {
  return (
    <div
      className="rounded-md border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-col gap-2 min-h-[100px]"
      data-testid={testId}
    >
      <div className="text-xs uppercase tracking-[0.04em] text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">
        {formatter ? formatter(value) : value.toLocaleString()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parts needed — grouped-by-product list with relative bar
// ---------------------------------------------------------------------------

function PartsNeededCard({
  section,
}: {
  section: PartsForecastResponse["partsNeeded"];
}) {
  const max = section.items.reduce((m, r) => Math.max(m, r.totalQuantity), 0);
  return (
    <SectionCard
      title="Parts needed"
      icon={Boxes}
      testId="parts-forecast-section-parts-needed"
    >
      {!section.hasData ? (
        <SectionEmpty testId="parts-forecast-section-parts-needed" />
      ) : (
        <ul
          className="divide-y divide-[#e2e8f0] dark:divide-gray-700"
          data-testid="parts-forecast-parts-needed-list"
        >
          {section.items.map((row, idx) => (
            <li
              key={row.productId}
              className="space-y-1 py-2"
              data-testid={`parts-forecast-needed-row-${row.productId}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground tabular-nums w-5 text-right">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {row.itemName}
                    </div>
                    {(row.itemSku || row.itemCategory) && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {row.itemSku && <span>SKU {row.itemSku}</span>}
                        {row.itemSku && row.itemCategory && <span> · </span>}
                        {row.itemCategory && <span>{row.itemCategory}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <span className="text-xs font-semibold tabular-nums whitespace-nowrap">
                  {row.totalQuantity.toLocaleString()} ×
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded">
                <div
                  className="h-full bg-sky-500/70 rounded"
                  style={{
                    width: `${
                      max > 0 ? (row.totalQuantity / max) * 100 : 0
                    }%`,
                  }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {row.locationCount.toLocaleString()} location
                {row.locationCount === 1 ? "" : "s"} ·{" "}
                {row.visitCount.toLocaleString()} PM visit
                {row.visitCount === 1 ? "" : "s"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Parts by location — per-visit roll-up
// ---------------------------------------------------------------------------

function PartsByLocationCard({
  section,
}: {
  section: PartsForecastResponse["partsByLocation"];
}) {
  return (
    <SectionCard
      title="Parts by location & visit"
      icon={MapPin}
      testId="parts-forecast-section-parts-by-location"
    >
      {!section.hasData ? (
        <SectionEmpty testId="parts-forecast-section-parts-by-location" />
      ) : (
        <ul
          className="divide-y divide-[#e2e8f0] dark:divide-gray-700"
          data-testid="parts-forecast-parts-by-location-list"
        >
          {section.items.map((visit) => (
            <li
              key={visit.visitId}
              className="space-y-2 py-3"
              data-testid={`parts-forecast-visit-${visit.visitId}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {visit.customerName ?? visit.locationName}
                  </div>
                  {visit.customerName && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {visit.locationName}
                    </div>
                  )}
                </div>
                <span className="text-xs font-semibold tabular-nums text-primary whitespace-nowrap">
                  {format(new Date(visit.scheduledAtISO), "MMM d, yyyy h:mm a")}
                </span>
              </div>
              <ul className="ml-2 space-y-0.5">
                {visit.parts.map((p) => (
                  <li
                    key={p.productId}
                    className="text-xs flex items-center justify-between gap-3"
                  >
                    <span className="truncate text-foreground/80">{p.itemName}</span>
                    <span className="font-medium tabular-nums whitespace-nowrap">
                      {p.quantity.toLocaleString()} ×
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Parts by technician — ALWAYS inert (multi-tech array, no per-tech split)
// ---------------------------------------------------------------------------

function PartsByTechnicianCard({
  section,
}: {
  section: PartsForecastResponse["partsByTechnician"];
}) {
  return (
    <SectionCard
      title="Parts by technician"
      icon={UserX}
      testId="parts-forecast-section-parts-by-technician"
    >
      {!section.hasData ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="parts-forecast-section-parts-by-technician-disabled"
        >
          {section.reason}
        </p>
      ) : (
        <SectionEmpty testId="parts-forecast-section-parts-by-technician" />
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Missing parts data — visits scheduled, but no template configured
// ---------------------------------------------------------------------------

function MissingPartsCard({
  section,
}: {
  section: PartsForecastResponse["missingPartsData"];
}) {
  return (
    <SectionCard
      title="Missing parts data"
      icon={AlertTriangle}
      testId="parts-forecast-section-missing-parts"
    >
      {!section.hasData ? (
        <SectionEmpty testId="parts-forecast-section-missing-parts" />
      ) : (
        <ul
          className="divide-y divide-[#e2e8f0] dark:divide-gray-700"
          data-testid="parts-forecast-missing-parts-list"
        >
          {section.items.map((row) => (
            <li
              key={row.visitId}
              className="flex items-center justify-between gap-3 py-2 text-xs"
              data-testid={`parts-forecast-missing-row-${row.visitId}`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {row.customerName ?? row.locationName}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {row.customerName && <>{row.locationName} · </>}
                  {row.jobRef}
                </div>
              </div>
              <span className="font-semibold tabular-nums text-amber-600 whitespace-nowrap">
                {format(new Date(row.scheduledAtISO), "MMM d, h:mm a")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Ordering list — slim copy/paste shape
// ---------------------------------------------------------------------------

function OrderingListCard({
  section,
}: {
  section: PartsForecastResponse["orderingList"];
}) {
  return (
    <SectionCard
      title="Export-ready ordering list"
      icon={ClipboardList}
      testId="parts-forecast-section-ordering-list"
    >
      {!section.hasData ? (
        <SectionEmpty testId="parts-forecast-section-ordering-list" />
      ) : (
        <ul
          className="divide-y divide-[#e2e8f0] dark:divide-gray-700"
          data-testid="parts-forecast-ordering-list"
        >
          {section.items.map((row) => (
            <li
              key={row.productId}
              className="grid grid-cols-12 gap-2 py-1.5 text-xs items-center"
              data-testid={`parts-forecast-order-row-${row.productId}`}
            >
              <span className="col-span-6 truncate font-medium">
                {row.itemName}
              </span>
              <span className="col-span-3 text-muted-foreground truncate">
                {row.itemSku ?? row.itemCategory ?? "—"}
              </span>
              <span className="col-span-2 text-right tabular-nums font-semibold">
                {row.totalQuantity.toLocaleString()}
              </span>
              <span className="col-span-1 text-right tabular-nums text-muted-foreground">
                {row.locationCount.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPartsForecast() {
  const [, setLocation] = useLocation();
  const [range, setRange] = useState<RangeKey>("next_30_days");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("range");
    if (r === "next_30_days") setRange(r);
  }, []);

  const { data, isLoading, isError } = useQuery<PartsForecastResponse>({
    queryKey: ["/api/reports/parts-forecast", range],
    queryFn: () =>
      apiRequest<PartsForecastResponse>(
        `/api/reports/parts-forecast?range=${range}`,
      ),
    staleTime: 60_000,
  });

  return (
    <div
      className="min-h-screen bg-background"
      data-testid="reports-parts-forecast-page"
    >
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Package className="h-7 w-7 text-primary" />
            <div>
              <h1
                className="text-2xl font-semibold"
                data-testid="reports-parts-forecast-title"
              >
                Parts Forecast
              </h1>
              <p className="text-xs text-muted-foreground">
                Forecast parts required for upcoming PM visits — sourced from
                location parts templates only.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/reports")}
              data-testid="parts-forecast-back-to-reports"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Reports
            </Button>
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger
                className="w-44"
                data-testid="select-parts-forecast-range"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.disabled}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-8">
              <p className="text-sm text-muted-foreground text-center">
                Loading parts forecast…
              </p>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          // Full-page error ONLY on a true API error. Per-section
          // empty states inline for partial-data tenants.
          <Card data-testid="parts-forecast-error">
            <CardContent className="p-8">
              <p className="text-sm text-muted-foreground text-center">
                We couldn't load the parts forecast. Try refreshing in a moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6" data-testid="parts-forecast-body">
            <SectionCard
              title="Forecast summary"
              icon={Package}
              testId="parts-forecast-section-kpis"
            >
              {!data.kpis.hasData ? (
                <SectionEmpty testId="parts-forecast-section-kpis" />
              ) : (
                <div
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3"
                  data-testid="parts-forecast-kpis-grid"
                >
                  <ForecastKPITile
                    label="Total parts required"
                    value={data.kpis.totalPartsRequired}
                    testId="parts-forecast-kpi-total-parts-required"
                  />
                  <ForecastKPITile
                    label="Unique part types"
                    value={data.kpis.uniquePartTypes}
                    testId="parts-forecast-kpi-unique-part-types"
                  />
                  <ForecastKPITile
                    label="Locations requiring parts"
                    value={data.kpis.locationsRequiringParts}
                    testId="parts-forecast-kpi-locations-requiring-parts"
                  />
                  <ForecastKPITile
                    label="PM visits requiring parts"
                    value={data.kpis.pmVisitsRequiringParts}
                    testId="parts-forecast-kpi-pm-visits-requiring-parts"
                  />
                </div>
              )}
            </SectionCard>
            <PartsNeededCard section={data.partsNeeded} />
            <PartsByLocationCard section={data.partsByLocation} />
            <MissingPartsCard section={data.missingPartsData} />
            <PartsByTechnicianCard section={data.partsByTechnician} />
            <OrderingListCard section={data.orderingList} />
          </div>
        )}
      </main>
    </div>
  );
}
