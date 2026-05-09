/**
 * createMenuConfig — canonical shared create-action descriptor array (2026-05-09).
 *
 * Single source of truth for the "+ Create" dropdown menu that appears in
 * both the top-header icon button and the sidebar nav action. Both callsites
 * call `makeCreateMenuItems` with their local callbacks and pass the resulting
 * array to `<ActionMenu items={...}>`.
 *
 * Menu order (approved design, 2026-05-09):
 *   1. New Job           — opens CreateNewDialog at "job" tab
 *   2. New Lead          — navigates to /leads/new
 *   3. New Client        — opens CreateClientModal
 *   4. New Quote         — navigates to /quotes/new
 *   5. New Invoice       — navigates to /invoices/new
 *   6. New Service Plan  — opens CreateMaintenancePlanDialog
 *   7. New Task          — opens CreateNewDialog at "task" tab
 *
 * Items 3 (Client) and 6 (Service Plan) are conditionally hidden when the
 * corresponding callback is not provided — ActionMenu filters hidden items.
 */

import {
  ClipboardList,
  UserPlus,
  Users,
  FileText,
  Receipt,
  Wrench,
  CheckSquare,
} from "lucide-react";
import type { ActionMenuItemDescriptor } from "@/components/ui/action-menu";
import type { CreateNewTab } from "@/components/CreateNewDialog";

export interface CreateMenuCallbacks {
  /** Opens CreateNewDialog at the specified tab (job | task). */
  openCreate: (tab: CreateNewTab) => void;
  /** Opens CreateClientModal. Item is hidden when absent. */
  openAddClient?: () => void;
  /** Opens CreateMaintenancePlanDialog. Item is hidden when absent. */
  openCreatePm?: () => void;
  /** Navigate to a route — pass `setLocation` from wouter. */
  navigate: (to: string) => void;
}

export function makeCreateMenuItems(cb: CreateMenuCallbacks): ActionMenuItemDescriptor[] {
  return [
    {
      id: "job",
      label: "Job",
      icon: ClipboardList,
      onSelect: () => cb.openCreate("job"),
      testId: "quick-new-job",
    },
    {
      id: "lead",
      label: "Lead",
      icon: UserPlus,
      onSelect: () => cb.navigate("/leads/new"),
      testId: "quick-new-lead",
    },
    {
      id: "client",
      label: "Client",
      icon: Users,
      hidden: !cb.openAddClient,
      onSelect: () => cb.openAddClient?.(),
      testId: "quick-new-client",
    },
    {
      id: "quote",
      label: "Quote",
      icon: FileText,
      onSelect: () => cb.navigate("/quotes/new"),
      testId: "quick-new-quote",
    },
    {
      id: "invoice",
      label: "Invoice",
      icon: Receipt,
      onSelect: () => cb.navigate("/invoices/new"),
      testId: "quick-new-invoice",
    },
    {
      id: "pm",
      label: "Service Plan",
      icon: Wrench,
      hidden: !cb.openCreatePm,
      onSelect: () => cb.openCreatePm?.(),
      testId: "quick-new-pm",
    },
    {
      id: "task",
      label: "Task",
      icon: CheckSquare,
      onSelect: () => cb.openCreate("task"),
      testId: "quick-new-task",
    },
  ];
}
