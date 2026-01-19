/**
 * TimeAlertSettingsPage
 *
 * Manage time alert thresholds, escalation settings, and digest configuration.
 * Phase 7: Configurable thresholds per company.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  Clock,
  AlertTriangle,
  Calendar,
  Save,
  RotateCcw,
  Loader2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

// ============================================================================
// Types
// ============================================================================

interface TimeAlertSettings {
  id: string | null;
  companyId: string;
  unassignedThresholdMinutes: number;
  untrackedThresholdMinutes: number;
  longRunningThresholdMinutes: number;
  missingClockOutThresholdMinutes: number;
  repeatDaysToEscalate: number;
  digestDayOfWeek: number;
  digestEnabled: boolean;
  isDefault: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DAYS_OF_WEEK = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

// ============================================================================
// Component
// ============================================================================

export default function TimeAlertSettingsPage() {
  const { toast } = useToast();

  // Form state
  const [unassignedThreshold, setUnassignedThreshold] = useState<number>(30);
  const [untrackedThreshold, setUntrackedThreshold] = useState<number>(60);
  const [longRunningThreshold, setLongRunningThreshold] = useState<number>(360);
  const [missingClockOutThreshold, setMissingClockOutThreshold] = useState<number>(720);
  const [repeatDays, setRepeatDays] = useState<number>(3);
  const [digestDay, setDigestDay] = useState<number>(1);
  const [digestEnabled, setDigestEnabled] = useState<boolean>(true);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current settings
  const { data: settings, isLoading } = useQuery<TimeAlertSettings>({
    queryKey: ["/api/time-alerts/settings"],
    queryFn: async () => {
      const response = await fetch("/api/time-alerts/settings");
      if (!response.ok) throw new Error("Failed to fetch settings");
      return response.json();
    },
  });

  // Sync form state when settings are loaded
  useEffect(() => {
    if (settings) {
      setUnassignedThreshold(settings.unassignedThresholdMinutes);
      setUntrackedThreshold(settings.untrackedThresholdMinutes);
      setLongRunningThreshold(settings.longRunningThresholdMinutes);
      setMissingClockOutThreshold(settings.missingClockOutThresholdMinutes);
      setRepeatDays(settings.repeatDaysToEscalate);
      setDigestDay(settings.digestDayOfWeek);
      setDigestEnabled(settings.digestEnabled);
      setHasChanges(false);
    }
  }, [settings]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<TimeAlertSettings>) => {
      return apiRequest("/api/time-alerts/settings", {
        method: "PUT",
        body: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-alerts/settings"] });
      toast({
        title: "Settings saved",
        description: "Time alert settings have been updated.",
      });
      setHasChanges(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save",
        description: error.message || "Could not save settings",
        variant: "destructive",
      });
    },
  });

  // Reset mutation
  const resetMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/time-alerts/settings", {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-alerts/settings"] });
      toast({
        title: "Settings reset",
        description: "Time alert settings have been reset to defaults.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to reset",
        description: error.message || "Could not reset settings",
        variant: "destructive",
      });
    },
  });

  const handleChange = () => {
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate({
      unassignedThresholdMinutes: unassignedThreshold,
      untrackedThresholdMinutes: untrackedThreshold,
      longRunningThresholdMinutes: longRunningThreshold,
      missingClockOutThresholdMinutes: missingClockOutThreshold,
      repeatDaysToEscalate: repeatDays,
      digestDayOfWeek: digestDay,
      digestEnabled,
    });
  };

  const formatMinutesToDisplay = (minutes: number): string => {
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
    return `${hours}h ${mins}m`;
  };

  if (isLoading) {
    return (
      <div className="container max-w-3xl py-6">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6" />
            Time Alert Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure alert thresholds, escalation rules, and weekly digest
          </p>
        </div>
        {settings?.isDefault && (
          <Alert className="w-auto">
            <Info className="h-4 w-4" />
            <AlertDescription>Using default settings</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Alert Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Alert Thresholds
          </CardTitle>
          <CardDescription>
            Set the minimum time before an alert is triggered
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="unassigned">Unassigned Time (minutes/day)</Label>
              <Input
                id="unassigned"
                type="number"
                min="0"
                max="480"
                value={unassignedThreshold}
                onChange={(e) => {
                  setUnassignedThreshold(Number(e.target.value));
                  handleChange();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Alert when a technician has {formatMinutesToDisplay(unassignedThreshold)} of unassigned time entries
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="untracked">Untracked Time (minutes/day)</Label>
              <Input
                id="untracked"
                type="number"
                min="0"
                max="480"
                value={untrackedThreshold}
                onChange={(e) => {
                  setUntrackedThreshold(Number(e.target.value));
                  handleChange();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Alert when worked time exceeds tracked time by {formatMinutesToDisplay(untrackedThreshold)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="longRunning">Long Running Entry (minutes)</Label>
              <Input
                id="longRunning"
                type="number"
                min="60"
                max="1440"
                step="30"
                value={longRunningThreshold}
                onChange={(e) => {
                  setLongRunningThreshold(Number(e.target.value));
                  handleChange();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Alert when a time entry runs for {formatMinutesToDisplay(longRunningThreshold)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="missingClockOut">Missing Clock-Out (minutes)</Label>
              <Input
                id="missingClockOut"
                type="number"
                min="60"
                max="1440"
                step="30"
                value={missingClockOutThreshold}
                onChange={(e) => {
                  setMissingClockOutThreshold(Number(e.target.value));
                  handleChange();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Alert when a work session is open for {formatMinutesToDisplay(missingClockOutThreshold)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Escalation Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Escalation Rules
          </CardTitle>
          <CardDescription>
            Configure when alerts should be escalated for repeat issues
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="repeatDays">Days to Escalate</Label>
            <Input
              id="repeatDays"
              type="number"
              min="2"
              max="14"
              value={repeatDays}
              onChange={(e) => {
                setRepeatDays(Number(e.target.value));
                handleChange();
              }}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              When the same issue occurs {repeatDays} days in a row, the alert will be marked as
              "ESCALATED" to increase visibility
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Digest */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Weekly Digest
          </CardTitle>
          <CardDescription>
            Receive a summary of time tracking metrics each week
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Weekly Digest</Label>
              <p className="text-xs text-muted-foreground">
                Receive an in-app notification with weekly time metrics
              </p>
            </div>
            <Switch
              checked={digestEnabled}
              onCheckedChange={(checked) => {
                setDigestEnabled(checked);
                handleChange();
              }}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="digestDay">Digest Day</Label>
            <Select
              value={String(digestDay)}
              onValueChange={(value) => {
                setDigestDay(Number(value));
                handleChange();
              }}
              disabled={!digestEnabled}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map((day) => (
                  <SelectItem key={day.value} value={String(day.value)}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The digest summarizes the previous week's metrics
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4">
        <Button
          variant="outline"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending || settings?.isDefault}
        >
          {resetMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4 mr-2" />
          )}
          Reset to Defaults
        </Button>

        <Button
          onClick={handleSave}
          disabled={!hasChanges || saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
