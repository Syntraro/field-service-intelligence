// 2026-04-20 Phase 2 Team Hub: Schedules tab.
// Phase 3 (2026-04-20): default-hours inheritance fix + unsaved-change guard.
// Phase 4 (2026-04-20): selection lifted to TeamHubPage; uses shared
// useUnsavedChanges hook for consistent dirty protection.
//
// The canonical schedule model is INHERITANCE (server/routes/team.ts:320-366,
// server/storage/capacity.ts:417):
//   - if user.useCustomSchedule && workingHours[] populated → custom
//   - else                                                  → company hours
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DAYS_OF_WEEK_FULL } from "@/lib/schedulingConstants";
import { resolveTechnicianColor } from "@shared/colors";
import { Copy, Save, Search, Info, AlertCircle, AlertTriangle } from "lucide-react";
import type { TeamMemberDetail, TeamTechnicianRow } from "./types";

type WorkingHoursState = Array<{
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
  isWorking: boolean;
}>;

interface CompanyBusinessHoursResponse {
  hours: Array<{
    dayOfWeek: number;
    isOpen: boolean;
    startMinutes: number | null;
    endMinutes: number | null;
  }>;
}

const minutesToHHMM = (m: number | null | undefined): string | null => {
  if (m == null) return null;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

const toBaselineHours = (resp: CompanyBusinessHoursResponse | undefined): WorkingHoursState => {
  const byDay = new Map((resp?.hours ?? []).map((h) => [h.dayOfWeek, h]));
  return DAYS_OF_WEEK_FULL.map((d) => {
    const row = byDay.get(d.value);
    return {
      dayOfWeek: d.value,
      isWorking: !!row?.isOpen,
      startTime: minutesToHHMM(row?.startMinutes ?? null),
      endTime: minutesToHHMM(row?.endMinutes ?? null),
    };
  });
};

interface Props {
  selectedMemberId: string | null;
  onSelectMember: (id: string | null) => void;
}

export function SchedulesTab({ selectedMemberId, onSelectMember }: Props) {
  const { toast } = useToast();
  const dirty = useUnsavedChanges();
  const [search, setSearch] = useState("");

  // Request the Schedules-tab variant: active members regardless of calendar
  // visibility (isSchedulable=false). Without includeHidden=true, toggling
  // "Show on calendar" off would remove the member from this list and leave
  // the admin no way to toggle it back on. The key still has
  // "/api/team/technicians" as its prefix so existing invalidations on that
  // key (with exact: false) continue to refresh this query too.
  const { data: technicians = [], isLoading: techsLoading } = useQuery<TeamTechnicianRow[]>({
    queryKey: ["/api/team/technicians", { includeHidden: true }],
    queryFn: () => apiRequest<TeamTechnicianRow[]>("/api/team/technicians?includeHidden=true"),
  });

  const { data: companyHoursResp } = useQuery<CompanyBusinessHoursResponse>({
    queryKey: ["/api/company/business-hours"],
    staleTime: 5 * 60_000,
  });

  const companyBaseline = useMemo(() => toBaselineHours(companyHoursResp), [companyHoursResp]);
  const companyHoursConfigured = useMemo(
    () => companyBaseline.some((d) => d.isWorking),
    [companyBaseline]
  );

  // Resolve which tech to actually display: honor URL state when it points at a
  // schedulable tech, otherwise fall back to the first one. Crucially, this is
  // a *local* fallback — we don't rewrite the URL, so navigating back to a
  // tab that does support the original selection (e.g. Roles & Access) still
  // sees it.
  const displayedId = useMemo(() => {
    if (technicians.length === 0) return null;
    if (selectedMemberId && technicians.some((t) => t.id === selectedMemberId)) {
      return selectedMemberId;
    }
    return technicians[0].id;
  }, [technicians, selectedMemberId]);

  const filteredTechs = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return technicians;
    return technicians.filter((t) =>
      `${t.fullName ?? ""} ${t.email ?? ""}`.toLowerCase().includes(s)
    );
  }, [technicians, search]);

  const { data: member, isFetching: memberFetching } = useQuery<TeamMemberDetail>({
    queryKey: [`/api/team/${displayedId}`],
    enabled: !!displayedId,
  });

  const [hours, setHours] = useState<WorkingHoursState>(companyBaseline);
  const [useCustom, setUseCustom] = useState(false);
  const [isSchedulable, setIsSchedulable] = useState(true);

  // Hydrate editor when the selected member changes or the company baseline arrives.
  useEffect(() => {
    if (!member) return;
    const byDay = new Map(member.workingHours.map((h) => [h.dayOfWeek, h]));
    const hasCustom =
      !!member.useCustomSchedule && member.workingHours.some((h) => h.isWorking);
    setHours(
      hasCustom
        ? DAYS_OF_WEEK_FULL.map((d) => {
            const existing = byDay.get(d.value);
            return {
              dayOfWeek: d.value,
              startTime: existing?.startTime ?? null,
              endTime: existing?.endTime ?? null,
              isWorking: existing?.isWorking ?? false,
            };
          })
        : companyBaseline,
    );
    setUseCustom(!!member.useCustomSchedule);
    setIsSchedulable(member.isSchedulable !== false);
    dirty.markClean();
  }, [member?.id, companyHoursResp]);

  const saveHours = useMutation({
    mutationFn: async (payload: WorkingHoursState) => {
      return await apiRequest(`/api/team/${displayedId}/working-hours`, {
        method: "PUT",
        body: JSON.stringify({ hours: payload }),
      });
    },
    onSuccess: () => {
      toast({ title: "Schedule saved" });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${displayedId}`] });
      queryClient.invalidateQueries({
        queryKey: ["/api/team/technicians/working-hours"],
        exact: false,
      });
      dirty.markClean();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  const savePrefs = useMutation({
    mutationFn: async (patch: { useCustomSchedule?: boolean; isSchedulable?: boolean }) => {
      if (!member) throw new Error("No member loaded");
      return await apiRequest(`/api/team/${displayedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: member.firstName ?? undefined,
          lastName: member.lastName ?? undefined,
          fullName: member.fullName ?? undefined,
          phone: member.phone ?? undefined,
          roleId: member.roleId ?? undefined,
          useCustomSchedule: patch.useCustomSchedule ?? useCustom,
          isSchedulable: patch.isSchedulable ?? isSchedulable,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/team/${displayedId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
      queryClient.invalidateQueries({
        queryKey: ["/api/team/technicians/working-hours"],
        exact: false,
      });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  const setDay = (dayOfWeek: number, field: "startTime" | "endTime" | "isWorking", value: any) => {
    setHours((prev) => prev.map((h) => (h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h)));
    dirty.markDirty();
  };

  const copyMondayToWeekdays = () => {
    const mon = hours.find((h) => h.dayOfWeek === 1);
    if (!mon) return;
    setHours((prev) =>
      prev.map((h) =>
        h.dayOfWeek >= 1 && h.dayOfWeek <= 5
          ? { ...h, startTime: mon.startTime, endTime: mon.endTime, isWorking: mon.isWorking }
          : h
      )
    );
    dirty.markDirty();
    toast({ title: "Copied Monday → weekdays" });
  };

  const onToggleUseCustom = (checked: boolean) => {
    const apply = () => {
      setUseCustom(checked);
      if (checked) {
        const hasSavedCustom = member?.workingHours?.some((h) => h.isWorking);
        if (!hasSavedCustom) {
          setHours(companyBaseline);
          dirty.markDirty();
        }
      } else {
        setHours(companyBaseline);
        dirty.markClean();
      }
      savePrefs.mutate({ useCustomSchedule: checked });
    };
    if (!checked) {
      dirty.confirmLeave(apply, "Discard unsaved schedule changes?");
    } else {
      apply();
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
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
              data-testid="input-sched-tech-search"
            />
          </div>
        </CardHeader>
        <CardContent className="px-2 pb-2 max-h-[70vh] overflow-y-auto">
          {techsLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : filteredTechs.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {search ? "No matches." : "No team members yet."}
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredTechs.map((t) => {
                const active = t.id === displayedId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => dirty.confirmLeave(() => onSelectMember(t.id))}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors ${
                        active ? "bg-primary/10" : "hover:bg-muted"
                      }`}
                      data-testid={`button-sched-select-${t.id}`}
                    >
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarFallback
                          className="text-[10px] text-white"
                          style={{ backgroundColor: resolveTechnicianColor(t.id, t.color) }}
                        >
                          {getMemberInitials({ fullName: t.fullName, email: t.email })}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 truncate text-foreground">
                        {getMemberDisplayName({ fullName: t.fullName, email: t.email })}
                      </span>
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
              Select a team member to edit their schedule.
            </CardContent>
          </Card>
        ) : memberFetching && !member ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">Loading schedule…</CardContent>
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
                <Badge
                  variant={isSchedulable && !member.disabled ? "default" : "secondary"}
                  className={isSchedulable && !member.disabled ? "bg-green-600 hover:bg-green-600" : ""}
                >
                  {member.disabled ? "Disabled" : isSchedulable ? "On calendar" : "Hidden from calendar"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Show on calendar</Label>
                    <p className="text-xs text-muted-foreground">
                      Controls dispatch calendar visibility and assignment dropdowns. Hidden members keep their working hours and can still be edited here.
                    </p>
                  </div>
                  <Switch
                    checked={isSchedulable}
                    onCheckedChange={(checked) => {
                      setIsSchedulable(checked);
                      savePrefs.mutate({ isSchedulable: checked });
                    }}
                    data-testid="switch-sched-schedulable"
                  />
                </div>
                <div className="flex items-center justify-between pt-3 border-t">
                  <div>
                    <Label className="text-sm">Use custom schedule</Label>
                    <p className="text-xs text-muted-foreground">
                      Override company default hours for this member.
                    </p>
                  </div>
                  <Switch
                    checked={useCustom}
                    onCheckedChange={onToggleUseCustom}
                    data-testid="switch-sched-custom"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Weekly hours</CardTitle>
                  {!useCustom && companyHoursConfigured && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Inheriting company default hours — enable "Use custom schedule" to override.
                    </p>
                  )}
                  {!useCustom && !companyHoursConfigured && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Company business hours are not set. Configure them under Settings → Business
                      Hours so new team members have a default schedule.
                    </p>
                  )}
                </div>
                {useCustom && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyMondayToWeekdays}
                    data-testid="button-sched-copy-mon"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Mon → weekdays
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-1">
                {DAYS_OF_WEEK_FULL.map((day) => {
                  const h =
                    hours.find((x) => x.dayOfWeek === day.value) ?? {
                      dayOfWeek: day.value,
                      startTime: null,
                      endTime: null,
                      isWorking: false,
                    };
                  return (
                    <div
                      key={day.value}
                      className="flex items-center gap-4 py-2 border-b last:border-0"
                    >
                      <div className="w-24 text-sm font-medium">{day.label}</div>
                      <Switch
                        checked={h.isWorking}
                        onCheckedChange={(checked) => setDay(day.value, "isWorking", checked)}
                        disabled={!useCustom}
                        data-testid={`switch-sched-day-${day.value}`}
                      />
                      {h.isWorking ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            type="time"
                            value={h.startTime ?? ""}
                            onChange={(e) => setDay(day.value, "startTime", e.target.value)}
                            disabled={!useCustom}
                            className="w-32"
                            data-testid={`input-sched-start-${day.value}`}
                          />
                          <span className="text-muted-foreground text-sm">to</span>
                          <Input
                            type="time"
                            value={h.endTime ?? ""}
                            onChange={(e) => setDay(day.value, "endTime", e.target.value)}
                            disabled={!useCustom}
                            className="w-32"
                            data-testid={`input-sched-end-${day.value}`}
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Off</span>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-end gap-2 pt-4">
                  {dirty.isDirty && useCustom && (
                    <span className="text-xs text-muted-foreground">Unsaved changes</span>
                  )}
                  <Button
                    onClick={() => saveHours.mutate(hours)}
                    disabled={!useCustom || !dirty.isDirty || saveHours.isPending}
                    data-testid="button-sched-save"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {saveHours.isPending ? "Saving…" : "Save Schedule"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
