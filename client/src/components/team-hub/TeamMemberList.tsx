import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { resolveTechnicianColor } from "@shared/colors";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import type { Role, TeamMemberRow } from "./types";

interface Props {
  selectedMemberId: string | null;
  onSelect: (id: string | null) => void;
}

type StatusFilter = "all" | "active" | "inactive";

export function TeamMemberList({ selectedMemberId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const { data: members = [], isLoading } = useQuery<TeamMemberRow[]>({
    queryKey: ["/api/team"],
  });
  const { data: roles = [] } = useQuery<Role[]>({ queryKey: ["/api/roles"] });

  const roleNameToDisplay = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of roles) {
      out.set(r.id, r.displayName);
      out.set(r.name, r.displayName);
    }
    return out;
  }, [roles]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return members.filter((m) => {
      if (statusFilter === "active" && (m.disabled || m.status === "inactive")) return false;
      if (statusFilter === "inactive" && !m.disabled && m.status !== "inactive") return false;
      if (roleFilter !== "all" && m.roleId !== roleFilter && m.role !== roleFilter) return false;
      if (!s) return true;
      const haystack = `${m.firstName ?? ""} ${m.lastName ?? ""} ${m.fullName ?? ""} ${m.email ?? ""}`.toLowerCase();
      return haystack.includes(s);
    });
  }, [members, search, statusFilter, roleFilter]);

  return (
    <Card className="md:sticky md:top-4 md:self-start" data-testid="team-member-list">
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Team members</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {filtered.length}
          </Badge>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-8 h-8 text-sm"
            data-testid="input-team-list-search"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-team-list-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-team-list-role">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="px-2 pb-2 max-h-[70vh] overflow-y-auto">
        <ul className="space-y-0.5">
          {isLoading ? (
            <li className="p-3 text-helper text-muted-foreground">Loading…</li>
          ) : filtered.length === 0 ? (
            <li className="p-3 text-helper text-muted-foreground">
              {search || statusFilter !== "active" || roleFilter !== "all"
                ? "No matches."
                : "No team members yet."}
            </li>
          ) : (
            filtered.map((m) => {
              const active = m.id === selectedMemberId;
              const roleLabel =
                roleNameToDisplay.get(m.roleId ?? "") ??
                roleNameToDisplay.get(m.role ?? "") ??
                m.role ??
                "Member";
              const isInactive = m.disabled || m.status === "inactive";
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(m.id)}
                    className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors ${
                      active ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted"
                    }`}
                    data-testid={`button-team-list-select-${m.id}`}
                    aria-pressed={active}
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback
                        className="text-[11px] text-white"
                        style={{ backgroundColor: resolveTechnicianColor(m.id, null) }}
                      >
                        {getMemberInitials(m)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="truncate text-foreground font-medium text-helper">
                          {getMemberDisplayName(m)}
                        </span>
                        {isInactive && (
                          <Badge variant="secondary" className="text-[10px] py-0 px-1">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <div className="text-helper text-muted-foreground truncate">
                        {roleLabel}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
