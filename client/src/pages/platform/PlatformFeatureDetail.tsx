/**
 * Feature Detail / Edit — /platform/features/:featureId (2026-04-19).
 * feature_key is shown read-only. Everything else editable.
 */
import { useRoute } from "wouter";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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

export default function PlatformFeatureDetail() {
  const [, params] = useRoute("/platform/features/:featureId");
  const featureId = params?.featureId as string;
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: feature, isLoading } = useQuery<Feature>({
    queryKey: [`/api/platform/features/${featureId}`],
    queryFn: () => apiRequest(`/api/platform/features/${featureId}`),
    enabled: !!featureId,
  });

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("users_team");
  const [limitType, setLimitType] = useState("none");
  const [isCore, setIsCore] = useState(false);
  const [active, setActive] = useState(true);
  const [sortOrder, setSortOrder] = useState("0");

  useEffect(() => {
    if (!feature) return;
    setDisplayName(feature.displayName);
    setDescription(feature.description ?? "");
    setCategory(feature.category);
    setLimitType(feature.limitType);
    setIsCore(feature.isCore);
    setActive(feature.active);
    setSortOrder(String(feature.sortOrder));
  }, [feature]);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/api/platform/features/${featureId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/platform/features/${featureId}`] });
      qc.invalidateQueries({ queryKey: ["/api/platform/features"] });
      toast({ title: "Feature updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !feature) return <PlatformLayout><p>Loading…</p></PlatformLayout>;

  return (
    <PlatformLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-title font-semibold">{feature.displayName}</h2>
          <p className="text-sm text-muted-foreground"><span className="font-mono">{feature.featureKey}</span></p>
        </div>
        <div className="flex gap-2">
          {feature.isCore && <Badge variant="outline">Core</Badge>}
          <Badge variant={feature.active ? "secondary" : "outline"}>{feature.active ? "Active" : "Inactive"}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Feature configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>feature_key</Label>
            <Input value={feature.featureKey} disabled className="font-mono" />
            <p className="text-helper text-muted-foreground mt-1">feature_key is immutable. All enforcement logic keys off this value.</p>
          </div>
          <div>
            <Label htmlFor="displayName">Display name</Label>
            <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="isCore">Core</Label>
              <Switch id="isCore" checked={isCore} onCheckedChange={setIsCore} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="active">Active</Label>
              <Switch id="active" checked={active} onCheckedChange={setActive} />
            </div>
            <div>
              <Label htmlFor="sortOrder">Sort order</Label>
              <Input id="sortOrder" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end pt-3">
            <Button
              disabled={update.isPending}
              onClick={() => update.mutate({
                displayName,
                description: description || null,
                category,
                limitType,
                isCore,
                active,
                sortOrder: Number(sortOrder) || 0,
              })}
            >Save</Button>
          </div>
        </CardContent>
      </Card>
    </PlatformLayout>
  );
}
