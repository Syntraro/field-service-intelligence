import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, UserCircle, Users, Shield, Clock, ChevronRight, ArrowUpDown, Mail, Settings2, LayoutGrid, List, UserPlus, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";

type ViewDensity = "comfortable" | "compact";

interface TeamMember {
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
  createdAt: string;
  lastLoginAt: string | null;
}

interface Role {
  id: string;
  name: string;
  displayName: string;
  hierarchy: number;
}

type SortOption = "name-asc" | "name-desc" | "login-newest" | "login-oldest" | "role";

export default function ManageTeam() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [userDensityPreference, setUserDensityPreference] = useState<ViewDensity | null>(null);
  const [inviteForm, setInviteForm] = useState({
    fullName: "",
    email: "",
    roleId: "",
    notes: "",
  });
  const [addMemberForm, setAddMemberForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    roleId: "",
    disabled: false,
  });
  const [addMemberError, setAddMemberError] = useState<string | null>(null);

  const { data: teamMembers = [], isLoading, isError, error } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
  });

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const getRoleNameForMember = (member: TeamMember) =>
  (member.roleId ? roleById.get(member.roleId)?.name : undefined) ?? member.role ?? "technician";

  // Create team member mutation
  const createMemberMutation = useMutation({
    mutationFn: async (data: typeof addMemberForm) => {
      // Parse fullName into firstName/lastName for consistency
      const trimmedFullName = (data.fullName || "").trim();
      const nameParts = trimmedFullName.split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

      return await apiRequest<TeamMember & { message?: string }>("/api/team", {
        method: "POST",
        body: JSON.stringify({
          fullName: trimmedFullName,
          firstName,
          lastName,
          email: data.email,
          phone: data.phone || null,
          roleId: data.roleId || undefined,
          disabled: data.disabled,
        }),
      });
    },
    onSuccess: (newMember) => {
      toast({
        title: "Team member created",
        description: newMember.message || `${newMember.fullName || newMember.email} has been added to the team.`,
      });
      setAddMemberDialogOpen(false);
      setAddMemberForm({ fullName: "", email: "", phone: "", roleId: "", disabled: false });
      setAddMemberError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      // Navigate to the new member's detail page
      navigate(`/manage-team/${newMember.id}`);
    },
    onError: (error: any) => {
      const message = error.message || "Failed to create team member";
      setAddMemberError(message);
      toast({
        variant: "destructive",
        title: "Error",
        description: message,
      });
    },
  });

  // Density: auto-detect based on team size, user can override
  const autoCompact = teamMembers.length <= 6;
  const effectiveDensity: ViewDensity = userDensityPreference ?? (autoCompact ? "compact" : "comfortable");
  const isCompact = effectiveDensity === "compact";

  const filteredMembers = teamMembers
    .filter((member) => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = 
        (member.firstName?.toLowerCase() || "").includes(searchLower) ||
        (member.lastName?.toLowerCase() || "").includes(searchLower) ||
        (member.email?.toLowerCase() || "").includes(searchLower) ||
        (member.fullName?.toLowerCase() || "").includes(searchLower) ||
        (getRoleNameForMember(member).toLowerCase() || "").includes(searchLower) ||
        (member.phone?.toLowerCase() || "").includes(searchLower);
      
      const matchesStatus = statusFilter === "all" || member.status === statusFilter;
      const matchesRole =  roleFilter === "all" || getRoleNameForMember(member) === roleFilter;

      
      return matchesSearch && matchesStatus && matchesRole;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "name-asc":
          return getDisplayName(a).localeCompare(getDisplayName(b));
        case "name-desc":
          return getDisplayName(b).localeCompare(getDisplayName(a));
        case "login-newest":
          if (!a.lastLoginAt && !b.lastLoginAt) return 0;
          if (!a.lastLoginAt) return 1;
          if (!b.lastLoginAt) return -1;
          return new Date(b.lastLoginAt).getTime() - new Date(a.lastLoginAt).getTime();
        case "login-oldest":
          if (!a.lastLoginAt && !b.lastLoginAt) return 0;
          if (!a.lastLoginAt) return 1;
          if (!b.lastLoginAt) return -1;
          return new Date(a.lastLoginAt).getTime() - new Date(b.lastLoginAt).getTime();
        case "role":
          return a.role.localeCompare(b.role);
        default:
          return 0;
      }
    });

  function getDisplayName(member: TeamMember) {
    if (member.firstName && member.lastName) {
      return `${member.firstName} ${member.lastName}`;
    }
    return member.fullName || member.email;
  }

  const getInitials = (member: TeamMember) => {
    if (member.firstName && member.lastName) {
      return `${member.firstName[0]}${member.lastName[0]}`.toUpperCase();
    }
    return member.email[0].toUpperCase();
  };

  const getStatusBadge = (status: string, disabled?: boolean) => {
    // Check disabled flag first (deactivated status should also have disabled=true)
    if (disabled || status === "deactivated") {
      return <Badge variant="secondary">Disabled</Badge>;
    }
    switch (status) {
      case "active":
        return <Badge variant="default" className="bg-green-600">Enabled</Badge>;
      case "pending":
        return <Badge variant="outline">Pending</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getRoleBadge = (role: string) => {
    const roleColors: Record<string, string> = {
      owner: "bg-purple-600",
      admin: "bg-blue-600",
      manager: "bg-cyan-600",
      dispatcher: "bg-amber-600",
      technician: "bg-gray-600",
    };
    const colorClass = roleColors[role.toLowerCase()] || "bg-gray-600";
    return <Badge className={colorClass}>{role}</Badge>;
  };

  const handleInviteSubmit = () => {
    toast({
      title: "Invite sent",
      description: `An invitation has been sent to ${inviteForm.email}`,
    });
    setInviteDialogOpen(false);
    setInviteForm({ fullName: "", email: "", roleId: "", notes: "" });
  };

  const activeCount = teamMembers.filter(m => m.status === "active").length;
  const totalCount = teamMembers.length;
  const pendingCount = teamMembers.filter(m => m.status === "pending").length;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-team-management-title">Team Management</h1>
            <p className="text-muted-foreground mt-1">Manage your team members, roles, and permissions</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={addMemberDialogOpen} onOpenChange={(open) => {
              setAddMemberDialogOpen(open);
              if (!open) setAddMemberError(null);
            }}>
              <DialogTrigger asChild>
                <Button size="default" data-testid="button-add-member">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Team Member</DialogTitle>
                  <DialogDescription>
                    Create a new team member directly. They will need to reset their password to log in.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {addMemberError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{addMemberError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="add-name">Full Name *</Label>
                    <Input
                      id="add-name"
                      value={addMemberForm.fullName}
                      onChange={(e) => setAddMemberForm(prev => ({ ...prev, fullName: e.target.value }))}
                      placeholder="John Doe"
                      data-testid="input-add-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-email">Email *</Label>
                    <Input
                      id="add-email"
                      type="email"
                      value={addMemberForm.email}
                      onChange={(e) => setAddMemberForm(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="john@example.com"
                      data-testid="input-add-email"
                    />
                    <p className="text-xs text-muted-foreground">
                      Each email can only belong to one company.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-phone">Phone</Label>
                    <Input
                      id="add-phone"
                      value={addMemberForm.phone}
                      onChange={(e) => setAddMemberForm(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="(555) 123-4567"
                      data-testid="input-add-phone"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-role">Role *</Label>
                    <Select
                      value={addMemberForm.roleId}
                      onValueChange={(value) => setAddMemberForm(prev => ({ ...prev, roleId: value }))}
                    >
                      <SelectTrigger data-testid="select-add-role">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>{role.displayName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <Label htmlFor="add-enabled">Account Enabled</Label>
                      <p className="text-xs text-muted-foreground">Disabled accounts cannot log in</p>
                    </div>
                    <Switch
                      id="add-enabled"
                      checked={!addMemberForm.disabled}
                      onCheckedChange={(checked) => setAddMemberForm(prev => ({ ...prev, disabled: !checked }))}
                      data-testid="switch-add-enabled"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddMemberDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createMemberMutation.mutate(addMemberForm)}
                    disabled={!addMemberForm.email || !addMemberForm.fullName || createMemberMutation.isPending}
                    data-testid="button-create-member"
                  >
                    {createMemberMutation.isPending ? "Creating..." : "Create Member"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button size="default" variant="outline" data-testid="button-invite-member">
                  <Mail className="h-4 w-4 mr-2" />
                  Invite Member
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
                <DialogDescription>
                  Send an invitation to add a new member to your team. Each email can only belong to one company.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-name">Full Name</Label>
                  <Input
                    id="invite-name"
                    value={inviteForm.fullName}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, fullName: e.target.value }))}
                    placeholder="John Doe"
                    data-testid="input-invite-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="john@example.com"
                    data-testid="input-invite-email"
                  />
                  <p className="text-xs text-muted-foreground">
                    If this person works for multiple companies, they must use a different email for each.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role">Role</Label>
                  <Select
                    value={inviteForm.roleId}
                    onValueChange={(value) => setInviteForm(prev => ({ ...prev, roleId: value }))}
                  >
                    <SelectTrigger data-testid="select-invite-role">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>{role.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-notes">Notes (optional)</Label>
                  <Textarea
                    id="invite-notes"
                    value={inviteForm.notes}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Any additional notes for this team member..."
                    data-testid="input-invite-notes"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleInviteSubmit}
                  disabled={!inviteForm.email || !inviteForm.fullName}
                  data-testid="button-send-invite"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Send Invite
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {isCompact ? (
          <div className="flex items-center gap-4 mb-4 text-sm flex-wrap">
            <div className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-primary" />
              <span className="font-semibold" data-testid="text-total-members">{totalCount}</span>
              <span className="text-muted-foreground">Members</span>
            </div>
            <span className="text-muted-foreground">|</span>
            <div className="flex items-center gap-1.5">
              <UserCircle className="h-4 w-4 text-green-500" />
              <span className="font-semibold" data-testid="text-active-members">{activeCount}</span>
              <span className="text-muted-foreground">Active</span>
            </div>
            <span className="text-muted-foreground">|</span>
            <div className="flex items-center gap-1.5">
              <Shield className="h-4 w-4 text-blue-500" />
              <span className="font-semibold" data-testid="text-roles-count">{roles.length}</span>
              <span className="text-muted-foreground">Roles</span>
            </div>
            <span className="text-muted-foreground">|</span>
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="font-semibold" data-testid="text-pending-count">{pendingCount}</span>
              <span className="text-muted-foreground">Pending</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-total-members">{totalCount}</p>
                    <p className="text-xs text-muted-foreground">Total Members</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/10 rounded-lg">
                    <UserCircle className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-active-members">{activeCount}</p>
                    <p className="text-xs text-muted-foreground">Active Members</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Shield className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-roles-count">{roles.length}</p>
                    <p className="text-xs text-muted-foreground">Roles Defined</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 rounded-lg">
                    <Clock className="h-5 w-5 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-pending-count">{pendingCount}</p>
                    <p className="text-xs text-muted-foreground">Pending Invites</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">View:</span>
            <div className="flex border rounded-md">
              <Button
                variant={effectiveDensity === "comfortable" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setUserDensityPreference("comfortable")}
                className="rounded-r-none"
                data-testid="button-view-comfortable"
              >
                <LayoutGrid className="h-4 w-4 mr-1" />
                Comfortable
              </Button>
              <Button
                variant={effectiveDensity === "compact" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setUserDensityPreference("compact")}
                className="rounded-l-none"
                data-testid="button-view-compact"
              >
                <List className="h-4 w-4 mr-1" />
                Compact
              </Button>
            </div>
          </div>
          <Link href="/manage-roles">
            <Button variant="outline" data-testid="link-manage-roles">
              <Settings2 className="h-4 w-4 mr-2" />
              Manage Roles
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col md:flex-row gap-4 justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, role, or phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-team"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="deactivated">Disabled</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[140px]" data-testid="select-role-filter">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.name}>{role.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                  <SelectTrigger className="w-[150px]" data-testid="select-sort">
                    <ArrowUpDown className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name-asc">Name A-Z</SelectItem>
                    <SelectItem value="name-desc">Name Z-A</SelectItem>
                    <SelectItem value="login-newest">Last Login (Newest)</SelectItem>
                    <SelectItem value="login-oldest">Last Login (Oldest)</SelectItem>
                    <SelectItem value="role">Role</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Loading team members...</div>
            ) : isError ? (
              <div className="text-center py-8">
                <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
                <p className="text-destructive font-medium">Failed to load team members</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {(error as any)?.message || "Please try again later"}
                </p>
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchTerm || statusFilter !== "all" || roleFilter !== "all"
                  ? "No team members match your filters"
                  : "No team members found"}
              </div>
            ) : (
              <Table className={isCompact ? "text-sm" : ""}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member) => (
                    <TableRow 
                      key={member.id} 
                      data-testid={`row-team-member-${member.id}`}
                      className={isCompact ? "h-10" : ""}
                    >
                      <TableCell className={isCompact ? "py-1" : ""}>
                        <div className={`flex items-center ${isCompact ? "gap-2" : "gap-3"}`}>
                          <Avatar className={isCompact ? "h-6 w-6" : "h-9 w-9"}>
                            <AvatarFallback className={isCompact ? "text-xs" : ""}>
                              {getInitials(member)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium" data-testid={`text-member-name-${member.id}`}>
                              {getDisplayName(member)}
                            </p>
                            {!isCompact && (
                              <p className="text-sm text-muted-foreground">{member.email}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={isCompact ? "py-1" : ""}>
                        {getRoleBadge(getRoleNameForMember(member))}

                      </TableCell>
                      <TableCell className={isCompact ? "py-1" : ""}>
                        {getStatusBadge(member.status, member.disabled)}
                      </TableCell>
                      <TableCell className={isCompact ? "py-1" : ""}>
                        {member.lastLoginAt ? (
                          <span className="text-muted-foreground">
                            {new Date(member.lastLoginAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell className={isCompact ? "py-1" : ""}>
                        <Link href={`/manage-team/${member.id}`}>
                          <Button variant="ghost" size="icon" data-testid={`button-view-member-${member.id}`}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
