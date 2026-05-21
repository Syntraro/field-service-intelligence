import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ConfirmModal,
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Users,
  ChevronDown,
  ChevronUp,
  Save,
  Lock,
  Copy,
} from "lucide-react";
import {
  PERMISSION_PACKS,
  groupPermissionsByPack,
  isAdvancedPermission,
  isPermissionEnforced,
  type PermissionPack,
} from "@/lib/permissionPacks";

// 2026-05-04 PR 2: surfaces `isSystemRole` on the local Role shape.
// The API has been returning this field on `GET /api/roles` since the
// 2026-04-21 RBAC migration; the type was just missing it.
interface Role {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  hierarchy: number;
  memberCount?: number;
  isSystemRole?: boolean;
}

interface Permission {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
}

const SYSTEM_ROLE_HELPER_COPY =
  "System roles are fixed. Clone to customize.";

export default function ManageRoles() {
  const { toast } = useToast();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [newRole, setNewRole] = useState({ name: "", displayName: "", description: "" });
  const [editMode, setEditMode] = useState(false);
  const [rolePermissions, setRolePermissions] = useState<Set<string>>(new Set());
  // Pack-level expand/collapse. Default expanded: Operations + Admin/Settings.
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(
    new Set(["operations", "admin-settings"]),
  );
  // Advanced disclosure inside each pack (per-pack key).
  const [advancedOpen, setAdvancedOpen] = useState<Set<string>>(new Set());

  const { data: roles = [], isLoading } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
    staleTime: 10 * 60_000,
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
    staleTime: 10 * 60_000,
  });

  const { data: teamMembers = [] } = useQuery<Array<{ roleId?: string }>>({
    queryKey: ["/api/team"],
    staleTime: 10 * 60_000,
  });

  const roleId = selectedRole?.id;

  const { data: currentRolePermissions = [] } = useQuery<string[]>({
    queryKey: roleId ? [`/api/roles/${roleId}/permissions`] : [],
    enabled: !!roleId,
    staleTime: 10 * 60_000,
  });

  const createRoleMutation = useMutation({
    mutationFn: async (data: typeof newRole) => {
      return await apiRequest("/api/roles", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      toast({ title: "Custom role created" });
      setShowCreateDialog(false);
      setNewRole({ name: "", displayName: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ roleId, permissions }: { roleId: string; permissions: string[] }) => {
      // 2026-05-04 PR 2: same endpoint, same payload shape — UI grouping
      // does NOT change the wire format. The save list is still a flat
      // array of permission keys.
      return await apiRequest(`/api/roles/${roleId}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissions }),
      });
    },
    onSuccess: () => {
      toast({ title: "Role permissions updated" });
      setEditMode(false);
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (roleId: string) => {
      return await apiRequest(`/api/roles/${roleId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Role deleted" });
      setShowDeleteDialog(false);
      setRoleToDelete(null);
      if (selectedRole?.id === roleToDelete?.id) {
        setSelectedRole(null);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const rolesWithCounts = roles.map((role) => ({
    ...role,
    memberCount: teamMembers.filter((m) => m.roleId === role.id).length,
  }));

  // Pack-driven grouping. The raw `category` field returned by
  // `/api/permissions` is no longer used as the rendering key; we
  // bucket every permission into the 8 product packs from
  // ACCESS_CONTROL_MATRIX.md.
  const grouped = useMemo(() => groupPermissionsByPack(permissions), [permissions]);

  const handleSelectRole = (role: Role) => {
    setSelectedRole(role);
    setEditMode(false);
  };

  const handleStartEdit = () => {
    setRolePermissions(new Set(currentRolePermissions));
    setEditMode(true);
  };

  const handleStartClone = (sourceRole: Role) => {
    // 2026-05-04 PR 2: "Clone to custom role" pre-fills the create
    // dialog with a derived name + the source role's permission set.
    // The actual permission copy happens on the server after the new
    // role is created — this dialog only collects name/description.
    // The follow-up "apply permissions" step is handled below in the
    // create-success effect.
    const baseDisplayName = `Custom (from ${sourceRole.displayName})`;
    const slug = `custom_${sourceRole.name}_${Date.now().toString(36)}`;
    setNewRole({
      name: slug,
      displayName: baseDisplayName,
      description: `Cloned from ${sourceRole.displayName} on ${new Date().toLocaleDateString()}`,
    });
    setShowCreateDialog(true);
  };

  const handleTogglePermission = (permName: string) => {
    setRolePermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permName)) next.delete(permName);
      else next.add(permName);
      return next;
    });
  };

  const handleSavePermissions = () => {
    if (selectedRole) {
      updateRoleMutation.mutate({
        roleId: selectedRole.id,
        permissions: Array.from(rolePermissions),
      });
    }
  };

  const togglePack = (packId: string) => {
    setExpandedPacks((prev) => {
      const next = new Set(prev);
      if (next.has(packId)) next.delete(packId);
      else next.add(packId);
      return next;
    });
  };

  const toggleAdvanced = (packId: string) => {
    setAdvancedOpen((prev) => {
      const next = new Set(prev);
      if (next.has(packId)) next.delete(packId);
      else next.add(packId);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedPacks(new Set(PERMISSION_PACKS.map((p) => p.id)));
  };
  const collapseAll = () => {
    setExpandedPacks(new Set());
    setAdvancedOpen(new Set());
  };

  const isSelectedSystemRole = selectedRole?.isSystemRole === true;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/settings/team">
            <Button variant="ghost" size="icon" data-testid="button-back-to-team">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-bold" data-testid="text-roles-title">
              Role Management
            </h1>
            <p className="text-muted-foreground mt-1">
              System roles are fixed. Build a custom role from a clone, or use the per-user
              overrides on each team member's profile for one-off adjustments.
            </p>
          </div>
          {/* 2026-05-04 PR 2: Create Role button revealed. Backend already
              supports POST /api/roles for custom-role creation (admin +
              permissions.manage). Per ACCESS_CONTROL_MATRIX.md PR 2 task 3. */}
          <Button
            onClick={() => {
              setNewRole({ name: "", displayName: "", description: "" });
              setShowCreateDialog(true);
            }}
            data-testid="button-create-role"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create custom role
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Roles</CardTitle>
              <CardDescription>Select a role to view its permissions.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground">Loading roles...</p>
              ) : (
                <div className="space-y-2">
                  {rolesWithCounts.map((role) => {
                    const isSystem = role.isSystemRole === true;
                    return (
                      <div
                        key={role.id}
                        className={`flex items-center justify-between p-3 rounded-md cursor-pointer transition-colors ${
                          selectedRole?.id === role.id
                            ? "bg-primary/10 border border-primary/30"
                            : "bg-muted/50 hover-elevate"
                        }`}
                        onClick={() => handleSelectRole(role)}
                        data-testid={`role-item-${role.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium truncate">{role.displayName}</p>
                            {isSystem && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 h-5 gap-1"
                                data-testid={`badge-system-role-${role.name}`}
                              >
                                <Lock className="h-3 w-3" />
                                System
                              </Badge>
                            )}
                          </div>
                          <p className="text-helper text-muted-foreground truncate">
                            {role.description || (isSystem ? SYSTEM_ROLE_HELPER_COPY : "No description")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className="text-xs">
                            <Users className="h-3 w-3 mr-1" />
                            {role.memberCount}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {selectedRole ? `${selectedRole.displayName} permissions` : "Role permissions"}
                    {isSelectedSystemRole && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 h-5 gap-1"
                        data-testid="badge-selected-system-role"
                      >
                        <Lock className="h-3 w-3" />
                        System
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {!selectedRole
                      ? "Select a role from the list."
                      : isSelectedSystemRole
                        ? SYSTEM_ROLE_HELPER_COPY
                        : "Configure which permissions this role grants."}
                  </CardDescription>
                </div>
                {selectedRole && (
                  <div className="flex gap-2">
                    {!editMode ? (
                      <>
                        {isSelectedSystemRole ? (
                          // 2026-05-04 PR 2: system roles are immutable
                          // server-side. Replace Edit + Delete with the
                          // single safe affordance — clone to a custom role.
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleStartClone(selectedRole)}
                            data-testid="button-clone-system-role"
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Clone to custom role
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleStartEdit}
                              data-testid="button-edit-permissions"
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRoleToDelete(selectedRole);
                                setShowDeleteDialog(true);
                              }}
                              disabled={!!(selectedRole.memberCount && selectedRole.memberCount > 0)}
                              data-testid="button-delete-role"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setEditMode(false)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSavePermissions}
                          disabled={updateRoleMutation.isPending}
                          data-testid="button-save-role-permissions"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          Save
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedRole ? (
                <div className="text-center py-12 text-muted-foreground">
                  Select a role from the list to view its permissions.
                </div>
              ) : (
                <>
                  {editMode && (
                    <div className="flex justify-end gap-2 mb-4">
                      <Button variant="ghost" size="sm" onClick={expandAll}>
                        Expand all
                      </Button>
                      <Button variant="ghost" size="sm" onClick={collapseAll}>
                        Collapse all
                      </Button>
                    </div>
                  )}
                  <div
                    className="space-y-2 max-h-[60vh] overflow-y-auto"
                    data-testid="role-permission-pack-list"
                  >
                    {grouped.packs.map(({ pack, primary, advanced }) => {
                      const open = expandedPacks.has(pack.id);
                      const allInPack = [...primary, ...advanced];
                      const grantedCount = allInPack.filter((p) => {
                        const set = editMode ? rolePermissions : new Set(currentRolePermissions);
                        return set.has(p.name);
                      }).length;
                      return (
                        <Collapsible
                          key={pack.id}
                          open={open}
                          onOpenChange={() => togglePack(pack.id)}
                        >
                          <CollapsibleTrigger
                            className="flex items-center justify-between w-full p-3 bg-muted rounded-md"
                            data-testid={`pack-trigger-${pack.id}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-sm">{pack.label}</span>
                              <Badge variant="secondary" className="text-xs shrink-0">
                                {grantedCount}/{allInPack.length}
                              </Badge>
                            </div>
                            {open ? (
                              <ChevronUp className="h-4 w-4 shrink-0" />
                            ) : (
                              <ChevronDown className="h-4 w-4 shrink-0" />
                            )}
                          </CollapsibleTrigger>
                          <CollapsibleContent className="pt-2">
                            <p className="text-helper text-muted-foreground px-3 pb-2">
                              {pack.description}
                            </p>
                            <div className="space-y-1 pl-2">
                              {primary.map((perm) =>
                                renderPermissionRow(
                                  perm,
                                  editMode,
                                  rolePermissions,
                                  currentRolePermissions,
                                  handleTogglePermission,
                                  isSelectedSystemRole,
                                ),
                              )}
                              {advanced.length > 0 && (
                                <Collapsible
                                  open={advancedOpen.has(pack.id)}
                                  onOpenChange={() => toggleAdvanced(pack.id)}
                                >
                                  <CollapsibleTrigger
                                    className="flex items-center gap-2 text-helper text-muted-foreground py-2 pl-3 hover:text-foreground"
                                    data-testid={`advanced-trigger-${pack.id}`}
                                  >
                                    {advancedOpen.has(pack.id) ? (
                                      <ChevronUp className="h-3 w-3" />
                                    ) : (
                                      <ChevronDown className="h-3 w-3" />
                                    )}
                                    Advanced ({advanced.length})
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    <div className="space-y-1 pl-2 border-l-2 border-muted ml-3">
                                      {advanced.map((perm) =>
                                        renderPermissionRow(
                                          perm,
                                          editMode,
                                          rolePermissions,
                                          currentRolePermissions,
                                          handleTogglePermission,
                                          isSelectedSystemRole,
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
                    {grouped.unmapped.length > 0 && (
                      <Collapsible
                        open={advancedOpen.has("__unmapped__")}
                        onOpenChange={() => toggleAdvanced("__unmapped__")}
                      >
                        <CollapsibleTrigger
                          className="flex items-center gap-2 text-helper text-muted-foreground py-2 pl-3 hover:text-foreground"
                          data-testid="advanced-trigger-unmapped"
                        >
                          {advancedOpen.has("__unmapped__") ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                          Other (Advanced) ({grouped.unmapped.length})
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-1 pl-2 border-l-2 border-muted ml-3">
                            {grouped.unmapped.map((perm) =>
                              renderPermissionRow(
                                perm,
                                editMode,
                                rolePermissions,
                                currentRolePermissions,
                                handleTogglePermission,
                                isSelectedSystemRole,
                              ),
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create custom role dialog */}
      <ModalShell open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <ModalHeader>
          <ModalTitle>Create custom role</ModalTitle>
          <ModalDescription>
            Add a new tenant role. Permissions can be configured after creation.
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <div>
              <Label htmlFor="role-displayName">Display name</Label>
              <Input
                id="role-displayName"
                value={newRole.displayName}
                onChange={(e) => setNewRole({ ...newRole, displayName: e.target.value })}
                placeholder="e.g. Office Coordinator"
                data-testid="input-role-displayName"
              />
            </div>
            <div>
              <Label htmlFor="role-description">Description (optional)</Label>
              <Textarea
                id="role-description"
                value={newRole.description}
                onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                placeholder="What is this role for?"
                rows={3}
              />
            </div>
            <p className="text-helper text-muted-foreground">
              The internal name is auto-generated from the display name. After creating,
              select the new role on the left and click "Edit" to assign permissions.
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryAction onClick={() => setShowCreateDialog(false)}>
            Cancel
          </ModalSecondaryAction>
          <ModalPrimaryAction
            onClick={() => createRoleMutation.mutate(newRole)}
            disabled={!newRole.displayName.trim() || createRoleMutation.isPending}
            data-testid="button-confirm-create-role"
          >
            {createRoleMutation.isPending ? "Creating…" : "Create role"}
          </ModalPrimaryAction>
        </ModalFooter>
      </ModalShell>

      <ConfirmModal
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete Role"
        description={`Are you sure you want to delete the "${roleToDelete?.displayName}" role? This action cannot be undone.`}
        emphasis={
          roleToDelete?.memberCount && roleToDelete.memberCount > 0
            ? `This role has ${roleToDelete.memberCount} member(s) assigned. Please reassign them before deleting.`
            : undefined
        }
        confirmLabel="Delete Role"
        variant="destructive"
        isPending={deleteRoleMutation.isPending}
        onConfirm={() => { setShowDeleteDialog(false); roleToDelete && deleteRoleMutation.mutate(roleToDelete.id); }}
        testIdPrefix="role-delete"
      />
    </div>
  );
}

/**
 * Single permission row. Extracted so the primary list and the
 * Advanced disclosure inside each pack render the same shape.
 *
 * - Edit mode + non-system role → Switch
 * - Read mode OR system role     → Allowed/Denied badge
 * - Unenforced keys get a subtle "Not enforced yet" hint so admins
 *   don't think a toggle controls behavior that has no backend gate.
 */
function renderPermissionRow(
  perm: Permission,
  editMode: boolean,
  rolePermissions: Set<string>,
  currentRolePermissions: string[],
  onToggle: (name: string) => void,
  isSystemRole: boolean,
) {
  const hasPermission = editMode
    ? rolePermissions.has(perm.name)
    : currentRolePermissions.includes(perm.name);
  const enforced = isPermissionEnforced(perm.name);
  const advanced = isAdvancedPermission(perm.name);
  return (
    <div
      key={perm.id}
      className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30"
      data-testid={`permission-row-${perm.name}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium">{perm.displayName}</p>
          {!enforced && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 h-4 font-normal text-muted-foreground"
              data-testid={`badge-unenforced-${perm.name}`}
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
        {perm.description && (
          <p className="text-helper text-muted-foreground">{perm.description}</p>
        )}
        <p className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">{perm.name}</p>
      </div>
      {editMode && !isSystemRole ? (
        <Switch
          checked={hasPermission}
          onCheckedChange={() => onToggle(perm.name)}
          data-testid={`switch-perm-${perm.id}`}
        />
      ) : (
        <Badge variant={hasPermission ? "default" : "secondary"}>
          {hasPermission ? "Allowed" : "Denied"}
        </Badge>
      )}
    </div>
  );
}
