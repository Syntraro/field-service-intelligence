/**
 * Features Catalog — /platform/features (2026-04-19).
 *
 * List of every feature in the catalog grouped by category. Platform admin
 * can create a new feature or jump into a feature's detail to edit metadata.
 * feature_key is set on creation and cannot be edited after.
 */
import { Link } from "wouter";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Feature {
  id: string;
  featureKey: string;
  displayName: string;
  description: string | null;
  category: string;
  limitType: string;
  isCore: boolean;
  active: boolean;
  sortOrder: number;
}

const CATEGORIES = [
  "core", "users_team", "technician_app", "service_hvac",
  "sales_revenue", "integrations", "reporting", "communication", "scale_advanced",
];
const LIMIT_TYPES = [
  "none", "count", "monthly_count", "seat_count", "storage_mb",
  "storage_gb", "branch_count", "per_user", "custom",
];

export default function PlatformFeaturesCatalog() {
  const { data, isLoading } = useQuery<Feature[]>({
    queryKey: ["/api/platform/features"],
    queryFn: () => apiRequest("/api/platform/features"),
  });

  const grouped: Record<string, Feature[]> = {};
  for (const f of data ?? []) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category].push(f);
  }

  return (
    <PlatformLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Features Catalog</h2>
          <p className="text-sm text-muted-foreground">Dynamic feature definitions. feature_key is immutable after creation.</p>
        </div>
        <CreateFeatureDialog />
      </div>

      {isLoading && <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>}

      {!isLoading && Object.keys(grouped).sort().map((cat) => (
        <Card key={cat} className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base capitalize">{cat.replace(/_/g, " ")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {grouped[cat].map((f) => (
                <Link key={f.id} href={`/platform/features/${f.id}`}>
                  <div className="flex items-center gap-4 px-6 py-3 hover:bg-muted/50 cursor-pointer">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{f.displayName}</span>
                        {f.isCore && <Badge variant="outline" className="text-xs">Core</Badge>}
                        {!f.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{f.featureKey}</div>
                    </div>
                    <Badge variant="secondary" className="text-xs">{f.limitType}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </PlatformLayout>
  );
}

function CreateFeatureDialog() {
  const [open, setOpen] = useState(false);
  const [featureKey, setFeatureKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("users_team");
  const [limitType, setLimitType] = useState("none");
  const [isCore, setIsCore] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({
    mutationFn: () => apiRequest("/api/platform/features", {
      method: "POST",
      body: JSON.stringify({ featureKey, displayName, category, limitType, isCore, active: true, sortOrder: 0 }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/features"] });
      toast({ title: "Feature created" });
      setOpen(false);
      setFeatureKey(""); setDisplayName("");
    },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New feature</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create feature</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="key">feature_key</Label>
            <Input id="key" value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} placeholder="e.g. custom_dashboards" className="font-mono" />
            <p className="text-xs text-muted-foreground mt-1">Lowercase snake_case. Immutable after creation.</p>
          </div>
          <div>
            <Label htmlFor="dname">Display name</Label>
            <Input id="dname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Custom Dashboards" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Limit type</Label>
            <Select value={limitType} onValueChange={setLimitType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LIMIT_TYPES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!featureKey || !displayName || create.isPending}
          >Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
