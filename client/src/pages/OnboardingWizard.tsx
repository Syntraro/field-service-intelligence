import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIMEZONE_OPTIONS } from "@/lib/regionalConstants";

/**
 * 2026-04-19 staged onboarding — required timezone step only.
 *
 * Business hours were removed from required onboarding in this sprint
 * and are seeded silently in server/services/onboardingService.ts.
 *
 * Flow:
 *   1. Owner lands here after public signup (ProtectedRoute redirect).
 *   2. Picks / confirms timezone -> PUT /api/company-settings
 *      auto-stamps company_settings.timezoneConfirmedAt.
 *   3. POST /api/onboarding/complete stamps companies.onboarding_completed_at.
 *   4. setQueryData(["/api/auth/me"], +completedAt) SYNCHRONOUSLY so
 *      ProtectedRoute on / reads the completed timestamp on first mount
 *      (invalidateQueries would refetch async and bounce the owner back
 *      to /onboarding for a flash). Then invalidate the onboarding-state
 *      and company-settings caches, set the sessionStorage flag, and
 *      navigate to /.
 *
 * Wrapped in <AuthLayout> for visual continuity with signup. Lives inside
 * the /onboarding bare-shell branch in App.tsx (no sidebar/header chrome).
 */

interface OnboardingState {
  completed: boolean;
  completedAt: string | null;
  steps: {
    timezone: { done: boolean; value: string | null };
  };
}

function getBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONE_OPTIONS.some((opt) => opt.value === tz)) return tz;
  } catch {
    // ignore
  }
  return "America/Toronto";
}

export default function OnboardingWizard() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  // Non-owners have no business on this page; route guard already
  // excludes them but enforce the invariant here too.
  useEffect(() => {
    if (user && user.role !== "owner") setLocation("/");
  }, [user, setLocation]);

  // Already completed: send straight into the app.
  useEffect(() => {
    if (user?.onboardingCompletedAt) setLocation("/");
  }, [user?.onboardingCompletedAt, setLocation]);

  const { data: state } = useQuery<OnboardingState>({
    queryKey: ["/api/onboarding/state"],
    retry: false,
    staleTime: 0,
  });

  const [selectedTz, setSelectedTz] = useState<string>(() =>
    getBrowserTimezone(),
  );
  useEffect(() => {
    const v = state?.steps.timezone.value;
    if (v) setSelectedTz(v);
  }, [state?.steps.timezone.value]);

  const timezoneMutation = useMutation({
    mutationFn: (timezone: string) =>
      apiRequest("/api/company-settings", {
        method: "PUT",
        body: JSON.stringify({ timezone }),
      }),
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/onboarding/complete", {
        method: "POST",
        body: JSON.stringify({}),
      }),
  });

  const busy = timezoneMutation.isPending || completeMutation.isPending;

  const handleEnterWorkspace = async () => {
    try {
      await timezoneMutation.mutateAsync(selectedTz);
      const result = (await completeMutation.mutateAsync()) as
        | { completedAt?: string | null }
        | undefined;
      const completedAt = result?.completedAt ?? new Date().toISOString();

      // Signal the post-onboarding surface (future tour, welcome toast, etc.)
      try {
        sessionStorage.setItem("onboardingJustCompleted", "1");
      } catch {
        // storage disabled — non-fatal
      }

      // 2026-04-19 routing fix: patch the auth cache SYNCHRONOUSLY so
      // ProtectedRoute on `/` sees the completed timestamp on the very
      // next render. A plain `invalidateQueries` would have triggered an
      // async refetch and ProtectedRoute would read the stale
      // `onboardingCompletedAt: null`, bouncing the user back to
      // `/onboarding` — producing a brief flash of the auth image panel
      // between the wizard and the dashboard.
      queryClient.setQueryData(["/api/auth/me"], (old: any) =>
        old ? { ...old, onboardingCompletedAt: completedAt } : old,
      );
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/state"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });

      toast({ title: "Welcome aboard", description: "Setup complete." });
      setLocation("/");
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Could not finish setup",
        description: err?.message ?? "Please try again.",
      });
    }
  };

  return (
    <AuthLayout>
      <Card>
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-xl">Confirm your timezone</CardTitle>
          <CardDescription>
            Used for scheduling, calendar display, and invoice dates. You can
            change it later in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="space-y-2">
            <Label htmlFor="onboarding-tz">Timezone</Label>
            <Select value={selectedTz} onValueChange={setSelectedTz}>
              <SelectTrigger
                id="onboarding-tz"
                data-testid="select-onboarding-timezone"
              >
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
            <p className="text-helper text-muted-foreground">
              Detected from your browser: {getBrowserTimezone()}
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              data-testid="button-onboarding-enter"
              onClick={handleEnterWorkspace}
              disabled={busy || !selectedTz}
            >
              {busy ? "Setting up..." : "Enter Workspace"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
