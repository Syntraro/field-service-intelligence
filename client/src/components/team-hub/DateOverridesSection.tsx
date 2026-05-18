import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FormField, FormLabel, FormHelperText } from "@/components/ui/form-field";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus } from "lucide-react";
import type { TechnicianScheduleOverrideRow } from "@shared/schema";

interface OverrideListResponse {
  overrides: TechnicianScheduleOverrideRow[];
}

function formatOverrideDate(dateStr: string): string {
  // Parse as noon UTC to avoid day-shift in any local timezone.
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-CA", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function futureYmd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

interface Props {
  selectedMemberId: string;
  disabled?: boolean;
}

export function DateOverridesSection({ selectedMemberId, disabled = false }: Props) {
  const { toast } = useToast();
  const [formDate, setFormDate] = useState("");
  const [formIsWorking, setFormIsWorking] = useState(true);
  const [formNote, setFormNote] = useState("");

  const rangeStart = todayYmd();
  const rangeEnd = futureYmd(60);

  const queryKey = ["/api/team/schedule/overrides", selectedMemberId, rangeStart, rangeEnd] as const;

  const { data, isLoading } = useQuery<OverrideListResponse>({
    queryKey,
    queryFn: () =>
      apiRequest<OverrideListResponse>(
        `/api/team/${selectedMemberId}/schedule/overrides?start=${rangeStart}&end=${rangeEnd}`,
      ),
  });

  const overrides = data?.overrides ?? [];

  const saveOverride = useMutation({
    mutationFn: async () => {
      if (!formDate) throw new Error("Date is required");
      return await apiRequest(`/api/team/${selectedMemberId}/schedule/overrides`, {
        method: "POST",
        body: JSON.stringify({
          overrideDate: formDate,
          isWorking: formIsWorking,
          note: formNote.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Override saved" });
      setFormDate("");
      setFormNote("");
      setFormIsWorking(true);
      queryClient.invalidateQueries({ queryKey: ["/api/team/schedule/overrides", selectedMemberId] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  const removeOverride = useMutation({
    mutationFn: async (overrideId: string) => {
      return await apiRequest(
        `/api/team/${selectedMemberId}/schedule/overrides/${overrideId}`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      toast({ title: "Override removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/team/schedule/overrides", selectedMemberId] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Remove failed", description: err?.message });
    },
  });

  return (
    <div className="space-y-4" data-testid="date-overrides-section">
      {/* Form */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold">Date Overrides</p>
          <p className="text-helper text-muted-foreground mt-0.5">
            Mark a specific date as working or not working, regardless of the weekly schedule.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] gap-3 items-end">
          <FormField>
            <FormLabel srOnly htmlFor="override-date-input">Date</FormLabel>
            <Input
              id="override-date-input"
              type="date"
              value={formDate}
              min={rangeStart}
              onChange={(e) => setFormDate(e.target.value)}
              disabled={disabled}
              data-testid="input-override-date"
            />
          </FormField>

          <div className="flex items-center gap-2 pb-0.5">
            <Switch
              id="override-is-working"
              checked={formIsWorking}
              onCheckedChange={setFormIsWorking}
              disabled={disabled}
              data-testid="switch-override-is-working"
            />
            <Label
              htmlFor="override-is-working"
              className={`text-sm cursor-pointer ${formIsWorking ? "text-foreground" : "text-muted-foreground"}`}
            >
              {formIsWorking ? "Working" : "Not Working"}
            </Label>
          </div>

          <FormField>
            <FormLabel srOnly htmlFor="override-note-input">Note (optional)</FormLabel>
            <Input
              id="override-note-input"
              type="text"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="Note (optional)"
              maxLength={500}
              disabled={disabled}
              data-testid="input-override-note"
            />
          </FormField>

          <Button
            onClick={() => saveOverride.mutate()}
            disabled={disabled || !formDate || saveOverride.isPending}
            size="sm"
            data-testid="button-override-save"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            {saveOverride.isPending ? "Saving…" : "Save Override"}
          </Button>
        </div>
      </div>

      {/* List */}
      <div>
        {isLoading ? (
          <p className="text-helper text-muted-foreground py-2">Loading overrides…</p>
        ) : overrides.length === 0 ? (
          <p className="text-helper text-muted-foreground py-2">
            No date overrides in the next 60 days.
          </p>
        ) : (
          <div className="divide-y border rounded-md" data-testid="override-list">
            {overrides.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-3 px-3 py-2.5"
                data-testid={`override-row-${o.id}`}
              >
                <span className="text-sm font-medium w-44 shrink-0">
                  {formatOverrideDate(o.overrideDate)}
                </span>
                <span
                  className={`text-helper flex-1 ${o.isWorking ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {o.isWorking ? "Working" : "Not Working"}
                  {o.note ? <span className="text-muted-foreground"> · {o.note}</span> : null}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeOverride.mutate(o.id)}
                  disabled={removeOverride.isPending}
                  data-testid={`button-override-remove-${o.id}`}
                  aria-label={`Remove override for ${formatOverrideDate(o.overrideDate)}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
