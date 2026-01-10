import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import ProductsServicesManager from "@/components/ProductsServicesManager";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function PartsManagementPage() {
  const { toast } = useToast();

  const seedPartsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("/api/items/seed", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Success",
        description: "Standard parts seeded successfully. Missing parts have been restored (244 filters and belts available).",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to seed standard parts.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto p-6">
        <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Products & Services</h1>
            <p className="text-muted-foreground">Manage your products, services, filters and belts.</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p className="text-xs text-muted-foreground text-right">
              Seed 244 standard filters and belts (sizes 18-70) - duplicates are skipped.
            </p>
            <Button
              onClick={() => seedPartsMutation.mutate()}
              disabled={seedPartsMutation.isPending}
              data-testid="button-seed-parts"
              size="sm"
              variant="outline"
            >
              {seedPartsMutation.isPending ? "Seeding..." : "Seed Standard Parts"}
            </Button>
          </div>
        </div>

        <ProductsServicesManager />
      </main>
    </div>
  );
}
