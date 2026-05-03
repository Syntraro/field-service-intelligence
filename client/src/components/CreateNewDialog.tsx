/**
 * CreateNewDialog — single canonical "+ New" entry point.
 *
 * 2026-04-25 redesign: replaces the separate `QuickAddJobDialog` and
 * `TaskDialog` mounts in the app shell + dispatch quick-create with one
 * compact tabbed modal (Job / Task). Each tab embeds the EXISTING
 * canonical create dialog body in `embedded` mode — no parallel forms,
 * no duplicate selectors, no new APIs.
 *
 *   Tab "job"  → <QuickAddJobDialog embedded compact />
 *   Tab "task" → <TaskDialog embedded forcedType="GENERAL" />
 *
 * 2026-05-01: the "Supplier Visit" tab was merged into the Task tab.
 * Inside Task, an inline "+ Add supplier visit" expandable surfaces
 * the supplier / location / PO fields and flips the underlying Task
 * `type` to `"SUPPLIER_VISIT"` — the existing TaskDialog mutation
 * branch already handles the supplier-visit attachment via
 * `PATCH /api/tasks/{id}/supplier-visit` based on type. No backend or
 * mutation changes. The legacy `"supplier-visit"` value is preserved on
 * `CreateNewTab` for backward-compatibility with existing callers
 * (e.g. dispatch quick-create routes); it now silently maps to the
 * Task tab.
 *
 * Each embedded body owns its own sticky footer (Cancel + primary action)
 * because the primary label varies by tab and submission state, and the
 * mutations live in the body. The shell only owns the title strip + tabs.
 *
 * Tab state is preserved while the modal is open; on close, all state
 * resets via the per-body `useEffect(open)` cleanup.
 */
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { TaskDialog } from "@/components/TaskDialog";

/**
 * Public tab id type. Legacy `"supplier-visit"` value is preserved so
 * existing callers compile cleanly; it maps to the Task tab now.
 */
export type CreateNewTab = "job" | "task" | "supplier-visit";

export interface CreateNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial selected tab. The user can switch tabs while the modal is open. */
  defaultTab?: CreateNewTab;
  /** Job-tab prefill (dispatch slot quick-create: tech + date + time + duration). */
  jobInitialSchedule?: {
    date?: Date | string;
    time?: string;
    durationMinutes?: number;
    assignedTechnicianIds?: string[];
  };
  /** Job-tab location prefill (e.g., ClientDetailPage opens scoped to the
   * currently-viewed client/location). Mirrors `QuickAddJobDialog`'s
   * existing `preselectedLocationId` prop one-for-one. */
  jobPreselectedLocationId?: string;
  /** 2026-05-02 — "Create Similar Job" entry point. When set, the Job
   * tab's `QuickAddJobDialog` fetches the source job and prefills its
   * safe identity fields (location, summary, description). Schedule
   * and team are intentionally NOT cloned. Pass-through prop only. */
  jobInitialCloneFromJobId?: string;
  /** Task / Supplier-Visit tab prefill (dispatch slot quick-create). */
  taskInitialData?: {
    assignedToUserId?: string;
    startDate?: string;
    startTime?: string;
  };
  /** Optional: surface-specific side-effects after a successful create. */
  onJobCreated?: () => void;
  onTaskChanged?: () => void;
}

/**
 * Brand green active-tab styling. Matches the +New header button and the
 * Today's Operations card so the active tab feels at home in the app shell.
 *
 * 2026-04-30 (compact pass): tighter typography + padding so the tab strip
 * matches the form body's `text-xs` / `h-8` rhythm. The shadcn TabsTrigger
 * base classes (`px-3 py-1.5 text-sm font-medium`) get overridden by the
 * `text-xs py-1 px-2 gap-1` here via tw-merge.
 */
const TAB_TRIGGER_CLASS =
  "data-[state=active]:bg-[#76B054] data-[state=active]:text-white data-[state=active]:shadow-sm text-xs py-1 px-2 gap-1";

