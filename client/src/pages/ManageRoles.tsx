import { useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Pencil, Trash2, Users, ChevronDown, ChevronUp, Save } from "lucide-react";

interface Role {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  hierarchy: number;
  memberCount?: number;
}

interface Permission {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
}

interface RolePermission {
  roleId: string;
  permissionId: string;
}

export default function ManageRoles() {
  const { toast } = useToast();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [newRole, setNewRole] = useState({ name: "", displayName: "", description: "" });
  const [editMode, setEditMode] = useState(false);
  const [rolePermissions, setRolePermissions] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["admin"]));

  const { data: roles = [], isLoading } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
    // Admin reference data; rarely changes; mutations invalidate explicitly
    staleTime: 10 * 60_000,
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
    // Static reference data; effectively constant
    staleTime: 10 * 60_000,
  });

  const { data: teamMembers = [] } = useQuery<Array<{ roleId?: string }>>({
    queryKey: ["/api/team"],
    // Slow-changing admin reference; mutations to team explicitly invalidate
    staleTime: 10 * 60_000,
  });


  const roleId = selectedRole?.id;

const { data: currentRolePermissions = [] } = useQuery<string[]>({
  queryKey: roleId ? [`/api/roles/${roleId}/permissions`] : [],
  enabled: !!roleId,
  // Same admin reference class as roles/permissions
  staleTime: 10 * 60_000,
});


  const createRoleMutation = useMutation({
    mutationFn: async (data: typeof newRole) => {
      return await apiRequest("/api/roles", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      toast({ title: "Role created successfully" });
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
      return await apiRequest(`/api/roles/${roleId}/permissions`, { method: "PUT", body: JSON.stringify({ permissions }) });
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


  const permissionsByCategory = permissions.reduce((acc, perm) => {
    const cat = perm.category.toLowerCase();
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);

  const handleSelectRole = (role: Role) => {
    setSelectedRole(role);
    setEditMode(false);
  };

  const handleStartEdit = () => {
    setRolePermissions(new Set(currentRolePermissions));
    setEditMode(true);
  };

  const handleTogglePermission = (permName: string) => {
    setRolePermissions(prev => {
      const next = new Set(prev);
      if (next.has(permName)) {
        next.delete(permName);
      } else {
        next.add(permName);
      }
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

  const toggleSection = (category: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSections(new Set(Object.keys(permissionsByCategory)));
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          {/* 2026-04-20 Phase 2: back-link points at the canonical hub. */}
          <Link href="/settings/team">
            <Button variant="ghost" size="icon" data-testid="button-back-to-team">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-bold" data-testid="text-roles-title">Role Management</h1>
            {/* 2026-04-21 Phase 1 canonical policy architecture: two-layer
                model — coarse role gates + fine-grained permissions (this
                page) + per-user overrides. Roles are enforced server-side
                on every protected route. */}
            <p className="text-muted-foreground mt-1">
              Define which permissions each role grants. Roles are the first layer of access
              control; per-user overrides (grant or revoke a single permission for one person)
              are configured from each team member's profile.
            </p>
          </div>
{/* Create Role button hidden - roles are predetermined */}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Roles</CardTitle>
              <CardDescription>Select a role to view or edit its permissions</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground">Loading roles...</p>
              ) : (
                <div className="space-y-2">
                  {rolesWithCounts.map((role) => (
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
                      <div>
                        <p className="font-medium">{role.displayName}</p>
                        <p className="text-xs text-muted-foreground">{role.description || "No description"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          <Users className="h-3 w-3 mr-1" />
                          {role.memberCount}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>
                    {selectedRole ? `${selectedRole.displayName} Permissions` : "Role Permissions"}
                  </CardTitle>
                  <CardDescription>
                    {selectedRole
                      ? "Configure which permissions this role grants"
                      : "Select a role from the list to view its permissions"}
                  </CardDescription>
                </div>
                {selectedRole && (
                  <div className="flex gap-2">
                    {!editMode ? (
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
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditMode(false)}
                        >
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
                  Select a role from the list to view and manage its permissions
                </div>
              ) : (
                <>
                  {editMode && (
                    <div className="flex justify-end gap-2 mb-4">
                      <Button variant="ghost" size="sm" onClick={expandAll}>
                        Expand All
                      </Button>
                      <Button variant="ghost" size="sm" onClick={collapseAll}>
                        Collapse All
                      </Button>
                    </div>
                  )}
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {Object.entries(permissionsByCategory).map(([category, categoryPerms]) => (
                      <Collapsible
                        key={category}
                        open={expandedSections.has(category)}
                        onOpenChange={() => toggleSection(category)}
                      >
                        <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-muted rounded-md">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm uppercase tracking-wider">
                              {category}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {categoryPerms.length}
                            </Badge>
                          </div>
                          {expandedSections.has(category) ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                          <div className="space-y-1 pl-2">
                            {categoryPerms.map((perm) => {
                              const hasPermission = editMode
                                ? rolePermissions.has(perm.name)
                                : currentRolePermissions.includes(perm.name);
                              
                              return (
                                <div
                                  key={perm.id}
                                  className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30"
                                >
                                  <div className="flex-1">
                                    <p className="text-sm font-medium">{perm.displayName}</p>
                                    {perm.description && (
                                      <p className="text-xs text-muted-foreground">{perm.description}</p>
                                    )}
                                  </div>
                                  {editMode ? (
                                    <Switch
                                      checked={hasPermission}
                                      onCheckedChange={() => handleTogglePermission(perm.id)}
                                      data-testid={`switch-perm-${perm.id}`}
                                    />
                                  ) : (
                                    <Badge variant={hasPermission ? "default" : "secondary"}>
                                      {hasPermission ? "Allowed" : "Denied"}
                                    </Badge>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Role</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the "{roleToDelete?.displayName}" role? This action cannot be undone.
              {roleToDelete?.memberCount && roleToDelete.memberCount > 0 && (
                <span className="block mt-2 text-destructive font-medium">
                  This role has {roleToDelete.memberCount} member(s) assigned. Please reassign them before deleting.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => roleToDelete && deleteRoleMutation.mutate(roleToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!(roleToDelete?.memberCount && roleToDelete.memberCount > 0)}
            >
              Delete Role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
