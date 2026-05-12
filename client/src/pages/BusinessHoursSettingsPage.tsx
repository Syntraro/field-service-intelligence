/**
 * Business Hours Settings Page
 *
 * Configure company operating hours for each day of the week.
 * Hours are stored as minutes from midnight (0-1440).
 * Used by Day View to grey out non-business hours and auto-scroll.
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Save } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

// ============================================================================
// Types
// ============================================================================

interface BusinessHourDay {
  dayOfWeek: number;
  isOpen: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
}

interface BusinessHoursResponse {
  hours: BusinessHourDay[];
}

interface CompanySettingsResponse {
  defaultSchedulingBufferMinutes?: number;
  [key: string]: unknown;
}

// Day names indexed by dayOfWeek (0=Sunday)
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Scheduling buffer pill options. DB CHECK constraint allows 0..240; UI exposes
// the seven values most tenants will actually want.
const BUFFER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "None" },
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 45, label: "45m" },
  { value: 60, label: "1hr" },
  { value: 90, label: "1.5hr" },
  { value: 120, label: "2hr" },
];

// ============================================================================
// Time Utilities
// ============================================================================

/**
 * Convert minutes from midnight to display time (HH:MM format).
 */
function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Generate time options in 15-minute increments.
 * For start times: 00:00 to 23:45
 * For end times: 00:15 to 24:00
 */
function generateTimeOptions(forEnd: boolean = false): { value: number; label: string }[] {
  const options: { value: number; label: string }[] = [];
  const startMins = forEnd ? 15 : 0;
  const endMins = forEnd ? 1440 : 1425; // 24:00 for end, 23:45 for start

  for (let mins = startMins; mins <= endMins; mins += 15) {
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    let label: string;
    if (mins === 1440) {
      label = "24:00 (midnight)";
    } else if (hours === 12) {
      label = `12:${minutes.toString().padStart(2, "0")} PM`;
    } else if (hours === 0) {
      label = `12:${minutes.toString().padStart(2, "0")} AM`;
    } else if (hours > 12) {
      label = `${hours - 12}:${minutes.toString().padStart(2, "0")} PM`;
    } else {
      label = `${hours}:${minutes.toString().padStart(2, "0")} AM`;
    }
    options.push({ value: mins, label });
  }
  return options;
}

const START_TIME_OPTIONS = generateTimeOptions(false);
const END_TIME_OPTIONS = generateTimeOptions(true);

// Default business hours for new state
const DEFAULT_HOURS: BusinessHourDay[] = [
  { dayOfWeek: 0, isOpen: false, startMinutes: null, endMinutes: null },
  { dayOfWeek: 1, isOpen: true, startMinutes: 360, endMinutes: 990 },
  { dayOfWeek: 2, isOpen: true, startMinutes: 360, endMinutes: 990 },
  { dayOfWeek: 3, isOpen: true, startMinutes: 360, endMinutes: 990 },
  { dayOfWeek: 4, isOpen: true, startMinutes: 360, endMinutes: 990 },
  { dayOfWeek: 5, isOpen: true, startMinutes: 360, endMinutes: 990 },
  { dayOfWeek: 6, isOpen: false, startMinutes: null, endMinutes: null },
];

// ============================================================================
// Component
// ============================================================================

