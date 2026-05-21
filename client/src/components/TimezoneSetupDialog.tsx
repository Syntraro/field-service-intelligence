/**
 * TimezoneSetupDialog — Modal that blocks interaction until the company
 * timezone is explicitly confirmed. Shown once for admin/manager/owner roles
 * when timezoneConfirmedAt is null.
 *
 * Prefills from browser Intl.DateTimeFormat but still requires explicit confirm.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalPrimaryAction,
} from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { TIMEZONE_OPTIONS } from "@/lib/regionalConstants";

interface CompanySettingsTimezone {
  timezone?: string;
  timezoneConfirmed?: boolean;
}

import { MANAGER_ROLES } from "@/lib/roles";

/** Best-guess timezone from the browser */
function getBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Only use it if it's in our options list
    if (TIMEZONE_OPTIONS.some((opt) => opt.value === tz)) {
      return tz;
    }
  } catch {
    // ignore
  }
  return "America/Toronto";
}

export function TimezoneSetupDialog() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedTz, setSelectedTz] = useState(() => getBrowserTimezone());
  // Guard: prevent modal from re-showing during the save → refetch window
  const [justConfirmed, setJustConfirmed] = useState(false);

  const { data: settings, isLoading } = useQuery<CompanySettingsTimezone>({
    queryKey: ["/api/company-settings"],
    staleTime: 5 * 60 * 1000,
  });

  // Prefill from existing settings if available (but not yet confirmed)
  useEffect(() => {
    if (settings?.timezone && !settings.timezoneConfirmed) {
      // Keep browser guess if the DB value is just the default
      const dbTz = settings.timezone;
      const browserTz = getBrowserTimezone();
      // Prefer the browser timezone if the DB still has the default
      setSelectedTz(dbTz === "America/Toronto" ? browserTz : dbTz);
    }
  }, [settings]);

  const confirmMutation = useMutation({
    mutationFn: async (timezone: string) =>
      apiRequest("/api/company-settings", {
        method: "PUT",
        body: JSON.stringify({ timezone }),
      }),
    onSuccess: (data: any) => {
      // Optimistically update the cache so the modal unmounts immediately
      // instead of waiting for the background refetch to complete
      queryClient.setQueryData(["/api/company-settings"], (old: any) => ({
        ...old,
        ...data,
        timezoneConfirmed: true,
      }));
      setJustConfirmed(true);
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      // Domain boundary: timezone change does not invalidate calendar/scheduling caches
      toast({ title: "Timezone confirmed" });
    },
    onError: () => {
      toast({ title: "Failed to save timezone", variant: "destructive" });
    },
  });

  // Only show for manager+ roles when timezone is not confirmed.
  // justConfirmed guard prevents re-showing during the save → refetch window.
  const isManager = user?.role && (MANAGER_ROLES as readonly string[]).includes(user.role);
  const shouldShow = !justConfirmed && !isLoading && settings && !settings.timezoneConfirmed && isManager;

  if (!shouldShow) return null;

  return (
    <ModalShell
      open
      onOpenChange={() => undefined}
      modal
      className="sm:max-w-md"
      onPointerDownOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
    >
      <ModalHeader>
        <ModalTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Set Your Company Timezone
        </ModalTitle>
        <ModalDescription>
          Choose the timezone for your business. This is used for scheduling,
          calendar display, and invoice dates. You can change it later in
          Regional Settings.
        </ModalDescription>
      </ModalHeader>

      <ModalBody>
        <div className="space-y-2">
          <Label htmlFor="setup-timezone">Timezone</Label>
          <Select value={selectedTz} onValueChange={setSelectedTz}>
            <SelectTrigger id="setup-timezone" data-testid="select-setup-timezone">
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
      </ModalBody>

      <ModalFooter>
        <ModalPrimaryAction
          onClick={() => confirmMutation.mutate(selectedTz)}
          disabled={confirmMutation.isPending || !selectedTz}
          data-testid="button-confirm-timezone"
        >
          {confirmMutation.isPending ? "Saving..." : "Confirm Timezone"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
