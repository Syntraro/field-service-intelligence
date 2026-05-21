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
//
// Invite / Add Member actions live here so they appear in the primary header
// band regardless of which sub-tab is active. TeamHubPage in embedded mode
// no longer renders its own action row.
import React, { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useLocation, useSearch, Link, Redirect } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  LockKeyhole,
  Mail,
  Plus,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHasPermission } from "@/hooks/useEffectivePermissions";
import { TeamOverviewDashboard } from "@/components/team-hub/TeamOverviewDashboard";
import { AddMemberDialog } from "@/components/team-hub/AddMemberDialog";
import { InviteMemberDialog } from "@/components/team-hub/InviteMemberDialog";
import TeamHubPage from "./TeamHubPage";
import ShiftManagementPage from "./ShiftManagementPage";
import type { TimesheetActions, TimesheetMeta } from "./timesheets/WeekStackPage";

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
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Imperative handles for tab-body actions hoisted into the header
  const shiftAddRef = useRef<(() => void) | null>(null);
  const timesheetActionsRef = useRef<TimesheetActions | null>(null);
  const [timesheetMeta, setTimesheetMeta] = useState<TimesheetMeta>({
    isApproved: false,
    hasTech: false,
    isPendingApproval: false,
  });

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
      {/* Elevated header card — title, actions, and tab bar unified in one surface.
          Matches the OperationalWorkspaceHeader shadow/border treatment; tabs attach
          to the card bottom so nothing floats on the raw page background. */}
      <div className="shrink-0 px-4 md:px-6 pt-4 md:pt-5">
        <div className="bg-white rounded-md border border-slate-100 shadow-[0_1px_8px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] overflow-hidden">

          {/* Title row — workspace identity + primary actions */}
          <div className="px-5 pt-4 pb-0 flex items-center justify-between gap-4">
            <div>
              <h1
                className="text-title text-slate-900"
                data-testid="team-workspace-title"
              >
                Team
              </h1>
              <p className="text-helper text-muted-foreground mt-0.5">
                Manage members, schedules, timesheets, and workforce access.
              </p>
            </div>
            {/* Header actions — rendered per active tab */}
            <div className="flex items-center gap-2 shrink-0">
              {activeTab === "members" && canMembers && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setInviteOpen(true)}
                    data-testid="button-team-invite"
                  >
                    <Mail className="h-3.5 w-3.5 mr-1.5" />
                    Invite
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setAddOpen(true)}
                    data-testid="button-team-add-member"
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                    Add Member
                  </Button>
                </>
              )}
              {activeTab === "schedules" && canSchedules && (
                <Button
                  size="sm"
                  onClick={() => shiftAddRef.current?.()}
                  data-testid="button-team-add-shift"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Shift
                </Button>
              )}
              {activeTab === "timesheets" && canTimesheets && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation("/reports/timesheets")}
                    data-testid="button-team-timesheet-reports"
                  >
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Reports
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => timesheetActionsRef.current?.exportCsv()}
                    data-testid="button-team-timesheet-export"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export
                  </Button>
                  {timesheetMeta.isApproved ? (
                    <Badge
                      variant="outline"
                      className="bg-green-50 text-green-700 border-green-200 h-8 px-3 text-xs"
                    >
                      <LockKeyhole className="h-3 w-3 mr-1" />
                      Approved
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => timesheetActionsRef.current?.approve()}
                      disabled={timesheetMeta.isPendingApproval || !timesheetMeta.hasTech}
                      data-testid="button-team-approve-week"
                    >
                      {timesheetMeta.isPendingApproval ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Approve Week
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => timesheetActionsRef.current?.addEntry()}
                    disabled={!timesheetMeta.hasTech}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 hover:border-emerald-700"
                    data-testid="button-team-add-entry"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add Entry
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Tab bar — inside the card, faint separator from title row */}
          <div className="flex border-t border-slate-100 mt-3 px-5" role="tablist">
            {visibleTabs.map((tab) => (
              <Link key={tab.id} href={`/team/${tab.id}`}>
                <a
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  data-testid={`team-tab-${tab.id}`}
                  className={cn(
                    "px-1 mr-5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer inline-block",
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
      </div>

      {/* Tab content — overflow-y-auto so WeekStackPage/TeamHubPage (natural-height) can
          scroll via this container; ShiftManagementPage (h-full flex-col) fills the
          fixed height and scrolls its grid internally. */}
      <div className="flex-1 overflow-y-auto" data-testid={`team-tab-content-${activeTab}`}>
        {activeTab === "members" && <TeamHubPage embedded />}
        {activeTab === "schedules" && (
          <ShiftManagementPage embedded addShiftRef={shiftAddRef} />
        )}
        {activeTab === "timesheets" && (
          <TimesheetsTabContent
            basePath="/team/timesheets"
            search={search}
            actionsRef={timesheetActionsRef}
            onMetaChange={setTimesheetMeta}
          />
        )}
        {activeTab === "performance" && (
          <PerformanceTabContent
            onSelectMember={(id) => setLocation(`/team/members?member=${id}`)}
          />
        )}
      </div>

      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} />
      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

// ── Tab content sub-components ───────────────────────────────────────────────

const LOADING_FALLBACK = (
  <div className="flex items-center justify-center py-24">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

function TimesheetsTabContent({
  basePath,
  search,
  actionsRef,
  onMetaChange,
}: {
  basePath: string;
  search: string;
  actionsRef: React.MutableRefObject<TimesheetActions | null>;
  onMetaChange: (meta: TimesheetMeta) => void;
}) {
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
      <WeekStackPage embedded basePath={basePath} actionsRef={actionsRef} onMetaChange={onMetaChange} />
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
