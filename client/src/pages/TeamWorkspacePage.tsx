// Team Workspace — canonical workforce hub at /team/*.
//
// Shell with four permission-gated tabs: Members, Schedules, Timesheets,
// Performance. Each tab embeds the existing page component with its header
// title suppressed so the workspace header is the single page title.
//
// Permission mapping (using existing catalog keys):
//   Members      → team.view
//   Schedules    → schedule.all.view
//   Timesheets   → time.all.view
//   Performance  → team.view
//
// /team (root) redirects to the first accessible tab once permissions load.
// Backend APIs still enforce their own gates — tab visibility is UI only.
import { lazy, Suspense, useMemo } from "react";
import { useLocation, useSearch, Link, Redirect } from "wouter";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useHasPermission } from "@/hooks/useEffectivePermissions";
import { TeamOverviewDashboard } from "@/components/team-hub/TeamOverviewDashboard";
import TeamHubPage from "./TeamHubPage";
import ShiftManagementPage from "./ShiftManagementPage";

const WeekStackPage = lazy(() => import("./timesheets/WeekStackPage"));
const PayrollPage = lazy(() => import("./PayrollPage"));

// ── Tab registry ─────────────────────────────────────────────────────────────

type TabId = "members" | "schedules" | "timesheets" | "performance";

const TABS: { id: TabId; label: string }[] = [
  { id: "members", label: "Members" },
  { id: "schedules", label: "Schedules" },
  { id: "timesheets", label: "Timesheets" },
  { id: "performance", label: "Performance" },
];

const VALID_TAB_IDS = new Set<string>(["members", "schedules", "timesheets", "performance"]);

function resolveActiveTab(path: string): TabId | null {
  const seg = path.split("/")[2];
  return VALID_TAB_IDS.has(seg) ? (seg as TabId) : null;
}

function tabPermitted(
  id: TabId,
  canMembers: boolean | undefined,
  canSchedules: boolean | undefined,
  canTimesheets: boolean | undefined,
): boolean | undefined {
  switch (id) {
    case "members":
    case "performance":
      return canMembers;
    case "schedules":
      return canSchedules;
    case "timesheets":
      return canTimesheets;
  }
}

// ── Workspace shell ──────────────────────────────────────────────────────────

export default function TeamWorkspacePage() {
  const [location, setLocation] = useLocation();
  const search = useSearch();

  const canMembers = useHasPermission("team.view");
  const canSchedules = useHasPermission("schedule.all.view");
  const canTimesheets = useHasPermission("time.all.view");

  const permLoading =
    canMembers === undefined || canSchedules === undefined || canTimesheets === undefined;

  const visibleTabs = useMemo(
    () =>
      TABS.filter(
        (t) => tabPermitted(t.id, canMembers, canSchedules, canTimesheets) !== false,
      ),
    [canMembers, canSchedules, canTimesheets],
  );

  const activeTab = resolveActiveTab(location);

  // Show spinner while permissions load (brief — cached after first fetch)
  if (permLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="team-workspace-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // /team root: redirect to the first accessible tab
  if (!activeTab) {
    if (visibleTabs.length === 0) return <AccessDenied />;
    return <Redirect to={`/team/${visibleTabs[0].id}`} />;
  }

  // Direct tab URL with no permission
  if (tabPermitted(activeTab, canMembers, canSchedules, canTimesheets) === false) {
    return <AccessDenied />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Workspace header */}
      <div className="px-4 md:px-6 pt-4 md:pt-6">
        <div className="mb-4">
          <h1
            className="text-2xl md:text-3xl font-bold"
            data-testid="team-workspace-title"
          >
            Team
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage members, schedules, timesheets, and workforce access.
          </p>
        </div>

        {/* Tab bar — only renders accessible tabs */}
        <div className="flex border-b border-slate-200" role="tablist">
          {visibleTabs.map((tab) => (
            <Link key={tab.id} href={`/team/${tab.id}`}>
              <a
                role="tab"
                aria-selected={activeTab === tab.id}
                data-testid={`team-tab-${tab.id}`}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer",
                  activeTab === tab.id
                    ? "border-brand text-brand"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-slate-300",
                )}
              >
                {tab.label}
              </a>
            </Link>
          ))}
        </div>
      </div>

      {/* Tab content — overflow-y-auto so WeekStackPage/TeamHubPage (natural-height) can
          scroll via this container; ShiftManagementPage (h-full flex-col) fills the
          fixed height and scrolls its grid internally. */}
      <div className="flex-1 overflow-y-auto" data-testid={`team-tab-content-${activeTab}`}>
        {activeTab === "members" && <TeamHubPage embedded />}
        {activeTab === "schedules" && <ShiftManagementPage embedded />}
        {activeTab === "timesheets" && (
          <TimesheetsTabContent basePath="/team/timesheets" search={search} />
        )}
        {activeTab === "performance" && (
          <PerformanceTabContent
            onSelectMember={(id) => setLocation(`/team/members?member=${id}`)}
          />
        )}
      </div>
    </div>
  );
}

// ── Tab content sub-components ───────────────────────────────────────────────

const LOADING_FALLBACK = (
  <div className="flex items-center justify-center py-24">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

function TimesheetsTabContent({ basePath, search }: { basePath: string; search: string }) {
  const params = new URLSearchParams(search);
  if (params.get("view") === "day") {
    return (
      <Suspense fallback={LOADING_FALLBACK}>
        <PayrollPage />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={LOADING_FALLBACK}>
      <WeekStackPage embedded basePath={basePath} />
    </Suspense>
  );
}

function PerformanceTabContent({ onSelectMember }: { onSelectMember: (id: string) => void }) {
  return (
    <div className="p-4 md:p-6">
      <TeamOverviewDashboard onSelectMember={onSelectMember} />
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="p-6" data-testid="team-workspace-access-denied">
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground text-center">
            You don't have permission to access the Team workspace.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
