import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Route, MapPin, Clock, Navigation, Loader2, Home } from "lucide-react";
import { RouteMap } from "./RouteMap";

interface Client {
  id: string;
  companyName: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
}

interface GeocodedClient {
  clientId: string;
  coordinates: [number, number];
  address: string;
}

interface OptimizedRouteResult {
  clients: Client[];
  totalDistance: number;
  totalDuration: number;
  geocodedClients: GeocodedClient[];
  startingCoordinates?: [number, number];
}

interface CompanySettings {
  address?: string | null;
  city?: string | null;
  provinceState?: string | null;
  postalCode?: string | null;
}

interface RouteOptimizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  onApplyRoute: (optimizedClients: Client[]) => void;
}

export function RouteOptimizationDialog({
  open,
  onOpenChange,
  clients,
  onApplyRoute
}: RouteOptimizationDialogProps) {
  const { toast } = useToast();
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRouteResult | null>(null);
  const [startingLocation, setStartingLocation] = useState("");

  // Fetch company settings to populate default starting location
  const { data: companySettings } = useQuery<CompanySettings>({
    queryKey: ['/api/company-settings'],
    enabled: open
  });

  // Auto-fill starting location from company settings when dialog opens
  useEffect(() => {
    if (open && companySettings && !startingLocation) {
      const parts = [
        companySettings.address,
        companySettings.city,
        companySettings.provinceState,
        companySettings.postalCode
      ].filter(Boolean);
      if (parts.length > 0) {
        setStartingLocation(parts.join(", "));
      }
    }
  }, [open, companySettings]);

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/routes/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientIds: clients.map(c => c.id),
          startingLocation: startingLocation || undefined
        })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to optimize route");
      }
      return response.json();
    },
    onSuccess: (data: OptimizedRouteResult) => {
      setOptimizedRoute(data);
      toast({
        title: "Route optimized",
        description: `Optimized route for ${data.clients.length} locations`
      });
    },
    onError: (error: any) => {
      toast({
        title: "Optimization failed",
        description: error.message || "Could not optimize route. Ensure all clients have valid addresses.",
        variant: "destructive"
      });
    }
  });

  const handleOptimize = () => {
    setOptimizedRoute(null);
    optimizeMutation.mutate();
  };

  const handleApply = () => {
    if (optimizedRoute) {
      onApplyRoute(optimizedRoute.clients);
      onOpenChange(false);
      toast({
        title: "Route applied",
        description: "Calendar has been reordered based on the optimized route"
      });
    }
  };

  const handleClose = () => {
    setOptimizedRoute(null);
    onOpenChange(false);
  };

  const formatDistance = (meters: number) => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-route-optimization">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="h-5 w-5" />
            Optimize Route
          </DialogTitle>
          <DialogDescription>
            Calculate the most efficient route for visiting {clients.length} location{clients.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!optimizedRoute && !optimizeMutation.isPending && (
            <>
              <Card className="p-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Home className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <Label htmlFor="starting-location" className="font-medium">Starting Location</Label>
                      <Input
                        id="starting-location"
                        value={startingLocation}
                        onChange={(e) => setStartingLocation(e.target.value)}
                        placeholder="Enter your starting address..."
                        className="mt-2"
                        data-testid="input-starting-location"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Where will you start your route? (e.g., your office or warehouse)
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">Locations to Visit</h4>
                      <div className="space-y-1">
                        {clients.map((client, index) => (
                          <div key={client.id} className="flex items-center gap-2 text-sm">
                            <Badge variant="outline" className="w-8 justify-center">
                              {index + 1}
                            </Badge>
                            <span className="font-medium">{client.companyName}</span>
                            {(client.city || client.address) && (
                              <span className="text-muted-foreground">
                                - {[client.address, client.city].filter(Boolean).join(", ")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t">
                    <p className="text-sm text-muted-foreground">
                      This will use OpenRouteService to calculate the shortest route visiting all locations.
                      Make sure all clients have valid addresses.
                    </p>
                  </div>
                </div>
              </Card>
            </>
          )}

          {optimizeMutation.isPending && (
            <Card className="p-8">
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Geocoding addresses and calculating optimal route...
                </p>
                <p className="text-xs text-muted-foreground">
                  This may take a few moments for {clients.length} locations
                </p>
              </div>
            </Card>
          )}

          {optimizedRoute && (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Navigation className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Distance</p>
                      <p className="text-lg font-semibold" data-testid="text-total-distance">
                        {formatDistance(optimizedRoute.totalDistance)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Clock className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Travel Time</p>
                      <p className="text-lg font-semibold" data-testid="text-travel-time">
                        {formatDuration(optimizedRoute.totalDuration)}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Map Visualization */}
              <Card className="p-4">
                <h4 className="font-medium mb-3">Route Map</h4>
                <RouteMap
                  clients={optimizedRoute.clients}
                  geocodedClients={optimizedRoute.geocodedClients}
                  startingCoordinates={optimizedRoute.startingCoordinates}
                />
              </Card>

              <Card className="p-4">
                <h4 className="font-medium mb-3">Optimized Route Order</h4>
                <div className="space-y-2">
                  {optimizedRoute.clients.map((client, index) => {
                    const geocoded = optimizedRoute.geocodedClients.find(gc => gc.clientId === client.id);
                    return (
                      <div
                        key={client.id}
                        className="flex items-start gap-3 p-2 rounded-lg hover-elevate"
                        data-testid={`optimized-client-${index}`}
                      >
                        <Badge variant="default" className="w-8 justify-center mt-0.5">
                          {index + 1}
                        </Badge>
                        <div className="flex-1">
                          <p className="font-medium">{client.companyName}</p>
                          {geocoded && (
                            <p className="text-sm text-muted-foreground">{geocoded.address}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <Button
              variant="outline"
              onClick={handleClose}
              data-testid="button-cancel-optimization"
            >
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              {!optimizedRoute && (
                <Button
                  onClick={handleOptimize}
                  disabled={optimizeMutation.isPending || clients.length === 0}
                  data-testid="button-calculate-route"
                >
                  {optimizeMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Calculating...
                    </>
                  ) : (
                    <>
                      <Route className="h-4 w-4 mr-2" />
                      Calculate Route
                    </>
                  )}
                </Button>
              )}
              {optimizedRoute && (
                <Button
                  onClick={handleApply}
                  data-testid="button-apply-route"
                >
                  <Route className="h-4 w-4 mr-2" />
                  Apply Route
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
