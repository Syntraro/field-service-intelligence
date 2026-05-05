// 2026-04-20 Phase 2 Team Hub: Compensation tab.
// Phase 4 (2026-04-20): selection lifted to TeamHubPage; shared dirty hook.
//
// Left rail = schedulable technicians (same selector pattern as SchedulesTab
// for muscle memory). Right panel = cost rate, billable rate, calendar color,
// internal note. Reuses PUT /api/team/:userId/profile exactly.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertCircle, Save, Search, DollarSign, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { resolveTechnicianColor } from "@shared/colors";
import type { TeamMemberDetail, TeamTechnicianRow } from "./types";

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

interface Props {
  selectedMemberId: string | null;
  onSelectMember: (id: string | null) => void;
  // 2026-05-05 member-centric restructure: when this tab is mounted
  // inside `TeamMemberWorkspace` it must not render its own member
  // sidebar — the workspace already provides a single shared list on
  // the page. Standalone usage keeps the original 260px sidebar.
  hideMemberList?: boolean;
}

export function CompensationTab({ selectedMemberId, onSelectMember, hideMemberList = false }: Props) {
  const { toast } = useToast();
  const dirty = useUnsavedChanges();
  const [search, setSearch] = useState("");

  const { data: technicians = [], isLoading: techsLoading } = useQuery<TeamTechnicianRow[]>({
    queryKey: ["/api/team/technicians"],
  });

  // Local fallback only — see SchedulesTab for the same pattern. We never
  // overwrite the URL just because Compensation can't show a non-tech.
  const displayedId = useMemo(() => {
    if (technicians.length === 0) return null;
    if (selectedMemberId && technicians.some((t) => t.id === selectedMemberId)) {
      return selectedMemberId;
    }
    return technicians[0].id;
  }, [technicians, selectedMemberId]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return technicians;
    return technicians.filter((t) => `${t.fullName} ${t.email}`.toLowerCase().includes(s));
  }, [technicians, search]);

  const { data: member, isFetching } = useQuery<TeamMemberDetail>({
    queryKey: [`/api/team/${displayedId}`],
    enabled: !!displayedId,
  });

  const [form, setForm] = useState({
    laborCostPerHour: "",
    billableRatePerHour: "",
    color: "#3b82f6",
    note: "",
  });

  useEffect(() => {
    if (!member) return;
    setForm({
      laborCostPerHour: member.profile?.laborCostPerHour ?? "",
      billableRatePerHour: member.profile?.billableRatePerHour ?? "",
      color: member.profile?.color ?? resolveTechnicianColor(member.id, null),
      note: member.profile?.note ?? "",
    });
    dirty.markClean();
  }, [member?.id]);

  const setField = <K extends keyof typeof form>(key: K, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
    dirty.markDirty();
  };

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (form.laborCostPerHour && !MONEY_PATTERN.test(form.laborCostPerHour)) {
        throw new Error("Labor cost must be a number with up to 2 decimals");
      }
      if (form.billableRatePerHour && !MONEY_PATTERN.test(form.billableRatePerHour)) {
        throw new Error("Billable rate must be a number with up to 2 decimals");
      }
      return await apiRequest(`/api/team/${displayedId}/profile`, {
        method: "PUT",
        body: JSON.stringify({
          laborCostPerHour: form.laborCostPerHour === "" ? null : form.laborCostPerHour,
          billableRatePerHour: form.billableRatePerHour === "" ? null : form.billableRatePerHour,
          color: form.color,
          note: form.note === "" ? null : form.note,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Compensation updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${displayedId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
      dirty.markClean();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  return (
    <div
      className={
        hideMemberList
          ? "grid grid-cols-1 gap-4"
          : "grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4"
      }
    >
      {!hideMemberList && (
        <Card className="md:sticky md:top-4 md:self-start">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Team</CardTitle>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="pl-8 h-8 text-sm"
                data-testid="input-comp-search"
              />
            </div>
          </CardHeader>
          <CardContent className="px-2 pb-2 max-h-[70vh] overflow-y-auto">
            {techsLoading ? (
              <p className="p-3 text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {search ? "No matches." : "No technicians on the calendar yet."}
              </p>
            ) : (
              <ul className="space-y-1">
                {filtered.map((t) => {
                  const active = t.id === displayedId;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => dirty.confirmLeave(() => onSelectMember(t.id))}
                        className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors ${
                          active ? "bg-primary/10" : "hover:bg-muted"
                        }`}
                        data-testid={`button-comp-select-${t.id}`}
                      >
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback
                            className="text-[10px] text-white"
                            style={{ backgroundColor: resolveTechnicianColor(t.id, t.color) }}
                          >
                            {getMemberInitials({ fullName: t.fullName, email: t.email })}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">
                            {getMemberDisplayName({ fullName: t.fullName, email: t.email })}
                          </div>
                          {t.laborCostPerHour && (
                            <div className="text-xs text-muted-foreground">
                              ${t.laborCostPerHour}/hr cost
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {!displayedId ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select a team member to edit compensation.
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
          <Card>
            {/* 2026-05-05 v2 refinement: when this tab is mounted inside
                <TeamMemberWorkspace>, the workspace header above
                already shows the member's name + email. The "Full
                profile" link is removed from the normal flow per the
                v2 brief — Overview now hosts every basic profile
                field. Standalone usage keeps the inline header. */}
            {!hideMemberList && (
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{getMemberDisplayName(member)}</CardTitle>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <Link href={`/manage-team/${member.id}`}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        if (dirty.isDirty && !window.confirm("Discard unsaved changes?")) {
                          e.preventDefault();
                        }
                      }}
                      data-testid={`button-comp-open-profile-${member.id}`}
                    >
                      Full profile <ExternalLink className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </Link>
                </div>
              </CardHeader>
            )}
            <CardContent className={`space-y-4 ${hideMemberList ? "pt-5" : ""}`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="comp-cost">Labor cost / hour</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      id="comp-cost"
                      type="text"
                      inputMode="decimal"
                      value={form.laborCostPerHour}
                      onChange={(e) => setField("laborCostPerHour", e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                      data-testid="input-comp-cost"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="comp-billable">Billable rate / hour</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      id="comp-billable"
                      type="text"
                      inputMode="decimal"
                      value={form.billableRatePerHour}
                      onChange={(e) => setField("billableRatePerHour", e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                      data-testid="input-comp-billable"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="comp-color">Calendar color</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="comp-color"
                    type="color"
                    value={form.color}
                    onChange={(e) => setField("color", e.target.value)}
                    className="w-16 h-9 p-1"
                    data-testid="input-comp-color"
                  />
                  <div
                    className="h-9 w-24 rounded-md border"
                    style={{ backgroundColor: form.color }}
                    aria-hidden="true"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="comp-note">Internal notes</Label>
                <Textarea
                  id="comp-note"
                  value={form.note}
                  onChange={(e) => setField("note", e.target.value)}
                  placeholder="Payroll type, overtime arrangement, etc."
                  rows={3}
                  data-testid="input-comp-note"
                />
              </div>

              <div className="flex justify-end items-center gap-2 pt-2">
                {dirty.isDirty && (
                  <span className="text-xs text-muted-foreground">Unsaved changes</span>
                )}
                <Button
                  onClick={() => saveProfile.mutate()}
                  disabled={!dirty.isDirty || saveProfile.isPending}
                  data-testid="button-comp-save"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveProfile.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
