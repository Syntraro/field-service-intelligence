import { useLocation } from "wouter";
import { MapPin, ExternalLink } from "lucide-react";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { cn } from "@/lib/utils";

const LOCATIONS_SHOWN = 4;

export interface OverviewLocation {
  id: string;
  location?: string | null;
  companyName?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  isPrimary?: boolean | null;
  inactive?: boolean | null;
}

interface ClientLocationsCardProps {
  locations: OverviewLocation[];
  primaryLocationId: string;
  loading?: boolean;
}

function locationLabel(loc: OverviewLocation): string {
  return [loc.location || loc.companyName, loc.address]
    .filter(Boolean)
    .join(" · ") || "—";
}

function locationSub(loc: OverviewLocation): string | null {
  const parts = [loc.city, loc.province].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Locations card for the client right rail.
 * Shows up to LOCATIONS_SHOWN properties with primary/inactive indicators.
 * "View all locations" link navigates to the client detail page.
 */
export function ClientLocationsCard({
  locations,
  primaryLocationId,
  loading,
}: ClientLocationsCardProps) {
  const [, setLocation] = useLocation();

  const shown = locations.slice(0, LOCATIONS_SHOWN);
  const remaining = locations.length - shown.length;

  return (
    <WorkspaceSectionCard
      title="Locations"
      loading={loading}
      empty={!loading && locations.length === 0}
      emptyText="No locations on file."
      data-testid="client-locations-card"
    >
      <div className="rounded-md border border-border bg-inset-surface divide-y divide-border overflow-hidden">
        {shown.map((loc) => {
          const sub = locationSub(loc);
          return (
            <div
              key={loc.id}
              className="px-3 py-2 flex items-start gap-2"
              data-testid={`client-location-${loc.id}`}
            >
              <MapPin
                className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p
                    className={cn(
                      "text-helper text-foreground truncate",
                      loc.inactive && "text-muted-foreground line-through",
                    )}
                  >
                    {locationLabel(loc)}
                  </p>
                  {loc.isPrimary && (
                    <span className="text-[10px] font-medium text-primary bg-primary/10 rounded px-1 py-px shrink-0">
                      Primary
                    </span>
                  )}
                  {loc.inactive && (
                    <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded px-1 py-px shrink-0">
                      Inactive
                    </span>
                  )}
                </div>
                {sub && (
                  <p className="text-[11px] text-muted-foreground">{sub}</p>
                )}
              </div>
            </div>
          );
        })}

        {remaining > 0 && (
          <button
            type="button"
            className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-helper text-brand hover:bg-primary/5 transition-colors"
            onClick={() => setLocation(`/clients/${primaryLocationId}`)}
            data-testid="client-locations-view-all"
          >
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            View {remaining} more location{remaining !== 1 ? "s" : ""}
          </button>
        )}
      </div>
    </WorkspaceSectionCard>
  );
}
