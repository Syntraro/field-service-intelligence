import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Building2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export default function Suppliers() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/tasks", { type: "SUPPLIER_VISIT", status: "pending", offset: 0, limit: 50 }],
    queryFn: async () => {
      const res = await fetch("/api/tasks?type=SUPPLIER_VISIT&status=pending&offset=0&limit=50", {
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to fetch supplier visits");
      return res.json();
    },
  });

  const items = Array.isArray((data as any)?.items)
    ? (data as any).items
    : Array.isArray(data)
    ? data
    : [];

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Supplier Visits</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="text-sm text-destructive">Failed to load supplier visits. Please try again.</div>
          ) : items.length === 0 ? (
            <EmptyState icon={Building2} message="No open supplier visits" className="py-8" />
          ) : (
            <div className="space-y-2">
              {items.map((t: any) => (
                <div key={t.id} className="rounded-md border p-3">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs opacity-70">Status: {t.status} • Type: {t.type}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
