/**
 * TimezoneSetupBanner — Persistent banner shown when company timezone has
 * not been explicitly confirmed. Links to Regional Settings.
 */
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Globe } from "lucide-react";
import { Link } from "wouter";

interface CompanySettingsTimezone {
  timezoneConfirmed?: boolean;
}

export function TimezoneSetupBanner() {
  const { data: settings } = useQuery<CompanySettingsTimezone>({
    queryKey: ["/api/company-settings"],
    staleTime: 5 * 60 * 1000,
  });

  // Don't render until data loaded, or if already confirmed
  if (!settings || settings.timezoneConfirmed) {
    return null;
  }

  return (
    <Alert
      variant="warning"
      className="rounded-none border-x-0 border-t-0"
      data-testid="banner-timezone-setup"
    >
      <Globe className="h-4 w-4 text-amber-600" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span className="text-amber-800 dark:text-amber-200">
          Set your company timezone to ensure scheduling accuracy.
        </span>
        <Link
          href="/settings/regional"
          className="text-sm font-medium text-amber-700 dark:text-amber-300 underline underline-offset-2 whitespace-nowrap hover:text-amber-900"
          data-testid="link-timezone-setup"
        >
          Regional Settings
        </Link>
      </AlertDescription>
    </Alert>
  );
}
