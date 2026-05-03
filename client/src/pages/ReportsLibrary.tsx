import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REPORTS_LIBRARY,
  reportLinkFor,
  type LibraryCategory,
  type LibraryReport,
} from "@/lib/reportsLibrary";

// ---------------------------------------------------------------------------
// Reports Library page (2026-05-02)
//
// Central index of every renderable Reports section, grouped by category.
// Active rows deep-link to /reports?tab=<X>&section=<Y> (the Reports page
// reads those params, switches the active tab, and scrolls the section
// into view). Coming-soon rows are visibly disabled and do not navigate.
//
// No new metrics live here. The catalog (`@/lib/reportsLibrary`) lists
// the existing tab sections verbatim; this page is a router and a
// glossary, not a renderer.
// ---------------------------------------------------------------------------

function ReportRow({
  report,
  onSelect,
}: {
  report: LibraryReport;
  onSelect: (report: LibraryReport) => void;
}) {
  const isActive = report.status === "active";
  return (
    <button
      type="button"
      disabled={!isActive}
      onClick={isActive ? () => onSelect(report) : undefined}
      data-testid={`library-report-${report.id}`}
      data-status={report.status}
      aria-disabled={!isActive}
      className={cn(
        "w-full text-left rounded-md border bg-white dark:bg-gray-900 p-4 transition-colors",
        "border-[#e2e8f0] dark:border-gray-700",
        isActive && "hover:bg-muted hover:border-primary/30 cursor-pointer",
        !isActive && "opacity-60 cursor-not-allowed",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-semibold text-foreground"
              data-testid={`library-report-title-${report.id}`}
            >
              {report.title}
            </span>
            {!isActive && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-[0.04em]"
                data-testid={`library-report-coming-${report.id}`}
              >
                Coming soon
              </Badge>
            )}
          </div>
          <p
            className="text-xs text-muted-foreground mt-1"
            data-testid={`library-report-desc-${report.id}`}
          >
            {report.description}
          </p>
        </div>
        {isActive && (
          <ArrowRight
            className="h-4 w-4 text-muted-foreground shrink-0 mt-1"
            aria-hidden="true"
          />
        )}
      </div>
    </button>
  );
}

function CategoryCard({
  category,
  onSelect,
}: {
  category: LibraryCategory;
  onSelect: (report: LibraryReport) => void;
}) {
  const activeCount = category.reports.filter((r) => r.status === "active").length;
  return (
    <Card
      data-testid={`library-category-${category.id}`}
      className="overflow-hidden"
    >
      <CardHeader className="px-4 py-2.5 border-b">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span>{category.label}</span>
          <span
            className="text-xs font-normal text-muted-foreground tabular-nums"
            data-testid={`library-category-count-${category.id}`}
          >
            {activeCount} active · {category.reports.length} total
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-2">
        {category.reports.map((report) => (
          <ReportRow key={report.id} report={report} onSelect={onSelect} />
        ))}
      </CardContent>
    </Card>
  );
}

export default function ReportsLibrary() {
  const [, setLocation] = useLocation();

  const handleSelect = (report: LibraryReport) => {
    // `coming_soon` rows are non-interactive at the button level; the
    // guard here is a defense-in-depth in case a future caller bypasses
    // the disabled attribute.
    if (report.status !== "active") return;
    setLocation(reportLinkFor(report));
  };

  return (
    <div className="min-h-screen bg-background" data-testid="reports-library-page">
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <FileText className="h-7 w-7 text-primary" />
            <div>
              <h1
                className="text-2xl font-semibold"
                data-testid="reports-library-title"
              >
                All reports
              </h1>
              <p className="text-xs text-muted-foreground">
                Index of every report grouped by category. Active reports open
                the matching section in the Reports page.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/reports")}
            data-testid="library-back-to-reports"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Reports
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="reports-library-grid">
          {REPORTS_LIBRARY.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
