/**
 * SettingsPage — Default content rendered in the right panel of SettingsShell
 * when the user navigates to /settings (no sub-section selected).
 * Replaced the former card-grid layout which is now the SettingsShell left nav.
 */
import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="p-4 rounded-full bg-primary/10 mb-4">
        <Settings className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">Select a setting</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        Choose a category from the left panel to view and manage your application settings.
      </p>
    </div>
  );
}
