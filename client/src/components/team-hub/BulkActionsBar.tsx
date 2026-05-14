// 2026-04-20 Phase 4: bulk actions bar.
// Floats above the Members table when rows are selected. Each action runs as a
// fan-out of canonical per-user mutations via Promise.allSettled so partial
// failures (e.g. role hierarchy guard rejects an admin downgrade) are reported
// honestly instead of being hidden by an aggregate "success" toast.
//
// Backend: no bulk endpoints exist. All operations call existing
// /api/team/:userId/{activate|deactivate} and PATCH /api/team/:userId routes.
// All server-side guards (role hierarchy, last-owner protection) still apply
// on a per-user basis.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Power, PowerOff, Shield, Calendar, X, Loader2 } from "lucide-react";
import type { Role, TeamMemberRow } from "./types";

interface Props {
  selectedIds: string[];
  members: TeamMemberRow[];
  onClear: () => void;
}

type BulkResult = { id: string; ok: boolean; error?: string };

async function runFanOut(
  ids: string[],
  fn: (id: string) => Promise<unknown>,
): Promise<BulkResult[]> {
  // Promise.allSettled keeps every per-user call independent — one server-side
  // guard rejection (e.g. last-owner protection) doesn't poison the others.
  const settled = await Promise.allSettled(ids.map(async (id) => fn(id).then(() => id)));
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return { id: ids[i], ok: true };
    const err = s.reason as any;
    return { id: ids[i], ok: false, error: err?.message ?? String(err) };
  });
}

const invalidateAfterBulk = () => {
  queryClient.invalidateQueries({ queryKey: ["/api/team"] });
  queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
  queryClient.invalidateQueries({
    queryKey: ["/api/team/technicians/working-hours"],
    exact: false,
  });
};

