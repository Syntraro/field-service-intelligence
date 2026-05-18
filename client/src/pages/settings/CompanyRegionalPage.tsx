import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIMEZONE_OPTIONS } from "@/lib/regionalConstants";

const DATE_FORMAT_OPTIONS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
];
const TIME_FORMAT_OPTIONS = [
  { value: "12h", label: "12-hour (AM/PM)" },
  { value: "24h", label: "24-hour" },
];
const WEEK_START_OPTIONS = [
  { value: "monday", label: "Monday" },
  { value: "sunday", label: "Sunday" },
];

interface RegionalSettings {
  timezone?: string;
  dateFormat?: string;
  timeFormat?: string;
  weekStartsOn?: string;
}

export default function CompanyRegionalPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [timezone, setTimezone] = useState("America/Toronto");
  const [dateFormat, setDateFormat] = useState("MM/DD/YYYY");
  const [timeFormat, setTimeFormat] = useState("12h");
  const [weekStartsOn, setWeekStartsOn] = useState("monday");

  const { data: settings, isLoading } = useQuery<RegionalSettings>({
    queryKey: ["/api/company-settings"],
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (settings) {
      if (settings.timezone) setTimezone(settings.timezone);
      if (settings.dateFormat) setDateFormat(settings.dateFormat);
      if (settings.timeFormat) setTimeFormat(settings.timeFormat);
      if (settings.weekStartsOn) setWeekStartsOn(settings.weekStartsOn);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<RegionalSettings>) =>
      apiRequest("/api/company-settings", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (data: any) => {
      queryClient.setQueryData(["/api/company-settings"], (old: any) => ({ ...old, ...data }));
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Regional settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({ timezone, dateFormat, timeFormat, weekStartsOn });
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/settings")}
          data-testid="button-back-settings"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Regional Settings</h1>
          <p className="text-sm text-muted-foreground">Timezone, date format, and locale preferences</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Timezone */}
            <div className="space-y-1.5">
              <Label htmlFor="r-timezone">Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone} disabled={isLoading}>
                <SelectTrigger id="r-timezone" className="h-9" data-testid="select-timezone">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Week starts on */}
            <div className="space-y-1.5">
              <Label htmlFor="r-week-start">Week Starts On</Label>
              <Select value={weekStartsOn} onValueChange={setWeekStartsOn} disabled={isLoading}>
                <SelectTrigger id="r-week-start" className="h-9" data-testid="select-week-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEK_START_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date format */}
            <div className="space-y-1.5">
              <Label htmlFor="r-date-format">Date Format</Label>
              <Select value={dateFormat} onValueChange={setDateFormat} disabled={isLoading}>
                <SelectTrigger id="r-date-format" className="h-9" data-testid="select-date-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FORMAT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Time format */}
            <div className="space-y-1.5">
              <Label htmlFor="r-time-format">Time Format</Label>
              <Select value={timeFormat} onValueChange={setTimeFormat} disabled={isLoading}>
                <SelectTrigger id="r-time-format" className="h-9" data-testid="select-time-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_FORMAT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending || isLoading}
              data-testid="button-save-regional"
            >
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
