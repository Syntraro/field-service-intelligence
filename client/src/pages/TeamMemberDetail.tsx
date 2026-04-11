import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ArrowLeft, Save, UserCircle, Clock, Shield, DollarSign, AlertTriangle, Copy, Plus, Check, X, Info, Search, ChevronDown, ChevronUp, ChevronsUpDown, KeyRound } from "lucide-react";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";

interface TeamMemberWithDetails {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  phone: string | null;
  role: string;
  roleId: string | null;
  status: string;
  disabled?: boolean;
  useCustomSchedule: boolean;
  isSchedulable: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  profile: {
    id: string;
    userId: string;
    laborCostPerHour: string | null;
    billableRatePerHour: string | null;
    color: string | null;
    phone: string | null;
    note: string | null;
  } | null;
  workingHours: Array<{
    id: string;
    userId: string;
    dayOfWeek: number;
    startTime: string | null;
    endTime: string | null;
    isWorking: boolean;
  }>;
  permissionOverrides: Array<{
    id: string;
    userId: string;
    permissionId: string;
    override: string;
  }>;
}

interface Role {
  id: string;
  name: string;
  displayName: string;
  hierarchy: number;
}

interface Permission {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
}

import { DAYS_OF_WEEK_FULL as DAYS_OF_WEEK } from "@/lib/schedulingConstants";

const DEFAULT_HOURS = DAYS_OF_WEEK.map((day) => ({
  dayOfWeek: day.value,
  startTime: day.value >= 1 && day.value <= 5 ? "08:00" : null,
  endTime: day.value >= 1 && day.value <= 5 ? "17:00" : null,
  isWorking: day.value >= 1 && day.value <= 5,
}));

const BILLABLE_ROLES = ["technician", "installer", "service_tech"];