export function CreateNewDialog({
  open,
  onOpenChange,
  defaultTab = "job",
  jobInitialSchedule,
  jobPreselectedLocationId,
  jobInitialCloneFromJobId,
  taskInitialData,
  onJobCreated,
  onTaskChanged,
}: CreateNewDialogProps) {
  // 2026-05-01 — supplier-visit tab merged into Task. Legacy callers
  // passing `defaultTab="supplier-visit"` are silently mapped to the
  // Task tab here so existing dispatch quick-create routes still work.
  // The user gets the merged Task form with the supplier-visit panel
  // already expanded inline (TaskDialog reads the pre-existing
  // `forcedType="GENERAL"` plus its internal expand state).
  const normalizedDefaultTab: "job" | "task" =
    defaultTab === "supplier-visit" ? "task" : defaultTab;
  const [tab, setTab] = useState<"job" | "task">(normalizedDefaultTab);

  // Re-sync the tab when the modal is (re-)opened. Without this, switching
  // entry points (e.g. "+New → Task" then later "+New → Job") would land
  // on the previously-selected tab instead of the caller's defaultTab.
  useEffect(() => {
    if (open) setTab(normalizedDefaultTab);
  }, [open, normalizedDefaultTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 2026-04-26 polish v4: header copy removed (Create New / subtitle).
          Tabs are the first real content. Modal pin reduced because the
          freed vertical lets the Job tab fit at common desktop heights
          (≈ 720+) without the embedded form scrolling internally. The
          shadcn DialogContent still renders the absolute-positioned close
          X at top-right; we keep the accessible DialogTitle visually
          hidden via `sr-only` so Radix's a11y check stays happy. */}
      <DialogContent
        className="max-w-xl sm:max-w-[600px] h-auto max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid="dialog-create-new"
      >
        <DialogHeader className="sr-only">
          <DialogTitle data-testid="text-create-new-title">Create New</DialogTitle>
          <DialogDescription>Choose what you'd like to create.</DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "job" | "task")}
          className="flex-1 min-h-0 flex flex-col"
        >
          {/* Tab strip: tight padding, right-padded so it doesn't touch the
              shadcn close X (positioned absolute at right-4 top-4).
              2026-04-30 (compact pass): `h-8 p-0.5` overrides the
              primitive's `h-10` outer; trigger icons drop from
              `h-3.5 w-3.5` → `h-3 w-3` so they match the body's row icons.
              2026-05-01: Supplier Visit tab removed (merged into Task);
              grid is now 2-col. */}
          <div className="px-4 pt-2.5 pb-1.5 pr-12 shrink-0">
            <TabsList className="grid grid-cols-2 w-full bg-slate-100 h-8 p-0.5">
              <TabsTrigger value="job" className={cn(TAB_TRIGGER_CLASS)} data-testid="tab-job">
                <ClipboardList className="h-3 w-3" />
                Job
              </TabsTrigger>
              <TabsTrigger value="task" className={cn(TAB_TRIGGER_CLASS)} data-testid="tab-task">
                <CheckSquare className="h-3 w-3" />
                Task
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Each TabsContent owns its embedded body. Bodies stay mounted
              when the user switches tabs (Radix Tabs unmounts inactive
              content by default — we use `forceMount` to keep state). */}
          <TabsContent
            value="job"
            forceMount
            className={cn(
              "mt-0 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden",
            )}
            data-testid="content-job"
          >
            {/* 2026-04-25 — pass `open` (not `open && tab===...`) so that
                switching tabs does NOT trigger the body's `useEffect(open)`
                reset path. Each tab's form state persists while the modal
                is open, per spec. The Dialog wrapper is gone in embedded
                mode, so `open` here only drives data-fetch enable + close
                cleanup, not visibility. */}
            <QuickAddJobDialog
              open={open}
              onOpenChange={onOpenChange}
              embedded
              compact
              preselectedLocationId={jobPreselectedLocationId}
              initialSchedule={jobInitialSchedule}
              cloneFromJobId={jobInitialCloneFromJobId}
              onSuccess={onJobCreated}
            />
          </TabsContent>

          <TabsContent
            value="task"
            forceMount
            className={cn(
              "mt-0 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden",
            )}
            data-testid="content-task"
          >
            <TaskDialog
              open={open}
              onOpenChange={onOpenChange}
              embedded
              forcedType="GENERAL"
              initialData={taskInitialData}
              onChanged={onTaskChanged}
            />
          </TabsContent>

          {/* 2026-05-01 — The previous third <TabsContent value="supplier-visit">
              that mounted <TaskDialog forcedType="SUPPLIER_VISIT" /> was
              removed. Supplier-visit creation is now an inline expandable
              section inside the Task tab body (see TaskDialog embedded
              "+ Add supplier visit" affordance). The underlying TaskDialog
              still supports `forcedType="SUPPLIER_VISIT"` for any
              non-embedded callers that may need it. */}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
