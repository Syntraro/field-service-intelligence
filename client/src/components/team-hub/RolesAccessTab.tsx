// 2026-04-20 Phase 2 Team Hub: Roles & Access tab.
// Phase 4 (2026-04-20): selection lifted to TeamHubPage; shared dirty hook.
//
// Consolidates role-switcher + permission-override editor into a single
// fast-switch view. Reuses PATCH /api/team/:userId, PUT
// /api/team/:userId/permissions, and the existing roles/permissions queries.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertCircle,
  Save,
  Search,
  Settings2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Shield,
} from "lucide-react";
import { resolveTechnicianColor } from "@shared/colors";
import type { Permission, Role, TeamMemberDetail, TeamMemberRow } from "./types";

type OverrideState = "inherited" | "allow" | "deny";

interface Props {
  selectedMemberId: string | null;
  onSelectMember: (id: string | null) => void;
}

export function RolesAccessTab({ selectedMemberId, onSelectMember }: Props) {
  const { toast } = useToast();
  const dirty = useUnsavedChanges();
  const [search, setSearch] = useState("");
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, "grant" | "revoke">>({});
  const [pickedRoleId, setPickedRoleId] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: members = [] } = useQuery<TeamMemberRow[]>({ queryKey: ["/api/team"] });
  const { data: roles = [] } = useQuery<Role[]>({ queryKey: ["/api/roles"] });
  const { data: permissions = [] } = useQuery<Permission[]>({ queryKey: ["/api/permissions"] });

  // Local fallback only — see SchedulesTab/CompensationTab for the same
  // pattern. Don't rewrite URL state just because the row was missing.
  const displayedId = useMemo(() => {
    if (members.length === 0) return null;
    if (selectedMemberId && members.some((m) => m.id === selectedMemberId)) {
      return selectedMemberId;
    }
    return members[0].id;
  }, [members, selectedMemberId]);

  const filteredMembers = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return members;
    return members.filter((m) =>
      `${m.firstName ?? ""} ${m.lastName ?? ""} ${m.fullName ?? ""} ${m.email ?? ""}`
        .toLowerCase()
        .includes(s)
    );
  }, [members, search]);

  const { data: member, isFetching } = useQuery<TeamMemberDetail>({
    queryKey: [`/api/team/${displayedId}`],
    enabled: !!displayedId,
  });

  // Default getQueryFn uses queryKey[0] as the URL, but the role-permissions
  // endpoint lives at /api/roles/:roleId/permissions — not /api/roles. Without
  // a custom queryFn the default fetcher hits /api/roles and returns Role[]
  // instead of the expected permission-name string[], which quietly breaks
  // the "inherited from role" display and the Allow/Deny override logic.
  const { data: rolePermissions = [] } = useQuery<string[]>({
    queryKey: ["/api/roles", member?.roleId, "permissions"],
    enabled: !!member?.roleId,
    queryFn: async () => {
      const res = await fetch(`/api/roles/${member!.roleId}/permissions`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load role permissions");
      return res.json();
    },
    staleTime: 10 * 60_000,
  });

  const permissionsByCategory = useMemo(() => {
    return permissions.reduce((acc, p) => {
      (acc[p.category] ??= []).push(p);
      return acc;
    }, {} as Record<string, Permission[]>);
  }, [permissions]);

  const permissionById = useMemo(() => {
    const m: Record<string, Permission> = {};
    permissions.forEach((p) => (m[p.id] = p));
    return m;
  }, [permissions]);

  // Hydrate local editor state when member changes.
  useEffect(() => {
    if (!member) return;
    setPickedRoleId(member.roleId ?? "");
    const next: Record<string, "grant" | "revoke"> = {};
    member.permissionOverrides.forEach((o) => {
      const perm = permissionById[o.permissionId];
      if (perm) next[perm.name] = o.override as "grant" | "revoke";
    });
    setOverrides(next);
    setOverrideMode(Object.keys(next).length > 0);
    dirty.markClean();
  }, [member?.id, Object.keys(permissionById).length]);

  const saveRole = useMutation({
    mutationFn: async (roleId: string) => {
      if (!member) throw new Error("No member loaded");
      return await apiRequest(`/api/team/${displayedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: member.firstName ?? undefined,
          lastName: member.lastName ?? undefined,
          fullName: member.fullName ?? undefined,
          phone: member.phone ?? undefined,
          useCustomSchedule: member.useCustomSchedule,
          isSchedulable: member.isSchedulable,
          roleId,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Role updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${displayedId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${displayedId}/effective-permissions`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
      dirty.markClean();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Role change failed", description: err?.message });
    },
  });

  const savePerms = useMutation({
    mutationFn: async () => {
      const nameToId: Record<string, string> = {};
      permissions.forEach((p) => (nameToId[p.name] = p.id));
      const payload = Object.entries(overrides)
        .filter(([, v]) => v === "grant" || v === "revoke")
        .map(([name, v]) => ({ permissionId: nameToId[name], override: v }))
        .filter((x) => x.permissionId);
      return await apiRequest(`/api/team/${displayedId}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ overrides: payload }),
      });
    },
    onSuccess: () => {
      toast({ title: "Permissions saved" });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${displayedId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${displayedId}/effective-permissions`] });
      dirty.markClean();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  const setState = (name: string, s: OverrideState) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (s === "inherited") delete next[name];
      else next[name] = s === "allow" ? "grant" : "revoke";
      return next;
    });
    dirty.markDirty();
  };

  const toggleCat = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const memberRoleDisplay = (m: TeamMemberRow) => {
    const r = roles.find((x) => (m.roleId ? x.id === m.roleId : x.name === m.role));
    return r?.displayName ?? m.role ?? "Technician";
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
      <Card className="md:sticky md:top-4 md:self-start">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Members</CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="pl-8 h-8 text-sm"
              data-testid="input-roles-search"
            />
          </div>
        </CardHeader>
        <CardContent className="px-2 pb-2 max-h-[70vh] overflow-y-auto">
          {filteredMembers.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {search ? "No matches." : "No members yet."}
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredMembers.map((m) => {
                const active = m.id === displayedId;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => dirty.confirmLeave(() => onSelectMember(m.id))}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors ${
                        active ? "bg-primary/10" : "hover:bg-muted"
                      }`}
                      data-testid={`button-roles-select-${m.id}`}
                    >
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarFallback
                          className="text-[10px] text-white"
                          style={{ backgroundColor: resolveTechnicianColor(m.id, null) }}
                        >
                          {getMemberInitials(m)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{getMemberDisplayName(m)}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {memberRoleDisplay(m)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {!displayedId ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select a member to manage access.
            </CardContent>
          </Card>
        ) : isFetching && !member ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">Loading…</CardContent>
          </Card>
        ) : !member ? (
          <Card>
            <CardContent className="py-12 text-center text-destructive flex items-center justify-center gap-2">
              <AlertCircle className="h-4 w-4" /> Could not load this member.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">{getMemberDisplayName(member)}</CardTitle>
                  <p className="text-xs text-muted-foreground">{member.email}</p>
                </div>
                <Link href="/manage-roles">
                  <Button variant="ghost" size="sm" data-testid="button-manage-roles">
                    <Settings2 className="h-3.5 w-3.5 mr-1" />
                    Manage roles
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Role</Label>
                  <div className="flex gap-2">
                    <Select
                      value={pickedRoleId}
                      onValueChange={(v) => {
                        setPickedRoleId(v);
                        if (v !== member.roleId) dirty.markDirty();
                      }}
                    >
                      <SelectTrigger className="flex-1" data-testid="select-roles-role">
                        <SelectValue placeholder="Select a role" />
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
                      onClick={() => saveRole.mutate(pickedRoleId)}
                      disabled={
                        !pickedRoleId || pickedRoleId === member.roleId || saveRole.isPending
                      }
                      data-testid="button-roles-save-role"
                    >
                      {saveRole.isPending ? "Saving…" : "Save role"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Role hierarchy is enforced server-side — you can only assign roles at or below
                    your own.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Permission overrides
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      {rolePermissions.length} permissions inherited from{" "}
                      <span className="font-medium">
                        {roles.find((r) => r.id === member.roleId)?.displayName ?? member.role}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="toggle-override" className="text-sm">
                      Override
                    </Label>
                    <Switch
                      id="toggle-override"
                      checked={overrideMode}
                      onCheckedChange={setOverrideMode}
                      data-testid="switch-override-mode"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(permissionsByCategory).map(([category, perms]) => {
                  const open = expanded.has(category);
                  const overrideCount = perms.filter((p) => overrides[p.name]).length;
                  return (
                    <Collapsible key={category} open={open} onOpenChange={() => toggleCat(category)}>
                      <CollapsibleTrigger className="flex items-center justify-between w-full p-2.5 bg-muted rounded-md">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium uppercase tracking-wider">
                            {category}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {perms.length}
                          </Badge>
                          {overrideCount > 0 && (
                            <Badge variant="outline" className="text-xs border-primary text-primary">
                              {overrideCount} override{overrideCount === 1 ? "" : "s"}
                            </Badge>
                          )}
                        </div>
                        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        <div className="space-y-1 pl-1">
                          {perms.map((p) => {
                            const inherited = rolePermissions.includes(p.name);
                            const state: OverrideState =
                              overrides[p.name] === "grant"
                                ? "allow"
                                : overrides[p.name] === "revoke"
                                ? "deny"
                                : "inherited";
                            const isOverridden = state !== "inherited";
                            return (
                              <div
                                key={p.id}
                                className={`flex items-center justify-between py-1.5 px-3 rounded-md ${
                                  isOverridden
                                    ? "bg-primary/5 border-l-2 border-primary"
                                    : "bg-muted/30"
                                }`}
                              >
                                <div className="flex-1 min-w-0 mr-3">
                                  <p className="text-sm font-medium truncate">{p.displayName}</p>
                                  {p.description && (
                                    <p className="text-xs text-muted-foreground truncate">
                                      {p.description}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button
                                    size="sm"
                                    variant={state === "inherited" ? "default" : "outline"}
                                    className="text-xs h-7 px-2"
                                    onClick={() => setState(p.name, "inherited")}
                                    disabled={!overrideMode}
                                    data-testid={`button-perm-inherited-${p.id}`}
                                  >
                                    Inherited{state === "inherited" && ` · ${inherited ? "Yes" : "No"}`}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={state === "allow" ? "default" : "outline"}
                                    className="text-xs h-7 px-2"
                                    onClick={() => setState(p.name, "allow")}
                                    disabled={!overrideMode}
                                    data-testid={`button-perm-allow-${p.id}`}
                                  >
                                    Allow
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={state === "deny" ? "destructive" : "outline"}
                                    className="text-xs h-7 px-2"
                                    onClick={() => setState(p.name, "deny")}
                                    disabled={!overrideMode}
                                    data-testid={`button-perm-deny-${p.id}`}
                                  >
                                    Deny
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
                {overrideMode && (
                  <div className="flex justify-between pt-4 mt-2 border-t">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setOverrides({});
                        savePerms.mutate();
                      }}
                      disabled={savePerms.isPending}
                      data-testid="button-perm-clear-all"
                    >
                      Clear all overrides
                    </Button>
                    <div className="flex items-center gap-2">
                      {dirty.isDirty && (
                        <span className="text-xs text-muted-foreground">Unsaved changes</span>
                      )}
                      <Button
                        onClick={() => savePerms.mutate()}
                        disabled={!dirty.isDirty || savePerms.isPending}
                        data-testid="button-perm-save"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        {savePerms.isPending ? "Saving…" : "Save overrides"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
