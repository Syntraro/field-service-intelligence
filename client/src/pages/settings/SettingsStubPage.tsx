import { useLocation } from "wouter";
import { ArrowLeft, Construction } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
}

export default function SettingsStubPage({
  title,
  description,
  backHref = "/settings",
  backLabel = "Settings",
}: Props) {
  const [, setLocation] = useLocation();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation(backHref)}
          data-testid="button-back-settings"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>

      {/* Placeholder content */}
      <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
        <Construction className="h-10 w-10 mb-4 opacity-30" />
        <p className="text-sm font-medium">Coming Soon</p>
        <p className="text-helper mt-1">This settings page is under construction.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setLocation(backHref)}
        >
          Back to {backLabel}
        </Button>
      </div>
    </div>
  );
}
