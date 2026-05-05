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
  Eye,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";
import { resolveTechnicianColor } from "@shared/colors";
import type { Permission, Role, TeamMemberDetail, TeamMemberRow } from "./types";
// 2026-05-04 PR 2: pack-driven UI grouping. Save path is unchanged —
// `permissionPacks` is a thin client-only mapper.
// 2026-05-04 PR 3: getPackAccess powers the read-only "What this user
// can access" panel below.
import {
  groupPermissionsByPack,
  isAdvancedPermission,
  isPermissionEnforced,
  getPackAccess,
  PERMISSION_PACKS,
  packIdForPermissionKey,
  type PackAccessStatus,
} from "@/lib/permissionPacks";

interface EffectiveAccessResponse {
  userId: string;
  role: string;
  roleId: string | null;
  effective: string[];
  inheritedFromRole: string[];
  grantedByOverride: string[];
  revokedByOverride: string[];
}

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

  // 2026-05-04 PR 3: read-only effective-access view. Powered by
  // `GET /api/team/:userId/effective-permissions` which calls the same
  // resolver `requirePermission(...)` uses, so this rollup matches
  // what the backend gates actually decide. Short-cached; explicitly
  // invalidated by saveRole + savePerms below.
  const { data: effectiveAccess } = useQuery<EffectiveAccessResponse>({
    queryKey: [`/api/team/${displayedId}/effective-permissions`],
    enabled: !!displayedId,
    staleTime: 30_000,
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

  // 2026-05-04 PR 2: pack-driven grouping replaces the raw `category`
  // bucketing. Keeps the same per-permission render shape so override
  // toggles (Inherited / Allow / Deny) and the save endpoint are
  // unchanged.
  const groupedPermissions = useMemo(
    () => groupPermissionsByPack(permissions),
    [permissions],
  );

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
              <CardContent className="space-y-2" data-testid="override-pack-list">
                {/* 2026-05-04 PR 2: pack-driven render. Each pack
                    shows its primary permissions inline; the noisy /
                    micro-permissions sit behind a per-pack "Advanced"
                    disclosure. Save path (`PUT /api/team/:id/permissions`)
                    is untouched — only the visual grouping changes. */}
                {groupedPermissions.packs.map(({ pack, primary, advanced }) => {
                  const open = expanded.has(pack.id);
                  const allInPack = [...primary, ...advanced];
                  const overrideCount = allInPack.filter((p) => overrides[p.name]).length;
                  return (
                    <Collapsible key={pack.id} open={open} onOpenChange={() => toggleCat(pack.id)}>
                      <CollapsibleTrigger
                        className="flex items-center justify-between w-full p-2.5 bg-muted rounded-md"
                        data-testid={`override-pack-trigger-${pack.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium">{pack.label}</span>
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {allInPack.length}
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
                        <p className="text-xs text-muted-foreground px-3 pb-2">
                          {pack.description}
                        </p>
                        <div className="space-y-1 pl-1">
                          {primary.map((p) =>
                            renderOverrideRow(p, rolePermissions, overrides, overrideMode, setState),
                          )}
                          {advanced.length > 0 && (
                            <Collapsible
                              open={expanded.has(`${pack.id}::advanced`)}
                              onOpenChange={() => toggleCat(`${pack.id}::advanced`)}
                            >
                              <CollapsibleTrigger
                                className="flex items-center gap-2 text-xs text-muted-foreground py-1.5 pl-3 hover:text-foreground"
                                data-testid={`override-advanced-trigger-${pack.id}`}
                              >
                                {expanded.has(`${pack.id}::advanced`) ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                                Advanced ({advanced.length})
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="space-y-1 pl-2 border-l-2 border-muted ml-3">
                                  {advanced.map((p) =>
                                    renderOverrideRow(
                                      p,
                                      rolePermissions,
                                      overrides,
                                      overrideMode,
                                      setState,
                                    ),
                                  )}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
                {groupedPermissions.unmapped.length > 0 && (
                  <Collapsible
                    open={expanded.has("__unmapped__")}
                    onOpenChange={() => toggleCat("__unmapped__")}
                  >
                    <CollapsibleTrigger
                      className="flex items-center gap-2 text-xs text-muted-foreground py-2 pl-3 hover:text-foreground"
                      data-testid="override-advanced-trigger-unmapped"
                    >
                      {expanded.has("__unmapped__") ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                      Other (Advanced) ({groupedPermissions.unmapped.length})
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-1 pl-2 border-l-2 border-muted ml-3">
                        {groupedPermissions.unmapped.map((p) =>
                          renderOverrideRow(p, rolePermissions, overrides, overrideMode, setState),
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
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

            {/* 2026-05-04 PR 3: read-only effective-access preview.
                Two sections — pack rollup + permission breakdown —
                neither has any controls. Backed by
                `GET /api/team/:userId/effective-permissions`, which
                calls the canonical resolver. */}
            <EffectiveAccessPanel
              data={effectiveAccess}
              permissions={permissions}
              roleDisplayName={
                roles.find((r) => r.id === member.roleId)?.displayName ??
                member.role
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only "What this user can access" panel — Phase 2 PR 3.
 *
 * Two sections:
 *   1. Pack rollup — 8 rows, one per pack, with status icon
 *      (full / partial / none).
 *   2. Permission breakdown — three sub-lists (inherited / granted /
 *      revoked), each grouped by pack.
 *
 * No controls. Pure read. Updates whenever the upstream query
 * (`/api/team/:userId/effective-permissions`) refetches, which the
 * existing role + override save mutations already invalidate.
 */
function EffectiveAccessPanel({
  data,
  permissions,
  roleDisplayName,
}: {
  data: EffectiveAccessResponse | undefined;
  permissions: Permission[];
  roleDisplayName: string;
}) {
  // Build a key → Permission lookup so the breakdown rows can show
  // friendly labels next to the raw key.
  const permByKey = useMemo(() => {
    const m = new Map<string, Permission>();
    for (const p of permissions) m.set(p.name, p);
    return m;
  }, [permissions]);

  const packRollup = useMemo(() => {
    if (!data) return null;
    return getPackAccess(data.effective);
  }, [data]);

  const breakdownByPack = useMemo(() => {
    if (!data) return null;
    function bucket(keys: string[]) {
      const out = new Map<string, string[]>();
      const orphans: string[] = [];
      for (const key of keys) {
        const packId = packIdForPermissionKey(key);
        if (!packId) {
          orphans.push(key);
          continue;
        }
        if (!out.has(packId)) out.set(packId, []);
        out.get(packId)!.push(key);
      }
      return { byPack: out, orphans };
    }
    return {
      inherited: bucket(data.inheritedFromRole),
      granted: bucket(data.grantedByOverride),
      revoked: bucket(data.revokedByOverride),
    };
  }, [data]);

  if (!data || !packRollup || !breakdownByPack) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4" />
            What this user can access
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="effective-access-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Eye className="h-4 w-4" />
          What this user can access
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Resolved from <span className="font-medium">{roleDisplayName}</span>
          {" + "}
          {data.grantedByOverride.length} grant
          {data.grantedByOverride.length === 1 ? "" : "s"}
          {", "}
          {data.revokedByOverride.length} revoke
          {data.revokedByOverride.length === 1 ? "" : "s"}.
          Reflects exactly what the backend gates check.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Section 1 — Pack rollup */}
        <div data-testid="effective-pack-rollup">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            By pack
          </h3>
          <div className="space-y-1">
            {packRollup.rows.map((row) => (
              <PackStatusRow
                key={row.pack.id}
                packId={row.pack.id}
                label={row.pack.label}
                description={row.pack.description}
                status={row.status}
                grantedCount={row.grantedCount}
                totalCount={row.totalCount}
              />
            ))}
          </div>
        </div>

        {/* Section 2 — Permission breakdown */}
        <div className="space-y-3" data-testid="effective-breakdown">
          <BreakdownSection
            label="Inherited from role"
            tone="neutral"
            data={breakdownByPack.inherited}
            permByKey={permByKey}
            testIdSuffix="inherited"
          />
          <BreakdownSection
            label="Granted by override"
            tone="positive"
            data={breakdownByPack.granted}
            permByKey={permByKey}
            testIdSuffix="granted"
          />
          <BreakdownSection
            label="Revoked by override"
            tone="negative"
            data={breakdownByPack.revoked}
            permByKey={permByKey}
            testIdSuffix="revoked"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PackStatusRow({
  packId,
  label,
  description,
  status,
  grantedCount,
  totalCount,
}: {
  packId: string;
  label: string;
  description: string;
  status: PackAccessStatus;
  grantedCount: number;
  totalCount: number;
}) {
  return (
    <div
      className="flex items-start justify-between gap-2 py-1.5 px-2 rounded-md bg-muted/30"
      data-testid={`pack-status-${packId}`}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {status === "full" && <Check className="h-4 w-4 text-emerald-600" />}
          {status === "partial" && (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
          {status === "none" && <X className="h-4 w-4 text-muted-foreground" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-5">{label}</p>
          <p className="text-xs text-muted-foreground leading-4 truncate">
            {description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 h-5 font-normal"
          data-testid={`pack-status-badge-${packId}`}
        >
          {status === "full" && "Has access"}
          {status === "partial" && "Partial"}
          {status === "none" && "No access"}
        </Badge>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-mono">
          {grantedCount}/{totalCount}
        </Badge>
      </div>
    </div>
  );
}

function BreakdownSection({
  label,
  tone,
  data,
  permByKey,
  testIdSuffix,
}: {
  label: string;
  tone: "neutral" | "positive" | "negative";
  data: { byPack: Map<string, string[]>; orphans: string[] };
  permByKey: Map<string, Permission>;
  testIdSuffix: string;
}) {
  const total =
    Array.from(data.byPack.values()).reduce((s, a) => s + a.length, 0) +
    data.orphans.length;
  if (total === 0) {
    return (
      <div data-testid={`effective-breakdown-${testIdSuffix}`}>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          {label} <span className="font-normal text-muted-foreground/70">(0)</span>
        </h4>
        <p className="text-xs text-muted-foreground italic px-2">None.</p>
      </div>
    );
  }
  // Render packs in canonical order so all three sub-lists agree.
  return (
    <div data-testid={`effective-breakdown-${testIdSuffix}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {label} <span className="font-normal text-muted-foreground/70">({total})</span>
      </h4>
      <div className="space-y-1.5">
        {PERMISSION_PACKS.map((pack) => {
          const keys = data.byPack.get(pack.id);
          if (!keys || keys.length === 0) return null;
          return (
            <div
              key={pack.id}
              className="px-2 py-1 rounded bg-muted/20"
              data-testid={`effective-${testIdSuffix}-pack-${pack.id}`}
            >
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80 mb-0.5">
                {pack.label}
              </p>
              <ul className="space-y-0.5">
                {keys.slice().sort().map((key) => (
                  <li key={key} className="flex items-baseline gap-2">
                    <span
                      className={
                        tone === "positive"
                          ? "h-1 w-1 rounded-full bg-emerald-600 mt-1.5 shrink-0"
                          : tone === "negative"
                            ? "h-1 w-1 rounded-full bg-rose-600 mt-1.5 shrink-0"
                            : "h-1 w-1 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0"
                      }
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <span className="text-xs">
                        {permByKey.get(key)?.displayName ?? key}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 font-mono ml-1.5">
                        {key}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {data.orphans.length > 0 && (
          <div
            className="px-2 py-1 rounded bg-muted/20"
            data-testid={`effective-${testIdSuffix}-pack-orphans`}
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80 mb-0.5">
              Other
            </p>
            <ul className="space-y-0.5">
              {data.orphans.slice().sort().map((key) => (
                <li key={key} className="flex items-baseline gap-2">
                  <span
                    className="h-1 w-1 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <span className="text-xs">
                      {permByKey.get(key)?.displayName ?? key}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 font-mono ml-1.5">
                      {key}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Single override row. Extracted so the primary list and the
 * Advanced disclosure inside each pack render the same shape.
 *
 * - Allow / Deny / Inherited tri-state preserved unchanged from the
 *   pre-PR-2 version. Save endpoint is unaffected.
 * - "Not enforced yet" badge surfaces keys that the backend doesn't
 *   currently consult at the route layer (see
 *   `client/src/lib/permissionPacks.ts::ENFORCED_PERMISSION_KEYS`).
 *   Helps admins distinguish which toggles control live behavior.
 */
function renderOverrideRow(
  p: Permission,
  rolePermissions: string[],
  overrides: Record<string, "grant" | "revoke">,
  overrideMode: boolean,
  setState: (name: string, s: OverrideState) => void,
) {
  const inherited = rolePermissions.includes(p.name);
  const state: OverrideState =
    overrides[p.name] === "grant"
      ? "allow"
      : overrides[p.name] === "revoke"
        ? "deny"
        : "inherited";
  const isOverridden = state !== "inherited";
  const enforced = isPermissionEnforced(p.name);
  const advanced = isAdvancedPermission(p.name);
  return (
    <div
      key={p.id}
      className={`flex items-center justify-between py-1.5 px-3 rounded-md ${
        isOverridden ? "bg-primary/5 border-l-2 border-primary" : "bg-muted/30"
      }`}
      data-testid={`override-row-${p.name}`}
    >
      <div className="flex-1 min-w-0 mr-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium">{p.displayName}</p>
          {!enforced && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 h-4 font-normal text-muted-foreground"
              data-testid={`override-badge-unenforced-${p.name}`}
            >
              Not enforced yet
            </Badge>
          )}
          {advanced && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 h-4 font-normal text-muted-foreground"
            >
              Advanced
            </Badge>
          )}
        </div>
        {p.description && (
          <p className="text-xs text-muted-foreground">{p.description}</p>
        )}
        <p className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">{p.name}</p>
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
}
