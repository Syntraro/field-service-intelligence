// 2026-04-20 Phase 3: personal-detail page.
//
// Previously this page was a multi-tab management console (Basic Info /
// Schedule / Billing / Permissions). Those workflows now live in the Team Hub
// at /settings/team. This page is now a compact member-detail surface focused
// on the per-user record: name, email, phone, role, enable/disable, password
// reset. For schedules / compensation / permission overrides, use the hub.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { ArrowLeft, KeyRound, Save, ExternalLink } from "lucide-react";
// 2026-04-23 Phase 1: external calendar (ICS) subscription management.
import { CalendarSyncSection } from "@/components/team-hub/CalendarSyncSection";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import { resolveTechnicianColor } from "@shared/colors";

interface TeamMemberDetailDto {
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
  profile: { color: string | null } | null;
}

interface Role {
  id: string;
  name: string;
  displayName: string;
  hierarchy: number;
}

export default function TeamMemberDetail() {
  const { toast } = useToast();
  const dirty = useUnsavedChanges();
  const [, params] = useRoute("/manage-team/:userId");
  const userId = params?.userId;

  const [basic, setBasic] = useState({ firstName: "", lastName: "", phone: "", roleId: "" });
  const setBasicField = <K extends keyof typeof basic>(key: K, value: (typeof basic)[K]) => {
    setBasic((p) => ({ ...p, [key]: value }));
    dirty.markDirty();
  };
  const [emailInput, setEmailInput] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);

  const { data: member, isLoading } = useQuery<TeamMemberDetailDto>({
    queryKey: [`/api/team/${userId}`],
    enabled: !!userId,
  });
  const { data: roles = [] } = useQuery<Role[]>({ queryKey: ["/api/roles"] });

  // Hydrate local form state on member change.
  useEffect(() => {
    if (!member) return;
    let firstName = member.firstName || "";
    let lastName = member.lastName || "";
    if (!firstName && !lastName && member.fullName) {
      const parts = member.fullName.trim().split(/\s+/);
      firstName = parts[0] || "";
      lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
    }
    setBasic({
      firstName,
      lastName,
      phone: member.phone || "",
      roleId: member.roleId || "",
    });
    setEmailInput(member.email || "");
    dirty.markClean();
  }, [member?.id]);

  const invalidateAfterUserMutation = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/team"] });
    queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
    queryClient.invalidateQueries({
      queryKey: ["/api/team/technicians/working-hours"],
      exact: false,
    });
  };

  const updateBasic = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/team/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: basic.firstName,
          lastName: basic.lastName,
          fullName: `${basic.firstName} ${basic.lastName}`.trim() || null,
          phone: basic.phone,
          roleId: basic.roleId || undefined,
          useCustomSchedule: member?.useCustomSchedule ?? false,
          isSchedulable: member?.isSchedulable ?? true,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      dirty.markClean();
      invalidateAfterUserMutation();
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Error", description: err?.message }),
  });

  const updateEmail = useMutation({
    mutationFn: async (email: string) => {
      return await apiRequest(`/api/team/${userId}/email`, {
        method: "PUT",
        body: JSON.stringify({ email }),
      });
    },
    onSuccess: () => {
      toast({ title: "Email updated", description: "User will be logged out." });
      invalidateAfterUserMutation();
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Error", description: err?.message }),
  });

  const resetPassword = useMutation({
    mutationFn: async (password: string) => {
      return await apiRequest(`/api/team/${userId}/password`, {
        method: "PUT",
        body: JSON.stringify({ password }),
      });
    },
    onSuccess: () => {
      toast({ title: "Password reset", description: "User will be logged out." });
      setResetOpen(false);
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Error", description: err?.message }),
  });

  const deactivate = useMutation({
    mutationFn: async () => apiRequest(`/api/team/${userId}/deactivate`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Member disabled" });
      setDeactivateOpen(false);
      invalidateAfterUserMutation();
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Error", description: err?.message }),
  });

  const activate = useMutation({
    mutationFn: async () => apiRequest(`/api/team/${userId}/activate`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Member enabled" });
      setActivateOpen(false);
      invalidateAfterUserMutation();
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Error", description: err?.message }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-3xl mx-auto text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm">Team member not found.</p>
          <Link href="/settings/team">
            <Button variant="outline" size="sm" className="mt-3">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Team
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isDisabled = !!member.disabled || member.status === "deactivated";
  const currentRoleName = roles.find((r) => r.id === basic.roleId)?.displayName ?? member.role;
  const bgColor = resolveTechnicianColor(member.id, member.profile?.color ?? null);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Compact header: back-link, avatar, name, status, manage-team shortcut. */}
        <div className="flex items-center gap-3">
          <Link href="/settings/team">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              data-testid="button-back-to-team"
              onClick={(e) => {
                if (dirty.isDirty && !window.confirm("Discard unsaved changes?")) {
                  e.preventDefault();
                }
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <Avatar className="h-10 w-10">
            <AvatarFallback
              className="text-sm text-white"
              style={{ backgroundColor: bgColor }}
            >
              {getMemberInitials(member)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold truncate" data-testid="text-member-name">
              {getMemberDisplayName(member)}
            </h1>
            <p className="text-xs text-muted-foreground truncate">
              {member.email} · {currentRoleName}
            </p>
          </div>
          <Badge
            variant={isDisabled ? "secondary" : "default"}
            className={isDisabled ? "" : "bg-green-600 hover:bg-green-600"}
          >
            {isDisabled ? "Disabled" : "Active"}
          </Badge>
        </div>

        {/* Primary card — basic info in a dense two-column grid. */}
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="firstName" className="text-xs">
                  First name
                </Label>
                <Input
                  id="firstName"
                  value={basic.firstName}
                  onChange={(e) => setBasicField("firstName", e.target.value)}
                  className="h-9"
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lastName" className="text-xs">
                  Last name
                </Label>
                <Input
                  id="lastName"
                  value={basic.lastName}
                  onChange={(e) => setBasicField("lastName", e.target.value)}
                  className="h-9"
                  data-testid="input-last-name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone" className="text-xs">
                  Phone
                </Label>
                <Input
                  id="phone"
                  value={basic.phone}
                  onChange={(e) => setBasicField("phone", e.target.value)}
                  placeholder="(555) 123-4567"
                  className="h-9"
                  data-testid="input-phone"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="role" className="text-xs">
                  Role
                </Label>
                <Select
                  value={basic.roleId}
                  onValueChange={(v) => setBasicField("roleId", v)}
                >
                  <SelectTrigger id="role" className="h-9" data-testid="select-role">
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
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="email" className="text-xs">
                  Login email
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="email"
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="h-9"
                    data-testid="input-email"
                  />
                  {emailInput !== member.email && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateEmail.mutate(emailInput)}
                      disabled={updateEmail.isPending || !emailInput}
                      data-testid="button-save-email"
                    >
                      {updateEmail.isPending ? "Saving…" : "Update"}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Each email can only belong to one company. Changing it logs the user out.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Joined {new Date(member.createdAt).toLocaleDateString()}
                  {member.lastLoginAt ? ` · Last login ${new Date(member.lastLoginAt).toLocaleDateString()}` : " · Never logged in"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResetOpen(true)}
                  data-testid="button-reset-password"
                >
                  <KeyRound className="h-3.5 w-3.5 mr-1" />
                  Reset password
                </Button>
                {isDisabled ? (
                  <Button
                    size="sm"
                    onClick={() => setActivateOpen(true)}
                    data-testid="button-toggle-status"
                  >
                    Enable account
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeactivateOpen(true)}
                    data-testid="button-toggle-status"
                  >
                    Disable account
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => updateBasic.mutate()}
                  disabled={updateBasic.isPending}
                  data-testid="button-save-basic"
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {updateBasic.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pointer to hub — schedule/compensation/permissions moved there. */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
          <span>
            Schedule, compensation, and access for this member are managed from the Team hub.
          </span>
          <Link href="/settings/team">
            <Button size="sm" variant="ghost" className="h-7" data-testid="link-open-team-hub">
              Open Team hub
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>

        {/* 2026-04-23 Phase 1: external calendar subscription (read-only ICS feed). */}
        <CalendarSyncSection userId={member.id} memberFirstName={member.firstName} />
      </div>

      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable account</AlertDialogTitle>
            <AlertDialogDescription>
              This prevents {member.firstName || member.email} from accessing the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivate.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={activateOpen} onOpenChange={setActivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable account</AlertDialogTitle>
            <AlertDialogDescription>
              This re-enables {member.firstName || member.email} to access the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => activate.mutate()}>Enable</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={resetOpen}
        onOpenChange={(open) => {
          setResetOpen(open);
          if (!open) {
            setNewPassword("");
            setConfirmPassword("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Sets a new password for {member.firstName || member.email}. They will be logged out
              of all sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="new-password" className="text-xs">
                New password
              </Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 10 characters"
                data-testid="input-new-password"
              />
              {newPassword.length > 0 && newPassword.length < 10 && (
                <p className="text-xs text-destructive">Must be at least 10 characters.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password" className="text-xs">
                Confirm
              </Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                data-testid="input-confirm-password"
              />
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => resetPassword.mutate(newPassword)}
              disabled={
                newPassword.length < 10 ||
                newPassword !== confirmPassword ||
                resetPassword.isPending
              }
              data-testid="button-confirm-reset-password"
            >
              {resetPassword.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
