/**
 * Regional Settings Page — Timezone, date/time format, week start preferences.
 * Fetches and saves to /api/company-settings.
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Globe, Save } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { TIMEZONE_OPTIONS } from "@/lib/regionalConstants";

interface CompanySettings {
  timezone?: string;
  dateFormat?: string;
  timeFormat?: string;
  weekStartsOn?: string;
}

const DATE_FORMAT_OPTIONS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (01/28/2026)" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (28/01/2026)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-01-28)" },
];

const TIME_FORMAT_OPTIONS = [
  { value: "12h", label: "12-hour (2:30 PM)" },
  { value: "24h", label: "24-hour (14:30)" },
];

const WEEK_START_OPTIONS = [
  { value: "monday", label: "Monday" },
  { value: "sunday", label: "Sunday" },
];

export default function RegionalSettingsPage() {
  const { toast } = useToast();
  const [timezone, setTimezone] = useState("America/Toronto");
  const [dateFormat, setDateFormat] = useState("MM/DD/YYYY");
  const [timeFormat, setTimeFormat] = useState("12h");
  const [weekStartsOn, setWeekStartsOn] = useState("monday");

  const { data: settings, isLoading } = useQuery<CompanySettings>({
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
    mutationFn: async (data: Partial<CompanySettings>) =>
      apiRequest("/api/company-settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
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
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-regional-title">Regional Settings</h1>
          <p className="text-sm text-muted-foreground">Configure timezone, date/time formats, and calendar preferences.</p>
        </div>
      </div>

      {/* Timezone */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Timezone
          </CardTitle>
          <CardDescription>
            Set the timezone used for scheduling and calendar display.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md space-y-2">
            <Label htmlFor="timezone">Company Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={isLoading}>
              <SelectTrigger id="timezone" data-testid="select-timezone">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Date & Time Format */}
      <Card>
        <CardHeader>
          <CardTitle>Date & Time Format</CardTitle>
          <CardDescription>
            Choose how dates and times are displayed throughout the application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="date-format">Date Format</Label>
              <Select value={dateFormat} onValueChange={setDateFormat} disabled={isLoading}>
                <SelectTrigger id="date-format" data-testid="select-date-format">
                  <SelectValue placeholder="Select date format" />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FORMAT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="time-format">Time Format</Label>
              <Select value={timeFormat} onValueChange={setTimeFormat} disabled={isLoading}>
                <SelectTrigger id="time-format" data-testid="select-time-format">
                  <SelectValue placeholder="Select time format" />
                </SelectTrigger>
                <SelectContent>
                  {TIME_FORMAT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Week Start */}
      <Card>
        <CardHeader>
          <CardTitle>Calendar Week Start</CardTitle>
          <CardDescription>
            Choose which day the calendar week begins on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md space-y-2">
            <Label htmlFor="week-start">Week Starts On</Label>
            <Select value={weekStartsOn} onValueChange={setWeekStartsOn} disabled={isLoading}>
              <SelectTrigger id="week-start" data-testid="select-week-start">
                <SelectValue placeholder="Select week start" />
              </SelectTrigger>
              <SelectContent>
                {WEEK_START_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="pt-2">
        <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-regional">
          <Save className="h-4 w-4 mr-2" />
          {updateMutation.isPending ? "Saving..." : "Save Regional Settings"}
        </Button>
      </div>
    </div>
  );
}