export function BulkActionsBar({ selectedIds, members, onClear }: Props) {
  const { toast } = useToast();
  const { data: roles = [] } = useQuery<Role[]>({ queryKey: ["/api/roles"] });
  const [pendingAction, setPendingAction] = useState<
    "activate" | "deactivate" | "role" | "company-hours" | null
  >(null);
  const [pickedRoleId, setPickedRoleId] = useState<string>("");

  const selectedMembers = members.filter((m) => selectedIds.includes(m.id));
  const count = selectedIds.length;
  if (count === 0) return null;

  const reportAndInvalidate = (label: string, results: BulkResult[]) => {
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    invalidateAfterBulk();
    if (fail === 0) {
      toast({ title: `${label} ${ok} member${ok === 1 ? "" : "s"}` });
    } else if (ok === 0) {
      const sample = results.find((r) => !r.ok)?.error || "Unknown error";
      toast({
        variant: "destructive",
        title: `${label} failed`,
        description: `${fail} of ${results.length} rejected — ${sample}`,
      });
    } else {
      const sample = results.find((r) => !r.ok)?.error || "see audit log";
      toast({
        variant: "destructive",
        title: `${label} partial`,
        description: `${ok} succeeded, ${fail} failed — ${sample}`,
      });
    }
    onClear();
    setPendingAction(null);
  };

  const bulkActivate = useMutation({
    mutationFn: () =>
      runFanOut(selectedIds, (id) =>
        apiRequest(`/api/team/${id}/activate`, { method: "POST" })
      ),
    onSuccess: (results) => reportAndInvalidate("Enabled", results),
    onError: (err: any) =>
      toast({ variant: "destructive", title: "Bulk enable failed", description: err?.message }),
  });

  const bulkDeactivate = useMutation({
    mutationFn: () =>
      runFanOut(selectedIds, (id) =>
        apiRequest(`/api/team/${id}/deactivate`, { method: "POST" })
      ),
    onSuccess: (results) => reportAndInvalidate("Disabled", results),
    onError: (err: any) =>
      toast({ variant: "destructive", title: "Bulk disable failed", description: err?.message }),
  });

  // For role change: PATCH /api/team/:userId requires the existing field set so
  // we don't accidentally clear them. We only have list-level data here, so we
  // PATCH only roleId (server schema treats other fields as optional).
  const bulkRoleChange = useMutation({
    mutationFn: () =>
      runFanOut(selectedIds, (id) =>
        apiRequest(`/api/team/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ roleId: pickedRoleId }),
        })
      ),
    onSuccess: (results) => {
      const r = roles.find((x) => x.id === pickedRoleId);
      reportAndInvalidate(`Set role "${r?.displayName ?? "?"}" on`, results);
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: "Bulk role change failed", description: err?.message }),
  });

  // Reverts selected members to inheriting company hours. Safe — does not
  // touch their stored working_hours rows; just flips useCustomSchedule=false.
  const bulkCompanyHours = useMutation({
    mutationFn: () =>
      runFanOut(selectedIds, (id) => {
        const m = members.find((x) => x.id === id);
        return apiRequest(`/api/team/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            useCustomSchedule: false,
            // Server schema requires keeping isSchedulable explicit so we don't
            // accidentally toggle it. Use the current value from the list.
            isSchedulable: !m?.disabled,
          }),
        });
      }),
    onSuccess: (results) => reportAndInvalidate("Reverted to company hours for", results),
    onError: (err: any) =>
      toast({ variant: "destructive", title: "Bulk schedule revert failed", description: err?.message }),
  });

  const isRunning =
    bulkActivate.isPending ||
    bulkDeactivate.isPending ||
    bulkRoleChange.isPending ||
    bulkCompanyHours.isPending;

  const actionLabel = (() => {
    switch (pendingAction) {
      case "activate":
        return "Enable";
      case "deactivate":
        return "Disable";
      case "company-hours":
        return "Revert to company hours";
      case "role":
        return "Change role";
      default:
        return "";
    }
  })();

  const confirmText = (() => {
    switch (pendingAction) {
      case "deactivate":
        return `Disable ${count} member${count === 1 ? "" : "s"}? They will be unable to log in until re-enabled. Server-side guards (last owner / last admin) may reject some of them.`;
      case "activate":
        return `Re-enable ${count} member${count === 1 ? "" : "s"}?`;
      case "company-hours":
        return `Revert ${count} member${count === 1 ? "" : "s"} to inheriting company business hours? Their saved custom hours are kept on file but ignored until "Use custom schedule" is re-enabled.`;
      case "role":
        return `Set role to "${roles.find((r) => r.id === pickedRoleId)?.displayName ?? "?"}" for ${count} member${count === 1 ? "" : "s"}? Server-side role-hierarchy guard may reject changes you cannot perform from your own role.`;
      default:
        return "";
    }
  })();

  const runPending = () => {
    if (pendingAction === "activate") bulkActivate.mutate();
    else if (pendingAction === "deactivate") bulkDeactivate.mutate();
    else if (pendingAction === "company-hours") bulkCompanyHours.mutate();
    else if (pendingAction === "role") bulkRoleChange.mutate();
  };

  return (
    <>
      <div
        className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm"
        data-testid="bulk-actions-bar"
      >
        <span className="text-sm font-medium">
          {count} selected
        </span>
        <span className="text-helper text-muted-foreground hidden md:inline">
          {selectedMembers
            .slice(0, 3)
            .map((m) => m.firstName || m.fullName || m.email)
            .join(", ")}
          {count > 3 ? ` +${count - 3}` : ""}
        </span>

        <div className="flex-1" />

        <Button
          size="sm"
          variant="outline"
          onClick={() => setPendingAction("activate")}
          disabled={isRunning}
          data-testid="button-bulk-activate"
        >
          <Power className="h-3.5 w-3.5 mr-1 text-green-600" />
          Enable
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPendingAction("deactivate")}
          disabled={isRunning}
          data-testid="button-bulk-deactivate"
        >
          <PowerOff className="h-3.5 w-3.5 mr-1" />
          Disable
        </Button>

        <div className="flex items-center gap-1">
          <Select value={pickedRoleId} onValueChange={setPickedRoleId}>
            <SelectTrigger
              className="h-8 w-[140px] text-xs"
              data-testid="select-bulk-role"
            >
              <SelectValue placeholder="Change role…" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPendingAction("role")}
            disabled={!pickedRoleId || isRunning}
            data-testid="button-bulk-apply-role"
          >
            <Shield className="h-3.5 w-3.5 mr-1" />
            Apply
          </Button>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => setPendingAction("company-hours")}
          disabled={isRunning}
          data-testid="button-bulk-company-hours"
          title="Revert selected members to inheriting company business hours"
        >
          <Calendar className="h-3.5 w-3.5 mr-1" />
          Company hours
        </Button>

        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onClear}
          disabled={isRunning}
          data-testid="button-bulk-clear"
          title="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>

        {isRunning && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{actionLabel}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runPending}
              className={
                pendingAction === "deactivate"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
            >
              {actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
