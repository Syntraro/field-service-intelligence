// 2026-05-05 Team Hub member-centric restructure (v2 — refined).
//
// MemberOverviewPanel — the COMPLETE basic-profile editor for the
// selected member. This is the everyday surface; the long-form
// `/manage-team/:id` page is no longer linked from here in the
// normal flow (kept on disk for compat only).
//
// Editable here:           First name, Last name, Phone
// Read-only here:          Login email, Last login, Joined date
// One-shot actions:        Send password reset email
// Status / role / activate-deactivate:
//                          Live in the workspace header above this
//                          panel. Role is owned exclusively by the
//                          Access tab — no role dropdown lives here.
//
// Save endpoint: PATCH /api/team/:userId — same shape used by every
// other writer. Unchanged from v1.
// Password reset: POST /api/team/:userId/send-password-reset — the
// canonical admin-triggered email flow (no admin sees or sets the
// password; user receives a one-shot reset link).
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { AlertCircle, Save, KeyRound } from "lucide-react";
import type { TeamMemberDetail } from "./types";
// 2026-05-05 v3 follow-up: Calendar Sync (per-user ICS subscription)
// is restored to Overview. The component itself is the canonical
// implementation that previously lived on `/manage-team/:id`; it
// owns its own queries / mutations against the existing
// /api/team/:userId/calendar-token endpoints. We just mount it.
import { CalendarSyncSection } from "./CalendarSyncSection";

interface Props {
  selectedMemberId: string | null;
}

export function MemberOverviewPanel({ selectedMemberId }: Props) {
  const { toast } = useToast();
  const dirty = useUnsavedChanges();

  const { data: member, isFetching } = useQuery<TeamMemberDetail>({
    queryKey: [`/api/team/${selectedMemberId}`],
    enabled: !!selectedMemberId,
  });

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
  });

  useEffect(() => {
    if (!member) return;
    setForm({
      firstName: member.firstName ?? "",
      lastName: member.lastName ?? "",
      phone: member.phone ?? "",
    });
    dirty.markClean();
  }, [member?.id]);

  const setField = <K extends keyof typeof form>(key: K, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
    dirty.markDirty();
  };

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!member) throw new Error("No member loaded");
      return await apiRequest(`/api/team/${selectedMemberId}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: form.firstName.trim() || null,
          lastName: form.lastName.trim() || null,
          phone: form.phone.trim() || null,
          // Preserve fields that aren't editable on this panel — role
          // lives in the Access tab, schedulability in the Schedule
          // tab, etc. We pass them back so the PATCH validator
          // doesn't see them as cleared.
          fullName: member.fullName ?? undefined,
          roleId: member.roleId ?? undefined,
          useCustomSchedule: member.useCustomSchedule,
          isSchedulable: member.isSchedulable,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Profile saved" });
      queryClient.invalidateQueries({
        queryKey: [`/api/team/${selectedMemberId}`],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      dirty.markClean();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  const sendPasswordReset = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/team/${selectedMemberId}/send-password-reset`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({
        title: "Password reset email sent",
        description: "The user will receive a one-shot reset link.",
      });
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Could not send reset email",
        description: err?.message,
      });
    },
  });

  if (!selectedMemberId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Select a team member to view their profile.
        </CardContent>
      </Card>
    );
  }
  if (isFetching && !member) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    );
  }
  if (!member) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-destructive flex items-center justify-center gap-2">
          <AlertCircle className="h-4 w-4" /> Could not load this member.
        </CardContent>
      </Card>
    );
  }

  const lastLogin = member.lastLoginAt
    ? format(new Date(member.lastLoginAt), "MMM d, yyyy 'at' h:mm a")
    : "Never";
  const joinedDate = member.createdAt
    ? format(new Date(member.createdAt), "MMM d, yyyy")
    : "—";

  return (
    <div className="space-y-4">
    <Card data-testid="member-overview-panel">
      <CardContent className="pt-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="overview-first">First name</Label>
            <Input
              id="overview-first"
              value={form.firstName}
              onChange={(e) => setField("firstName", e.target.value)}
              data-testid="input-overview-first-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="overview-last">Last name</Label>
            <Input
              id="overview-last"
              value={form.lastName}
              onChange={(e) => setField("lastName", e.target.value)}
              data-testid="input-overview-last-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="overview-phone">Phone</Label>
            <Input
              id="overview-phone"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="+1 555-…"
              data-testid="input-overview-phone"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="overview-email">Login email</Label>
            <Input
              id="overview-email"
              value={member.email ?? ""}
              readOnly
              disabled
              className="bg-muted"
              data-testid="input-overview-email"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t">
          <div>
            <p className="text-helper text-muted-foreground">Last login</p>
            <p className="text-sm" data-testid="overview-last-login">
              {lastLogin}
            </p>
          </div>
          <div>
            <p className="text-helper text-muted-foreground">Joined</p>
            <p className="text-sm" data-testid="overview-joined-date">
              {joinedDate}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendPasswordReset.mutate()}
            disabled={sendPasswordReset.isPending}
            data-testid="button-overview-reset-password"
          >
            <KeyRound className="h-4 w-4 mr-2" />
            {sendPasswordReset.isPending ? "Sending…" : "Send password reset"}
          </Button>
          <div className="flex items-center gap-2">
            {dirty.isDirty && (
              <span className="text-helper text-muted-foreground">Unsaved changes</span>
            )}
            <Button
              onClick={() => saveProfile.mutate()}
              disabled={!dirty.isDirty || saveProfile.isPending}
              data-testid="button-overview-save"
            >
              <Save className="h-4 w-4 mr-2" />
              {saveProfile.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Calendar Sync — read-only ICS subscription for the selected
        member. Reuses the canonical CalendarSyncSection (same
        component the legacy profile page mounted) which talks to
        /api/team/:userId/calendar-token + rotate / disable / enable.
        No new endpoints, no scheduling-logic changes. */}
    <CalendarSyncSection
      userId={selectedMemberId}
      memberFirstName={member.firstName}
    />
    </div>
  );
}
