import type { Client } from "@shared/schema";

interface GeocodedClient {
  client: Client;
  coordinates: [number, number]; // [longitude, latitude]
  address: string;
}

interface OptimizedRoute {
  clients: Client[];
  totalDistance: number;
  totalDuration: number;
  order: number[];
}

export class RouteOptimizationService {
  private apiKey: string;
  private baseUrl = "https://api.openrouteservice.org";

  constructor() {
    this.apiKey = process.env.OPENROUTESERVICE_API_KEY || "";
    if (!this.apiKey) {
      console.warn("OPENROUTESERVICE_API_KEY not set. Route optimization will not work.");
    }
  }

  async geocodeFullAddress(fullAddress: string): Promise<[number, number] | null> {
    if (!this.apiKey) {
      throw new Error("OpenRouteService API key not configured");
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/geocode/search?api_key=${this.apiKey}&text=${encodeURIComponent(fullAddress)}&size=1`,
        {
          headers: {
            'Accept': 'application/json'
          }
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const coords = data.features[0].geometry.coordinates;
        return [coords[0], coords[1]]; // [longitude, latitude]
      }

      return null;
    } catch {
      return null;
    }
  }

  async geocodeAddress(address: string, city?: string, province?: string, postalCode?: string): Promise<[number, number] | null> {
    if (!this.apiKey) {
      throw new Error("OpenRouteService API key not configured");
    }

    // Build full address string
    const parts = [address, city, province, postalCode, "Canada"].filter(Boolean);
    const fullAddress = parts.join(", ");

    return this.geocodeFullAddress(fullAddress);
  }

  async geocodeClients(clients: Client[]): Promise<GeocodedClient[]> {
    const geocoded: GeocodedClient[] = [];

    for (const client of clients) {
      // Skip if no address information
      if (!client.address && !client.city) {
        continue;
      }

      const coords = await this.geocodeAddress(
        client.address || "",
        client.city || "",
        client.province || "",
        client.postalCode || ""
      );

      if (coords) {
        geocoded.push({
          client,
          coordinates: coords,
          address: [client.address, client.city, client.province, client.postalCode]
            .filter(Boolean)
            .join(", ")
        });
      }

      // Rate limiting: 40 requests/min = 1 request per 1.5 seconds
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    return geocoded;
  }

  async optimizeRoute(geocodedClients: GeocodedClient[], startLocation?: [number, number]): Promise<OptimizedRoute | null> {
    if (!this.apiKey) {
      throw new Error("OpenRouteService API key not configured");
    }

    if (geocodedClients.length === 0) {
      return null;
    }

    if (geocodedClients.length === 1) {
      return {
        clients: [geocodedClients[0].client],
        totalDistance: 0,
        totalDuration: 0,
        order: [0]
      };
    }

    try {
      // Build optimization request
      const jobs = geocodedClients.map((gc, index) => ({
        id: index + 1,
        service: 3600, // 1 hour service time per location
        location: gc.coordinates
      }));

      const vehicle = {
        id: 1,
        profile: "driving-car",
        start: startLocation || geocodedClients[0].coordinates,
        end: startLocation || geocodedClients[0].coordinates,
        capacity: [1],
        skills: [1]
      };

      const requestBody = {
        jobs: jobs,
        vehicles: [vehicle]
      };

      const response = await fetch(
        `${this.baseUrl}/optimization`,
        {
          method: 'POST',
          headers: {
            'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
            'Content-Type': 'application/json',
            'Authorization': this.apiKey
          },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const steps = route.steps.filter((step: any) => step.type === "job");
        const order = steps.map((step: any) => step.job - 1); // Convert back to 0-indexed
        const optimizedClients = order.map((idx: number) => geocodedClients[idx].client);

        return {
          clients: optimizedClients,
          totalDistance: route.distance || 0,
          totalDuration: route.duration || 0,
          order: order
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}

export const routeOptimizationService = new RouteOptimizationService();