export default function BusinessHoursSettingsPage() {
  const { toast } = useToast();
  const [hours, setHours] = useState<BusinessHourDay[]>(DEFAULT_HOURS);

  // Fetch current business hours
  const { data, isLoading } = useQuery<BusinessHoursResponse>({
    queryKey: ["/api/company/business-hours"],
    staleTime: 5 * 60 * 1000,
  });

  // Sync fetched data to local state
  useEffect(() => {
    if (data?.hours && data.hours.length === 7) {
      // Sort by dayOfWeek to ensure correct order
      const sorted = [...data.hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
      setHours(sorted);
    }
  }, [data]);

  // Mutation for saving
  const updateMutation = useMutation({
    mutationFn: async (payload: { hours: BusinessHourDay[] }) =>
      apiRequest("/api/company/business-hours", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (result: any) => {
      // Optimistically update cache
      queryClient.setQueryData(["/api/company/business-hours"], result);
      queryClient.invalidateQueries({ queryKey: ["/api/company/business-hours"] });
      toast({ title: "Business hours saved" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save",
        description: error.message || "Please check your settings and try again.",
        variant: "destructive",
      });
    },
  });

  // ─────────────── Default scheduling buffer ───────────────
  // 2026-04-26: separate read/write through /api/company-settings (the
  // canonical tenant-preferences endpoint). Buffer extends the scheduled
  // block on every newly created job/visit; work duration stays as-picked.
  const { data: settingsData } = useQuery<CompanySettingsResponse>({
    queryKey: ["/api/company-settings"],
    staleTime: 5 * 60 * 1000,
  });
  const bufferMinutes = settingsData?.defaultSchedulingBufferMinutes ?? 0;

  const bufferMutation = useMutation({
    mutationFn: (next: number) =>
      apiRequest("/api/company-settings", {
        method: "PUT",
        body: JSON.stringify({ defaultSchedulingBufferMinutes: next }),
      }),
    onSuccess: (result: any) => {
      queryClient.setQueryData(["/api/company-settings"], result);
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Scheduling buffer saved" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save buffer",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update a single day's open/closed status
  const handleToggleOpen = (dayOfWeek: number, isOpen: boolean) => {
    setHours((prev) =>
      prev.map((day) => {
        if (day.dayOfWeek === dayOfWeek) {
          if (isOpen) {
            // When opening, set default times (9 AM - 5 PM)
            return { ...day, isOpen: true, startMinutes: 540, endMinutes: 1020 };
          } else {
            // When closing, clear times
            return { ...day, isOpen: false, startMinutes: null, endMinutes: null };
          }
        }
        return day;
      })
    );
  };

  // Update a single day's start time
  const handleStartChange = (dayOfWeek: number, startMinutes: number) => {
    setHours((prev) =>
      prev.map((day) => {
        if (day.dayOfWeek === dayOfWeek) {
          // If new start is >= end, push end forward by 60 minutes (or to max)
          let newEnd = day.endMinutes;
          if (newEnd !== null && startMinutes >= newEnd) {
            newEnd = Math.min(startMinutes + 60, 1440);
          }
          return { ...day, startMinutes, endMinutes: newEnd };
        }
        return day;
      })
    );
  };

  // Update a single day's end time
  const handleEndChange = (dayOfWeek: number, endMinutes: number) => {
    setHours((prev) =>
      prev.map((day) => {
        if (day.dayOfWeek === dayOfWeek) {
          // If new end is <= start, push start back by 60 minutes (or to min)
          let newStart = day.startMinutes;
          if (newStart !== null && endMinutes <= newStart) {
            newStart = Math.max(endMinutes - 60, 0);
          }
          return { ...day, startMinutes: newStart, endMinutes };
        }
        return day;
      })
    );
  };

  // Save all hours
  const handleSave = () => {
    // Validate before saving
    for (const day of hours) {
      if (day.isOpen) {
        if (day.startMinutes === null || day.endMinutes === null) {
          toast({
            title: "Invalid hours",
            description: `${DAY_NAMES[day.dayOfWeek]} is open but missing times.`,
            variant: "destructive",
          });
          return;
        }
        if (day.endMinutes <= day.startMinutes) {
          toast({
            title: "Invalid hours",
            description: `${DAY_NAMES[day.dayOfWeek]}: End time must be after start time.`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    updateMutation.mutate({ hours });
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-business-hours-title">
            Business Hours
          </h1>
          <p className="text-sm text-muted-foreground">
            Set your company's operating hours for each day of the week.
          </p>
        </div>
      </div>

      {/* Business Hours Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="space-y-1">
            {hours.map((day) => (
              <div
                key={day.dayOfWeek}
                className="flex items-center gap-3 py-1.5 px-3"
                data-testid={`row-day-${day.dayOfWeek}`}
              >
                {/* Day name */}
                <div className="w-24 text-sm font-medium">{DAY_NAMES[day.dayOfWeek]}</div>

                {/* Open/Closed toggle */}
                <div className="flex items-center gap-2 w-20">
                  <Switch
                    checked={day.isOpen}
                    onCheckedChange={(checked) => handleToggleOpen(day.dayOfWeek, checked)}
                    disabled={isLoading}
                    data-testid={`switch-open-${day.dayOfWeek}`}
                  />
                  <span className={`text-xs ${day.isOpen ? "text-green-600" : "text-muted-foreground"}`}>
                    {day.isOpen ? "Open" : "Closed"}
                  </span>
                </div>

                {/* Time pickers (only shown when open) */}
                {day.isOpen ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={day.startMinutes?.toString() ?? ""}
                      onValueChange={(val) => handleStartChange(day.dayOfWeek, parseInt(val))}
                      disabled={isLoading}
                    >
                      <SelectTrigger className="w-[120px] h-8 text-sm" data-testid={`select-start-${day.dayOfWeek}`}>
                        <SelectValue placeholder="Start" />
                      </SelectTrigger>
                      <SelectContent>
                        {START_TIME_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value.toString()}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">to</span>
                    <Select
                      value={day.endMinutes?.toString() ?? ""}
                      onValueChange={(val) => handleEndChange(day.dayOfWeek, parseInt(val))}
                      disabled={isLoading}
                    >
                      <SelectTrigger className="w-[120px] h-8 text-sm" data-testid={`select-end-${day.dayOfWeek}`}>
                        <SelectValue placeholder="End" />
                      </SelectTrigger>
                      <SelectContent>
                        {END_TIME_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value.toString()}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            ))}
          </div>
          {/* Save */}
          <div className="flex justify-end pt-3 mt-2 border-t">
            <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending || isLoading} data-testid="button-save-business-hours">
              <Save className="h-4 w-4 mr-1.5" />
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Default Scheduling Buffer Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base" data-testid="text-buffer-title">Default Scheduling Buffer</CardTitle>
          <CardDescription>
            Extra time added to every newly scheduled job and visit on top of the
            chosen work duration. Useful for travel, paperwork, or setup. Work
            duration is unchanged — only the scheduled block grows.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Default scheduling buffer">
            {BUFFER_OPTIONS.map((opt) => {
              const selected = bufferMinutes === opt.value;
              return (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  role="radio"
                  aria-checked={selected}
                  disabled={bufferMutation.isPending || (selected && !bufferMutation.isPending)}
                  onClick={() => {
                    if (opt.value === bufferMinutes) return;
                    bufferMutation.mutate(opt.value);
                  }}
                  data-testid={`button-buffer-${opt.value}`}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
