// Profile tab — canonical identity surface for a selected team member.
// Saves: name + phone via PATCH /api/team/:id, color + note via PUT /api/team/:id/profile.
// isSchedulable switch saves immediately on toggle.
// useCustomSchedule switch saves immediately on toggle.
// Email has its own inline "Update" button (separate from main Save — changing email logs the user out).
//
// 2026-05-20 Scheduling merged: Availability & Scheduling section, Calendar Sync, and
// Shifts & schedule shortcut moved here from the removed member-level Scheduling tab.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  FormField,
  FormLabel,
  FormHelperText,
} from "@/components/ui/form-field";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { CalendarRange, ExternalLink, Save } from "lucide-react";
import { resolveTechnicianColor } from "@shared/colors";
import { CalendarSyncSection } from "./CalendarSyncSection";
import type { TeamMemberDetail } from "./types";

interface Props {
  selectedMemberId: string;
}

export function MemberProfileTab({ selectedMemberId }: Props) {
  const { toast } = useToast();
  const dirty = useUnsavedChanges();

  const { data: member } = useQuery<TeamMemberDetail>({
    queryKey: [`/api/team/${selectedMemberId}`],
    enabled: !!selectedMemberId,
  });
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    color: "#3b82f6",
    note: "",
  });
  const [emailInput, setEmailInput] = useState("");
  const [isSchedulable, setIsSchedulable] = useState(true);
  const [useCustomSchedule, setUseCustomSchedule] = useState(false);

  useEffect(() => {
    if (!member) return;
    setForm({
      firstName: member.firstName ?? "",
      lastName: member.lastName ?? "",
      phone: member.phone ?? "",
      color: member.profile?.color ?? resolveTechnicianColor(member.id, null),
      note: member.profile?.note ?? "",
    });
    setEmailInput(member.email ?? "");
    setIsSchedulable(member.isSchedulable !== false);
    setUseCustomSchedule(member.useCustomSchedule ?? false);
    dirty.markClean();
  }, [member?.id]);

  const setField = <K extends keyof typeof form>(key: K, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
    dirty.markDirty();
  };

  const saveAll = useMutation({
    mutationFn: async () => {
      // Only send the fields this tab owns. Omit booleans (isSchedulable, useCustomSchedule)
      // and roleId — those are owned by their dedicated tabs and save immediately. Sending them
      // here risks a stale-cache overwrite if the user toggles a switch then clicks Save before
      // the cache refetches.
      //
      // Empty strings use `|| undefined` so Zod's min(1) / no-null constraints are not violated.
      await apiRequest(`/api/team/${selectedMemberId}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          fullName: `${form.firstName} ${form.lastName}`.trim() || undefined,
          phone: form.phone || undefined,
        }),
      });
      // Partial profile update — only color/note. Rate fields omitted: Drizzle .set() skips
      // undefined keys so existing laborCostPerHour/billableRatePerHour are never touched.
      await apiRequest(`/api/team/${selectedMemberId}/profile`, {
        method: "PUT",
        body: JSON.stringify({
          color: form.color,
          note: form.note || null,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Profile saved" });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${selectedMemberId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
      dirty.markClean();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  const updateEmail = useMutation({
    mutationFn: async (email: string) =>
      apiRequest(`/api/team/${selectedMemberId}/email`, {
        method: "PUT",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => {
      toast({ title: "Email updated", description: "User will be logged out." });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${selectedMemberId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Email update failed", description: err?.message });
    },
  });

  const saveSchedulable = useMutation({
    mutationFn: async (checked: boolean) =>
      apiRequest(`/api/team/${selectedMemberId}`, {
        method: "PATCH",
        body: JSON.stringify({ isSchedulable: checked }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/team/${selectedMemberId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  const saveCustomSchedule = useMutation({
    mutationFn: async (checked: boolean) =>
      apiRequest(`/api/team/${selectedMemberId}`, {
        method: "PATCH",
        body: JSON.stringify({ useCustomSchedule: checked }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/team/${selectedMemberId}`] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  if (!member) return null;

  return (
    <div className="space-y-3">
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 pb-4 space-y-4">
          {/* Name row — constrained widths so fields don't span the full panel */}
          <div className="flex flex-wrap gap-3">
            <FormField className="flex-1 min-w-[140px] max-w-[220px]">
              <FormLabel htmlFor="profile-first">First name</FormLabel>
              <Input
                id="profile-first"
                value={form.firstName}
                onChange={(e) => setField("firstName", e.target.value)}
                data-testid="input-profile-first-name"
              />
            </FormField>
            <FormField className="flex-1 min-w-[140px] max-w-[220px]">
              <FormLabel htmlFor="profile-last">Last name</FormLabel>
              <Input
                id="profile-last"
                value={form.lastName}
                onChange={(e) => setField("lastName", e.target.value)}
                data-testid="input-profile-last-name"
              />
            </FormField>
          </div>

          {/* Phone — constrained width */}
          <FormField className="max-w-[240px]">
            <FormLabel srOnly htmlFor="profile-phone">Phone</FormLabel>
            <Input
              id="profile-phone"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="(555) 123-4567"
              data-testid="input-profile-phone"
            />
          </FormField>

          {/* Email — constrained width */}
          <FormField className="max-w-[520px]">
            <FormLabel htmlFor="profile-email">Login email</FormLabel>
            <div className="flex gap-2">
              <Input
                id="profile-email"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                data-testid="input-profile-email"
              />
              {emailInput !== member.email && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateEmail.mutate(emailInput)}
                  disabled={updateEmail.isPending || !emailInput}
                  data-testid="button-profile-update-email"
                >
                  {updateEmail.isPending ? "Saving…" : "Update"}
                </Button>
              )}
            </div>
            <FormHelperText>Changing email logs the user out of all sessions.</FormHelperText>
          </FormField>

          {/* Internal notes */}
          <div className="pt-1 border-t max-w-[640px]">
            <FormField>
              <FormLabel htmlFor="profile-note">Internal notes</FormLabel>
              <Textarea
                id="profile-note"
                value={form.note}
                onChange={(e) => setField("note", e.target.value)}
                placeholder="Payroll type, availability notes, etc."
                rows={3}
                data-testid="input-profile-note"
              />
            </FormField>
          </div>

          {/* Save */}
          <div className="flex justify-end items-center gap-2 pt-2 border-t">
            {dirty.isDirty && (
              <span className="text-helper text-muted-foreground">Unsaved changes</span>
            )}
            <Button
              onClick={() => saveAll.mutate()}
              disabled={!dirty.isDirty || saveAll.isPending}
              data-testid="button-profile-save"
            >
              <Save className="h-4 w-4 mr-2" />
              {saveAll.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Availability & Scheduling ─────────────────────────────────────── */}
      <div className="rounded-md border border-card-border bg-card px-4 py-3 space-y-3">
        <p className="text-helper font-semibold uppercase tracking-wide text-muted-foreground">
          Availability &amp; Scheduling
        </p>

        {/* Dispatch visibility */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="switch-profile-schedulable" className="text-sm font-medium">
              Show on dispatch calendar
            </Label>
            <p className="text-helper text-muted-foreground mt-0.5">
              When off, this member is hidden from scheduling and dispatch views.
            </p>
          </div>
          <Switch
            id="switch-profile-schedulable"
            checked={isSchedulable}
            onCheckedChange={(checked) => {
              setIsSchedulable(checked);
              saveSchedulable.mutate(checked);
            }}
            disabled={saveSchedulable.isPending}
            data-testid="switch-profile-schedulable"
          />
        </div>

        {/* Calendar colour */}
        <FormField>
          <FormLabel htmlFor="profile-color">Calendar colour</FormLabel>
          <div className="flex items-center gap-3">
            <Input
              id="profile-color"
              type="color"
              value={form.color}
              onChange={(e) => setField("color", e.target.value)}
              className="w-16 h-8 p-1"
              data-testid="input-profile-color"
            />
            <div
              className="h-8 w-20 rounded-md border"
              style={{ backgroundColor: form.color }}
              aria-hidden="true"
            />
          </div>
        </FormField>

        {/* Custom schedule toggle */}
        <div className="flex items-center justify-between gap-4 pt-2 border-t">
          <div>
            <Label htmlFor="switch-custom-schedule" className="text-sm font-medium">
              Custom schedule
            </Label>
            <p className="text-helper text-muted-foreground mt-0.5">
              When on, this member's availability is managed independently from the default
              company schedule.
            </p>
          </div>
          <Switch
            id="switch-custom-schedule"
            checked={useCustomSchedule}
            onCheckedChange={(checked) => {
              setUseCustomSchedule(checked);
              saveCustomSchedule.mutate(checked);
            }}
            disabled={saveCustomSchedule.isPending}
            data-testid="switch-custom-schedule"
          />
        </div>
      </div>

      {/* ── Calendar Sync ────────────────────────────────────────────────────── */}
      <CalendarSyncSection
        userId={selectedMemberId}
        memberFirstName={member.firstName}
      />

      {/* ── Shifts & schedule shortcut ────────────────────────────────────── */}
      <div className="rounded-md border bg-muted/30 px-3 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            Shifts &amp; schedule
          </p>
          <p className="text-helper text-muted-foreground mt-0.5">
            Manage shift templates, recurring shifts, and time-off in the Schedules workspace.
          </p>
        </div>
        <Link href="/team/schedules">
          <Button variant="outline" size="sm" data-testid="link-open-schedules">
            Open Schedules
            <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
