// 2026-04-20 Phase 2 Team Hub: Members tab.
// Phase 4 (2026-04-20): row selection + bulk actions, segmented quick-filter,
// autofocus search, Enter-to-open, "Schedule" action that jumps to the
// Schedules tab with the row pre-selected.
//
// Replaces the list portion of the deleted /manage-team page. Inline
// enable/disable still calls the canonical per-user routes; the new bulk bar
// fans out to the same routes via Promise.allSettled with partial-success
// reporting (see BulkActionsBar).
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import {
  AlertCircle,
  ChevronRight,
  Power,
  PowerOff,
  Search,
  Mail,
  Calendar as CalendarIcon,
} from "lucide-react";
import { resolveTechnicianColor } from "@shared/colors";
import { BulkActionsBar } from "./BulkActionsBar";
import type { Role, TeamMemberRow } from "./types";

type StatusFilter = "all" | "active" | "deactivated";

interface Props {
  /**
   * Optional callback to switch to the Schedules tab with a member pre-selected.
   * Wired by TeamHubPage so the row "Schedule" button is one click instead of
   * navigate-then-pick.
   */
  onSelectMember?: (id: string) => void;
}

export function MembersTab({ onSelectMember }: Props) {
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Autofocus search on mount — admins typically arrive here to find someone.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const { data: members = [], isLoading, isError } = useQuery<TeamMemberRow[]>({
    queryKey: ["/api/team"],
  });
  const { data: roles = [] } = useQuery<Role[]>({ queryKey: ["/api/roles"] });

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const roleNameFor = (m: TeamMemberRow) =>
    (m.roleId ? roleById.get(m.roleId)?.name : undefined) ?? m.role ?? "technician";
  const roleDisplayFor = (m: TeamMemberRow) => {
    const found = m.roleId ? roleById.get(m.roleId) : roles.find((r) => r.name === m.role);
    return found?.displayName ?? m.role ?? "Technician";
  };

  const toggleStatus = useMutation({
    mutationFn: async ({ userId, disable }: { userId: string; disable: boolean }) => {
      const path = disable ? "deactivate" : "activate";
      return await apiRequest(`/api/team/${userId}/${path}`, { method: "POST" });
    },
    onSuccess: (_data, vars) => {
      toast({ title: vars.disable ? "Member disabled" : "Member enabled" });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Error", description: err?.message });
    },
  });

  const filtered = useMemo(() => {
    return members.filter((m) => {
      const hay = `${m.firstName ?? ""} ${m.lastName ?? ""} ${m.fullName ?? ""} ${m.email ?? ""} ${m.phone ?? ""}`.toLowerCase();
      if (search && !hay.includes(search.toLowerCase())) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (roleFilter === "all") return true;
      if (roleFilter === "__technicians") return roleNameFor(m) === "technician";
      if (roleFilter === "__office") return roleNameFor(m) !== "technician";
      return roleNameFor(m) === roleFilter;
    });
  }, [members, search, statusFilter, roleFilter, roleById]);

  // Drop selections that fell out of view after a filter change so the bulk
  // bar count never claims more than is actually selectable.
  useEffect(() => {
    if (selected.size === 0) return;
    const visible = new Set(filtered.map((m) => m.id));
    let changed = false;
    const next = new Set<string>();
    selected.forEach((id) => {
      if (visible.has(id)) next.add(id);
      else changed = true;
    });
    if (changed) setSelected(next);
  }, [filtered]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id));
  const someVisibleSelected =
    filtered.some((m) => selected.has(m.id)) && !allVisibleSelected;

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) filtered.forEach((m) => next.add(m.id));
      else filtered.forEach((m) => next.delete(m.id));
      return next;
    });
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const getStatusBadge = (m: TeamMemberRow) => {
    if (m.disabled || m.status === "deactivated") return <Badge variant="secondary">Disabled</Badge>;
    if (m.status === "invited") return <Badge variant="outline">Invited</Badge>;
    return <Badge className="bg-green-600 hover:bg-green-600">Active</Badge>;
  };

  const getRoleBadge = (m: TeamMemberRow) => {
    const roleName = roleNameFor(m);
    const colors: Record<string, string> = {
      owner: "bg-purple-600",
      admin: "bg-blue-600",
      manager: "bg-cyan-600",
      dispatcher: "bg-amber-600",
      technician: "bg-gray-600",
    };
    return (
      <Badge className={`${colors[roleName.toLowerCase()] || "bg-gray-600"} hover:opacity-90`}>
        {roleDisplayFor(m)}
      </Badge>
    );
  };

  return (
    <div className="space-y-3">
      <BulkActionsBar
        selectedIds={Array.from(selected)}
        members={members}
        onClear={() => setSelected(new Set())}
      />

      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Search members…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-members-search"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[130px]" data-testid="select-members-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="deactivated">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-members-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="__technicians">Technicians only</SelectItem>
              <SelectItem value="__office">Office (non-tech)</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.name}>
                  {r.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading members…</div>
        ) : isError ? (
          <div className="p-8 text-center text-destructive flex items-center justify-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4" /> Failed to load team members.
          </div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No team members yet. Use <span className="font-medium">Add Member</span> or{" "}
            <span className="font-medium">Invite</span> to get started.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No members match your filters.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={allVisibleSelected || (someVisibleSelected ? "indeterminate" : false)}
                    onCheckedChange={(v) => toggleAllVisible(v === true)}
                    aria-label="Select all visible"
                    data-testid="checkbox-select-all"
                  />
                </TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="w-[220px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => {
                const isDisabledRow = !!m.disabled || m.status === "deactivated";
                const isChecked = selected.has(m.id);
                return (
                  <TableRow
                    key={m.id}
                    data-testid={`row-member-${m.id}`}
                    data-state={isChecked ? "selected" : undefined}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        window.location.href = `/manage-team/${m.id}`;
                      } else if (e.key === " ") {
                        e.preventDefault();
                        toggleOne(m.id, !isChecked);
                      }
                    }}
                    className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  >
                    <TableCell>
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) => toggleOne(m.id, v === true)}
                        aria-label={`Select ${getMemberDisplayName(m)}`}
                        data-testid={`checkbox-member-${m.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback
                            className="text-xs text-white"
                            style={{ backgroundColor: resolveTechnicianColor(m.id, null) }}
                          >
                            {getMemberInitials(m)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{getMemberDisplayName(m)}</p>
                          <p className="text-helper text-muted-foreground truncate flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {m.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getRoleBadge(m)}</TableCell>
                    <TableCell>{getStatusBadge(m)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onSelectMember && roleNameFor(m) === "technician" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onSelectMember(m.id)}
                            data-testid={`button-schedule-${m.id}`}
                            title="Open this technician in the Schedules tab"
                          >
                            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            toggleStatus.mutate({ userId: m.id, disable: !isDisabledRow })
                          }
                          disabled={toggleStatus.isPending}
                          data-testid={`button-toggle-${m.id}`}
                          title={isDisabledRow ? "Enable member" : "Disable member"}
                        >
                          {isDisabledRow ? (
                            <Power className="h-4 w-4 text-green-600" />
                          ) : (
                            <PowerOff className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                        <Link href={`/manage-team/${m.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`button-open-profile-${m.id}`}>
                            Profile
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