export default function TeamMemberDetail() {
  const { toast } = useToast();
  const [, params] = useRoute("/manage-team/:userId");
  const userId = params?.userId;

  const [basicInfo, setBasicInfo] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    roleId: "",
  });

  const [emailInput, setEmailInput] = useState("");
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [profile, setProfile] = useState({
    laborCostPerHour: "",
    billableRatePerHour: "",
    color: "#3b82f6",
    note: "",
  });

  const [workingHours, setWorkingHours] = useState(DEFAULT_HOURS);
  const [useCustomSchedule, setUseCustomSchedule] = useState(false);
  const [isSchedulable, setIsSchedulable] = useState(true);
  const [overridePermissions, setOverridePermissions] = useState(false);
  const [permissionOverrides, setPermissionOverrides] = useState<Record<string, "grant" | "revoke" | null>>({});
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [showActivateDialog, setShowActivateDialog] = useState(false);
  const [showCreateRoleDialog, setShowCreateRoleDialog] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", description: "" });
  const [permissionSearch, setPermissionSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["admin"]));
  const [prevSearch, setPrevSearch] = useState("");

  const { data: member, isLoading } = useQuery<TeamMemberWithDetails>({
    queryKey: [`/api/team/${userId}`],
    enabled: !!userId,
  });

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
  });

  const { data: effectivePermissions = [] } = useQuery<string[]>({
    queryKey: [`/api/team/${userId}/effective-permissions`],
    enabled: !!userId,
  });

  const { data: rolePermissions = [] } = useQuery<string[]>({
    queryKey: ["/api/roles", member?.roleId, "permissions"],
    enabled: !!member?.roleId,
  });

  const permissionNameById = useMemo(() => {
    const map: Record<string, string> = {};
    permissions.forEach((p) => { map[p.id] = p.name; });
    return map;
  }, [permissions]);

  const permissionIdByName = useMemo(() => {
    const map: Record<string, string> = {};
    permissions.forEach((p) => { map[p.name] = p.id; });
    return map;
  }, [permissions]);

  const permissionsByCategory = useMemo(() => {
    return permissions.reduce((acc, perm) => {
      if (!acc[perm.category]) acc[perm.category] = [];
      acc[perm.category].push(perm);
      return acc;
    }, {} as Record<string, Permission[]>);
  }, [permissions]);

  // Effect A: Hydrate basic form fields when member changes (runs once per member)
  useEffect(() => {
    if (member) {
      // Parse firstName/lastName from fullName if needed
      let firstName = member.firstName || "";
      let lastName = member.lastName || "";
      if (!firstName && !lastName && member.fullName) {
        const parts = member.fullName.trim().split(/\s+/);
        firstName = parts[0] || "";
        lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
      }

      setBasicInfo({
        firstName,
        lastName,
        phone: member.phone || "",
        roleId: member.roleId || "",
      });
      setEmailInput(member.email || "");
      setUseCustomSchedule(member.useCustomSchedule);
      setIsSchedulable(member.isSchedulable !== false);

      if (member.profile) {
        setProfile({
          laborCostPerHour: member.profile.laborCostPerHour || "",
          billableRatePerHour: member.profile.billableRatePerHour || "",
          color: member.profile.color || "#3b82f6",
          note: member.profile.note || "",
        });
      }

      if (member.workingHours && member.workingHours.length > 0) {
        const hoursMap = new Map(member.workingHours.map(h => [h.dayOfWeek, h]));
        setWorkingHours(DAYS_OF_WEEK.map(day => {
          const existing = hoursMap.get(day.value);
          return {
            dayOfWeek: day.value,
            startTime: existing?.startTime || null,
            endTime: existing?.endTime || null,
            isWorking: existing?.isWorking ?? false,
          };
        }));
      }
    }
  }, [member?.id]);

  // Effect B: Initialize permission overrides when permissionNameById becomes available
  useEffect(() => {
    if (!member || Object.keys(permissionNameById).length === 0) return;

    if (member.permissionOverrides && member.permissionOverrides.length > 0) {
      setOverridePermissions(true);
      const overrides: Record<string, "grant" | "revoke"> = {};
      member.permissionOverrides.forEach(o => {
        const permName = permissionNameById[o.permissionId];
        if (permName) {
          overrides[permName] = o.override as "grant" | "revoke";
        }
      });
      setPermissionOverrides(overrides);
    } else {
      setPermissionOverrides({});
    }
  }, [member?.id, permissionNameById]);

  const updateBasicMutation = useMutation({
    mutationFn: async (data: typeof basicInfo & { useCustomSchedule: boolean; isSchedulable: boolean }) => {
      return await apiRequest(`/api/team/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...data,
          roleId: data.roleId || undefined,  // Convert empty string to undefined
          fullName: `${data.firstName} ${data.lastName}`.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Member updated successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"] }); // Update calendar dropdown
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: typeof profile) => {
      return await apiRequest(`/api/team/${userId}/profile`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast({ title: "Profile updated successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}`] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const updateWorkingHoursMutation = useMutation({
    mutationFn: async (hours: typeof workingHours) => {
      return await apiRequest(`/api/team/${userId}/working-hours`, {
        method: "PUT",
        body: JSON.stringify({ hours }),
      });
    },
    onSuccess: () => {
      toast({ title: "Working hours updated successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians/working-hours"] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async (overrides: Array<{ permissionId: string; override: "grant" | "revoke" }>) => {
      return await apiRequest(`/api/team/${userId}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ overrides }),
      });
    },
    onSuccess: () => {
      toast({ title: "Permissions updated successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}/effective-permissions`] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/team/${userId}/deactivate`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({ title: "Member deactivated" });
      setShowDeactivateDialog(false);
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      // 2026-03-24: Invalidate schedulable technicians cache so dispatch board,
      // task board, and scheduling dialogs immediately reflect the disabled state.
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians/working-hours"], exact: false });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/team/${userId}/activate`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({ title: "Member activated" });
      setShowActivateDialog(false);
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      // 2026-03-24: Invalidate schedulable technicians cache so dispatch board,
      // task board, and scheduling dialogs immediately reflect the re-enabled state.
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians/working-hours"], exact: false });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const updateEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      return await apiRequest(`/api/team/${userId}/email`, {
        method: "PUT",
        body: JSON.stringify({ email }),
      });
    },
    onSuccess: () => {
      toast({ title: "Email updated", description: "User will need to log in again with their new email." });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      return await apiRequest(`/api/team/${userId}/password`, {
        method: "PUT",
        body: JSON.stringify({ password }),
      });
    },
    onSuccess: () => {
      toast({ title: "Password reset", description: "User will need to log in again with their new password." });
      setShowResetPasswordDialog(false);
      setNewPassword("");
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const handleWorkingHourChange = (dayOfWeek: number, field: string, value: any) => {
    setWorkingHours(prev => prev.map(h => 
      h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h
    ));
  };

  const copyMondayToWeekdays = () => {
    const monday = workingHours.find(h => h.dayOfWeek === 1);
    if (monday) {
      setWorkingHours(prev => prev.map(h => {
        if (h.dayOfWeek >= 1 && h.dayOfWeek <= 5) {
          return {
            ...h,
            startTime: monday.startTime,
            endTime: monday.endTime,
            isWorking: monday.isWorking,
          };
        }
        return h;
      }));
      toast({ title: "Copied Monday's hours to all weekdays" });
    }
  };

  const handlePermissionToggle = (permId: string) => {
    setPermissionOverrides(prev => {
      const current = prev[permId];
      const hasFromRole = rolePermissions.includes(permissions.find(p => p.id === permId)?.name || "");
      
      if (current === null || current === undefined) {
        return { ...prev, [permId]: hasFromRole ? "revoke" : "grant" };
      } else if (current === "grant") {
        return { ...prev, [permId]: "revoke" };
      } else {
        const { [permId]: _, ...rest } = prev;
        return rest;
      }
    });
  };

  const savePermissions = () => {
    const overrides = Object.entries(permissionOverrides)
      .filter(([_, value]) => value !== null)
      .flatMap(([permName, override]) => {
        const permissionId = permissionIdByName[permName];
        return permissionId ? [{ permissionId, override: override as "grant" | "revoke" }] : [];
      });
    updatePermissionsMutation.mutate(overrides);
  };

  const clearAllOverrides = () => {
    setPermissionOverrides({});
    updatePermissionsMutation.mutate([]);
  };

  const setPermissionState = (permName: string, state: "inherited" | "allow" | "deny") => {
    setPermissionOverrides(prev => {
      if (state === "inherited") {
        const { [permName]: _, ...rest } = prev;
        return rest;
      } else if (state === "allow") {
        return { ...prev, [permName]: "grant" };
      } else {
        return { ...prev, [permName]: "revoke" };
      }
    });
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

  const expandAllSections = () => {
    const categories = Object.keys(permissionsByCategory).map(c => c.toLowerCase());
    setExpandedSections(new Set(categories));
  };

  const collapseAllSections = () => {
    setExpandedSections(new Set());
  };

  useEffect(() => {
    if (permissionSearch && !prevSearch) {
    } else if (!permissionSearch && prevSearch) {
      const categories = Object.keys(permissionsByCategory).map(c => c.toLowerCase());
      if (categories.length > 0) {
        setExpandedSections(new Set([categories[0]]));
      }
    }
    setPrevSearch(permissionSearch);
  }, [permissionSearch, prevSearch, permissionsByCategory]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F4F8F4] p-4">
        <div className="max-w-4xl mx-auto">
          <p>Loading team member...</p>
        </div>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="min-h-screen bg-[#F4F8F4] p-4">
        <div className="max-w-4xl mx-auto">
          <p>Team member not found</p>
          <Link href="/manage-team">
            <Button variant="outline" className="mt-4">Back to Team</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Safely compute role name - member.role may be undefined, try roleId lookup as fallback
  const currentRole = roles.find(r => r.id === basicInfo.roleId);
  const roleName = (member.role ?? currentRole?.name ?? "").toLowerCase();
  const isBillableRole = BILLABLE_ROLES.includes(roleName);

  return (
    <div className="min-h-screen bg-[#F4F8F4] p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/manage-team">
            <Button variant="ghost" size="icon" data-testid="button-back-to-team">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-4 flex-1">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-xl">{getMemberInitials(member)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-member-name">
                {getMemberDisplayName(member)}
              </h1>
              {member.email && <p className="text-muted-foreground">{member.email}</p>}
            </div>
          </div>
          <Badge className={member.status === "active" && !member.disabled ? "bg-green-600" : "bg-gray-500"}>
            {member.status === "active" && !member.disabled ? "Active" : "Inactive"}
          </Badge>
        </div>

        <Tabs defaultValue="basic" className="space-y-4">
          <TabsList>
            <TabsTrigger value="basic" data-testid="tab-basic-info">
              <UserCircle className="h-4 w-4 mr-2" />
              Basic Info
            </TabsTrigger>
            <TabsTrigger value="schedule" data-testid="tab-schedule">
              <Clock className="h-4 w-4 mr-2" />
              Schedule
            </TabsTrigger>
            <TabsTrigger value="billing" data-testid="tab-billing">
              <DollarSign className="h-4 w-4 mr-2" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="permissions" data-testid="tab-permissions">
              <Shield className="h-4 w-4 mr-2" />
              Permissions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>Update team member's name, contact, and role</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={basicInfo.firstName}
                      onChange={(e) => setBasicInfo(prev => ({ ...prev, firstName: e.target.value }))}
                      data-testid="input-first-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={basicInfo.lastName}
                      onChange={(e) => setBasicInfo(prev => ({ ...prev, lastName: e.target.value }))}
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="flex gap-2">
                    <Input
                      id="email"
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      data-testid="input-email"
                    />
                    {emailInput !== member.email && (
                      <Button
                        variant="outline"
                        onClick={() => updateEmailMutation.mutate(emailInput)}
                        disabled={updateEmailMutation.isPending || !emailInput}
                        data-testid="button-save-email"
                      >
                        {updateEmailMutation.isPending ? "Saving..." : "Save Email"}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This email is used for login. Each email can only belong to one company.
                    Changing the email will log the user out.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={basicInfo.phone}
                    onChange={(e) => setBasicInfo(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="(555) 123-4567"
                    data-testid="input-phone"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <div className="flex gap-2">
                    <Select
                      value={basicInfo.roleId}
                      onValueChange={(value) => setBasicInfo(prev => ({ ...prev, roleId: value }))}
                    >
                      <SelectTrigger className="flex-1" data-testid="select-role">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>{role.displayName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
{/* Create Role button hidden - roles are predetermined */}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t">
                  <div>
                    <p className="font-medium">Status</p>
                    <p className="text-sm text-muted-foreground">
                      {member.status === "active"
                        ? "This member can access the system"
                        : "This member cannot access the system"}
                    </p>
                  </div>
                  {member.status === "active" ? (
                    <Button
                      variant="outline"
                      onClick={() => setShowDeactivateDialog(true)}
                      data-testid="button-toggle-status"
                    >
                      Disable Account
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      onClick={() => setShowActivateDialog(true)}
                      data-testid="button-toggle-status"
                    >
                      Enable Account
                    </Button>
                  )}
                </div>
                <div className="flex items-center justify-between pt-4 border-t">
                  <div>
                    <p className="font-medium">Reset Password</p>
                    <p className="text-sm text-muted-foreground">
                      Set a new password for this user. They will be logged out.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setShowResetPasswordDialog(true)}
                    data-testid="button-reset-password"
                  >
                    <KeyRound className="h-4 w-4 mr-2" />
                    Reset Password
                  </Button>
                </div>
                <div className="flex justify-end pt-4">
                  <Button
                    onClick={() => updateBasicMutation.mutate({ ...basicInfo, useCustomSchedule, isSchedulable })}
                    disabled={updateBasicMutation.isPending}
                    data-testid="button-save-basic"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule">
            <Card className="mb-6">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="is-schedulable" className="text-base font-medium">Show on calendar</Label>
                    <p className="text-sm text-muted-foreground">
                      Allows this person to be scheduled and have time billed on jobs.
                    </p>
                  </div>
                  <Switch
                    id="is-schedulable"
                    checked={isSchedulable}
                    onCheckedChange={(checked) => {
                      setIsSchedulable(checked);
                      updateBasicMutation.mutate({ ...basicInfo, useCustomSchedule, isSchedulable: checked });
                    }}
                    data-testid="switch-is-schedulable"
                  />
                </div>
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="space-y-0.5">
                    <Label className="text-base font-medium">Use Custom Schedule</Label>
                    <p className="text-sm text-muted-foreground">Override default company working hours for this member</p>
                  </div>
                  <Switch
                    checked={useCustomSchedule}
                    onCheckedChange={(checked) => {
                      setUseCustomSchedule(checked);
                      updateBasicMutation.mutate({ ...basicInfo, useCustomSchedule: checked, isSchedulable });
                    }}
                    data-testid="switch-custom-schedule"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Working Hours</CardTitle>
                    <CardDescription>Set the team member's regular working schedule</CardDescription>
                  </div>
                  {useCustomSchedule && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyMondayToWeekdays}
                      data-testid="button-copy-monday"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Monday to Weekdays
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!useCustomSchedule && (
                  <div className="p-4 bg-muted rounded-md mb-4 flex items-start gap-3">
                    <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <p className="text-sm text-muted-foreground">
                      This member is using the default company schedule. Enable "Use Custom Schedule" above to customize their hours.
                    </p>
                  </div>
                )}
                {DAYS_OF_WEEK.map((day) => {
                  const hours = workingHours.find(h => h.dayOfWeek === day.value) || {
                    dayOfWeek: day.value,
                    startTime: null,
                    endTime: null,
                    isWorking: false,
                  };
                  return (
                    <div key={day.value} className="flex items-center gap-4 py-2 border-b last:border-0">
                      <div className="w-28">
                        <span className="font-medium">{day.label}</span>
                      </div>
                      <Switch
                        checked={hours.isWorking}
                        onCheckedChange={(checked) => handleWorkingHourChange(day.value, "isWorking", checked)}
                        disabled={!useCustomSchedule}
                        data-testid={`switch-working-${day.value}`}
                      />
                      {hours.isWorking && (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            type="time"
                            value={hours.startTime || ""}
                            onChange={(e) => handleWorkingHourChange(day.value, "startTime", e.target.value)}
                            className="w-32"
                            disabled={!useCustomSchedule}
                            data-testid={`input-start-${day.value}`}
                          />
                          <span className="text-muted-foreground">to</span>
                          <Input
                            type="time"
                            value={hours.endTime || ""}
                            onChange={(e) => handleWorkingHourChange(day.value, "endTime", e.target.value)}
                            className="w-32"
                            disabled={!useCustomSchedule}
                            data-testid={`input-end-${day.value}`}
                          />
                        </div>
                      )}
                      {!hours.isWorking && (
                        <span className="text-muted-foreground">Off</span>
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-end pt-4">
                  <Button
                    onClick={() => updateWorkingHoursMutation.mutate(workingHours)}
                    disabled={updateWorkingHoursMutation.isPending || !useCustomSchedule}
                    data-testid="button-save-schedule"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Schedule
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="billing">
            <Card>
              <CardHeader>
                <CardTitle>Billing & Costs</CardTitle>
                <CardDescription>Configure labor costs and billing rates for this team member</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isBillableRole && (
                  <div className="p-4 bg-muted rounded-md mb-4 flex items-start gap-3">
                    <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <p className="text-sm text-muted-foreground">
                      These fields are optional for non-field roles. They are mainly used for technicians and other billable staff.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="laborCost">Labor Cost (per hour)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="laborCost"
                        type="number"
                        step="0.01"
                        value={profile.laborCostPerHour}
                        onChange={(e) => setProfile(prev => ({ ...prev, laborCostPerHour: e.target.value }))}
                        className="pl-7"
                        placeholder="0.00"
                        data-testid="input-labor-cost"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Internal cost of this technician's time</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billableRate">Billable Rate (per hour)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="billableRate"
                        type="number"
                        step="0.01"
                        value={profile.billableRatePerHour}
                        onChange={(e) => setProfile(prev => ({ ...prev, billableRatePerHour: e.target.value }))}
                        className="pl-7"
                        placeholder="0.00"
                        data-testid="input-billable-rate"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Rate charged to customers</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="color">Calendar Color</Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="color"
                      type="color"
                      value={profile.color}
                      onChange={(e) => setProfile(prev => ({ ...prev, color: e.target.value }))}
                      className="w-16 h-9 p-1"
                      data-testid="input-color"
                    />
                    <div 
                      className="h-9 w-24 rounded-md border"
                      style={{ backgroundColor: profile.color }}
                    />
                    <span className="text-sm text-muted-foreground">Used to identify this technician on the calendar</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note">Internal Notes</Label>
                  <Textarea
                    id="note"
                    value={profile.note}
                    onChange={(e) => setProfile(prev => ({ ...prev, note: e.target.value }))}
                    placeholder="Internal notes about this team member..."
                    rows={4}
                    data-testid="input-note"
                  />
                </div>
                <div className="flex justify-end pt-4">
                  <Button
                    onClick={() => updateProfileMutation.mutate(profile)}
                    disabled={updateProfileMutation.isPending}
                    data-testid="button-save-billing"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Billing Info
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="permissions">
            <Card>
              <CardHeader>
                <CardTitle>Permissions</CardTitle>
                <CardDescription>
                  View and customize this member's access rights. Permissions are inherited from their role with optional overrides.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Role Capabilities Summary */}
                <Collapsible className="mb-4">
                  <div className="p-4 bg-muted rounded-md">
                    <CollapsibleTrigger className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-3">
                        <Shield className="h-5 w-5 text-primary" />
                        <div className="text-left">
                          <p className="font-medium">Role: {currentRole?.displayName || member.role}</p>
                          <p className="text-sm text-muted-foreground">
                            {rolePermissions.length} permissions inherited from role
                          </p>
                        </div>
                      </div>
                      <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3 mt-3 border-t">
                      <p className="text-sm font-medium mb-2">Role Capabilities Summary</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {Object.entries(permissionsByCategory).map(([category, categoryPerms]) => {
                          const grantedInCategory = categoryPerms.filter((p) =>
                            rolePermissions.includes(p.name)
                          );
                          if (grantedInCategory.length === 0) return null;
                          return (
                            <div key={category} className="text-sm">
                              <span className="font-medium text-muted-foreground uppercase text-xs">
                                {category}:
                              </span>
                              <span className="ml-1">
                                {grantedInCategory.length}/{categoryPerms.length} permissions
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {rolePermissions.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs text-muted-foreground mb-2">
                            Key capabilities for this role:
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {rolePermissions.slice(0, 8).map((permName) => {
                              const perm = permissions.find((p) => p.name === permName);
                              return perm ? (
                                <Badge key={perm.id} variant="secondary" className="text-xs">
                                  {perm.displayName}
                                </Badge>
                              ) : null;
                            })}
                            {rolePermissions.length > 8 && (
                              <Badge variant="outline" className="text-xs">
                                +{rolePermissions.length - 8} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                <div className="flex items-center justify-between mb-4 pb-4 border-b">
                  <div>
                    <p className="font-medium">Override Role Permissions</p>
                    <p className="text-sm text-muted-foreground">Enable to grant or revoke specific permissions for this member</p>
                  </div>
                  <Switch
                    checked={overridePermissions}
                    onCheckedChange={setOverridePermissions}
                    data-testid="switch-override-permissions"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search permissions..."
                      value={permissionSearch}
                      onChange={(e) => setPermissionSearch(e.target.value)}
                      className="pl-9"
                      data-testid="input-permission-search"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={expandAllSections} data-testid="button-expand-all">
                      Expand all
                    </Button>
                    <Button variant="ghost" size="sm" onClick={collapseAllSections} data-testid="button-collapse-all">
                      Collapse all
                    </Button>
                  </div>
                </div>

                <div className="max-h-[60vh] overflow-y-auto space-y-2">
                  {Object.entries(permissionsByCategory).map(([category, categoryPerms]) => {
                    const searchLower = permissionSearch.toLowerCase();
                    const filteredPerms = permissionSearch
                      ? categoryPerms.filter(p => 
                          p.displayName.toLowerCase().includes(searchLower) ||
                          (p.description?.toLowerCase() || "").includes(searchLower)
                        )
                      : categoryPerms;

                    if (filteredPerms.length === 0) return null;

                    const isOpen = permissionSearch ? true : expandedSections.has(category.toLowerCase());

                    return (
                      <Collapsible
                        key={category}
                        open={isOpen}
                        onOpenChange={() => !permissionSearch && toggleSection(category.toLowerCase())}
                      >
                        <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-muted rounded-md">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm uppercase tracking-wider">
                              {category}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {filteredPerms.length}
                            </Badge>
                          </div>
                          {isOpen ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                          <div className="space-y-1 pl-2">
                            {filteredPerms.map((perm) => {
                              const hasFromRole = rolePermissions.includes(perm.name);
                              const override = permissionOverrides[perm.name];
                              const currentState: "inherited" | "allow" | "deny" = 
                                override === "grant" ? "allow" : 
                                override === "revoke" ? "deny" : "inherited";
                              const inheritedValue = hasFromRole;
                              const isOverridden = currentState !== "inherited";

                              return (
                                <div
                                  key={perm.id}
                                  className={`flex items-center justify-between py-2 px-3 rounded-md transition-colors ${
                                    isOverridden ? "bg-primary/5 border-l-2 border-primary" : "bg-muted/30"
                                  }`}
                                >
                                  <div className="flex-1 min-w-0 mr-4">
                                    <p className="text-sm font-medium">{perm.displayName}</p>
                                    {perm.description && (
                                      <p className="text-xs text-muted-foreground truncate">{perm.description}</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                      variant={currentState === "inherited" ? "default" : "outline"}
                                      size="sm"
                                      className="text-xs h-7 px-2"
                                      onClick={() => setPermissionState(perm.name, "inherited")}
                                      disabled={!overridePermissions}
                                      data-testid={`button-perm-inherited-${perm.id}`}
                                    >
                                      Inherited
                                      {currentState === "inherited" && (
                                        <span className="ml-1 text-muted-foreground">
                                          · {inheritedValue ? "Yes" : "No"}
                                        </span>
                                      )}
                                    </Button>
                                    <Button
                                      variant={currentState === "allow" ? "default" : "outline"}
                                      size="sm"
                                      className="text-xs h-7 px-2"
                                      onClick={() => setPermissionState(perm.name, "allow")}
                                      disabled={!overridePermissions}
                                      data-testid={`button-perm-allow-${perm.id}`}
                                    >
                                      Allow
                                    </Button>
                                    <Button
                                      variant={currentState === "deny" ? "destructive" : "outline"}
                                      size="sm"
                                      className="text-xs h-7 px-2"
                                      onClick={() => setPermissionState(perm.name, "deny")}
                                      disabled={!overridePermissions}
                                      data-testid={`button-perm-deny-${perm.id}`}
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
                </div>

                {overridePermissions && (
                  <div className="flex justify-between pt-4 mt-4 border-t">
                    <Button
                      variant="outline"
                      onClick={clearAllOverrides}
                      data-testid="button-clear-overrides"
                    >
                      Clear All Overrides
                    </Button>
                    <Button
                      onClick={savePermissions}
                      disabled={updatePermissionsMutation.isPending}
                      data-testid="button-save-permissions"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save Permissions
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              This will prevent {member.firstName || member.email} from accessing the system. They will not be able to log in until re-enabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivateMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disable Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showActivateDialog} onOpenChange={setShowActivateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              This will allow {member.firstName || member.email} to access the system again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => activateMutation.mutate()}>
              Enable Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showResetPasswordDialog} onOpenChange={(open) => {
        setShowResetPasswordDialog(open);
        if (!open) {
          setNewPassword("");
          setConfirmPassword("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {member.firstName || member.email}. They will be logged out of all sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 10 characters)"
                data-testid="input-new-password"
              />
              {newPassword.length > 0 && newPassword.length < 10 && (
                <p className="text-xs text-destructive">Password must be at least 10 characters</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                data-testid="input-confirm-password"
              />
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetPasswordDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => resetPasswordMutation.mutate(newPassword)}
              disabled={
                newPassword.length < 10 ||
                newPassword !== confirmPassword ||
                resetPasswordMutation.isPending
              }
              data-testid="button-confirm-reset-password"
            >
              {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateRoleDialog} onOpenChange={setShowCreateRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Role</DialogTitle>
            <DialogDescription>
              Define a new role with a name and description. Permissions can be configured after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">Role Name</Label>
              <Input
                id="role-name"
                value={newRole.name}
                onChange={(e) => setNewRole(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Senior Technician"
                data-testid="input-role-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-description">Description</Label>
              <Textarea
                id="role-description"
                value={newRole.description}
                onChange={(e) => setNewRole(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe this role's responsibilities..."
                data-testid="input-role-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateRoleDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                toast({ title: "Role created", description: `${newRole.name} has been created` });
                setShowCreateRoleDialog(false);
                setNewRole({ name: "", description: "" });
              }}
              disabled={!newRole.name}
              data-testid="button-create-role-submit"
            >
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
