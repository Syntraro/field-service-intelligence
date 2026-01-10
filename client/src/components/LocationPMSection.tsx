import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2, Calendar, Package, Wrench, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LocationPMPlan, LocationPMPartTemplate, Item } from "@shared/schema";
import LocationEquipmentSection from "./LocationEquipmentSection";

interface LocationPMSectionProps {
  locationId: string;
}

const MONTHS = [
  { key: "pmJan", label: "Jan", month: 0 },
  { key: "pmFeb", label: "Feb", month: 1 },
  { key: "pmMar", label: "Mar", month: 2 },
  { key: "pmApr", label: "Apr", month: 3 },
  { key: "pmMay", label: "May", month: 4 },
  { key: "pmJun", label: "Jun", month: 5 },
  { key: "pmJul", label: "Jul", month: 6 },
  { key: "pmAug", label: "Aug", month: 7 },
  { key: "pmSep", label: "Sep", month: 8 },
  { key: "pmOct", label: "Oct", month: 9 },
  { key: "pmNov", label: "Nov", month: 10 },
  { key: "pmDec", label: "Dec", month: 11 },
] as const;

const PM_TYPES = [
  { value: "full", label: "Full HVAC PM" },
  { value: "filters_only", label: "Filters Only" },
  { value: "quarterly", label: "Quarterly Service" },
  { value: "annual", label: "Annual Inspection" },
  { value: "custom", label: "Custom" },
];

export default function LocationPMSection({ locationId }: LocationPMSectionProps) {
  const { toast } = useToast();
  const [isAddingPart, setIsAddingPart] = useState(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [pmPlanDirty, setPmPlanDirty] = useState(false);
  
  const [newPart, setNewPart] = useState({
    productId: "",
    quantityPerVisit: "1",
    descriptionOverride: "",
    equipmentLabel: "",
  });

  const { data: pmPlan, isLoading: pmPlanLoading } = useQuery<LocationPMPlan | null>({
    queryKey: ["/api/locations", locationId, "pm-plan"],
  });

  const { data: pmParts = [], isLoading: pmPartsLoading } = useQuery<LocationPMPartTemplate[]>({
    queryKey: ["/api/locations", locationId, "pm-parts"],
  });

  const { data: productsResponse } = useQuery<{ items: Item[]; total: number }>({
    queryKey: ["/api/items"],
  });
  const products = productsResponse?.items ?? [];

  const [localPlan, setLocalPlan] = useState<Partial<LocationPMPlan>>({});
  
  const effectivePlan = { ...pmPlan, ...localPlan };

  const savePlanMutation = useMutation({
    mutationFn: async (data: Partial<LocationPMPlan>) => {
      return await apiRequest(`/api/locations/${locationId}/pm-plan`, { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "pm-plan"] });
      setLocalPlan({});
      setPmPlanDirty(false);
      toast({
        title: "PM Plan Saved",
        description: "The preventative maintenance schedule has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save PM plan.",
        variant: "destructive",
      });
    },
  });

  const addPartMutation = useMutation({
    mutationFn: async (data: typeof newPart) => {
      return await apiRequest(`/api/locations/${locationId}/pm-parts`, { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "pm-parts"] });
      setNewPart({ productId: "", quantityPerVisit: "1", descriptionOverride: "", equipmentLabel: "" });
      setIsAddingPart(false);
      toast({
        title: "Part Added",
        description: "The PM part template has been added.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add PM part.",
        variant: "destructive",
      });
    },
  });

  const updatePartMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<LocationPMPartTemplate> }) => {
      return await apiRequest(`/api/locations/${locationId}/pm-parts/${id}`, { method: "PUT", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "pm-parts"] });
      setEditingPartId(null);
      toast({
        title: "Part Updated",
        description: "The PM part template has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update PM part.",
        variant: "destructive",
      });
    },
  });

  const deletePartMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/locations/${locationId}/pm-parts/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "pm-parts"] });
      toast({
        title: "Part Removed",
        description: "The PM part template has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove PM part.",
        variant: "destructive",
      });
    },
  });

  const generateJobMutation = useMutation({
    mutationFn: async (date: string) => {
      return await apiRequest(`/api/locations/${locationId}/generate-pm-job`, { method: "POST", body: JSON.stringify({ date }) });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: "PM Job Created",
        description: `Created job #${data.job.jobNumber} with ${data.parts.length} parts.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to generate PM job.",
        variant: "destructive",
      });
    },
  });

  const updateLocalPlan = (key: string, value: any) => {
    setLocalPlan(prev => ({ ...prev, [key]: value }));
    setPmPlanDirty(true);
  };

  const handleSavePlan = () => {
    savePlanMutation.mutate({
      ...pmPlan,
      ...localPlan,
      locationId,
    });
  };

  const getSelectedMonths = () => {
    return MONTHS.filter(m => effectivePlan[m.key as keyof typeof effectivePlan]).map(m => m.label);
  };

  const getPartDescription = (part: LocationPMPartTemplate) => {
    if (part.descriptionOverride) return part.descriptionOverride;
    const product = products.find(p => p.id === part.productId);
    return product?.name || product?.description || "Unknown Part";
  };

  if (pmPlanLoading || pmPartsLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Preventative Maintenance Schedule
          </CardTitle>
          <CardDescription>
            Configure which months this location receives scheduled PM visits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Switch
                id="has-pm"
                checked={effectivePlan.hasPm ?? false}
                onCheckedChange={(checked) => updateLocalPlan("hasPm", checked)}
                data-testid="switch-has-pm"
              />
              <Label htmlFor="has-pm" className="font-medium">
                Has Preventative Maintenance
              </Label>
            </div>
            {pmPlanDirty && (
              <Button 
                onClick={handleSavePlan} 
                disabled={savePlanMutation.isPending}
                data-testid="button-save-pm-plan"
              >
                {savePlanMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            )}
          </div>

          {!effectivePlan.hasPm && (
            <p className="text-sm text-muted-foreground">
              This location is serviced on an as-needed basis only.
            </p>
          )}

          {effectivePlan.hasPm && (
            <>
              <div className="space-y-3">
                <Label>PM Type</Label>
                <Select
                  value={effectivePlan.pmType || ""}
                  onValueChange={(value) => updateLocalPlan("pmType", value)}
                >
                  <SelectTrigger className="w-full max-w-xs" data-testid="select-pm-type">
                    <SelectValue placeholder="Select PM type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PM_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label>Scheduled Months</Label>
                <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                  {MONTHS.map(month => {
                    const isChecked = effectivePlan[month.key as keyof typeof effectivePlan] ?? false;
                    return (
                      <Button
                        key={month.key}
                        type="button"
                        variant={isChecked ? "default" : "outline"}
                        size="sm"
                        onClick={() => updateLocalPlan(month.key, !isChecked)}
                        data-testid={`button-month-${month.label.toLowerCase()}`}
                      >
                        {month.label}
                      </Button>
                    );
                  })}
                </div>
                {getSelectedMonths().length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    PM scheduled for: {getSelectedMonths().join(", ")}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <Label htmlFor="pm-notes">Notes</Label>
                <Textarea
                  id="pm-notes"
                  value={effectivePlan.notes || ""}
                  onChange={(e) => updateLocalPlan("notes", e.target.value)}
                  placeholder="Additional notes about PM requirements..."
                  rows={3}
                  data-testid="textarea-pm-notes"
                />
              </div>

              <div className="pt-4 border-t">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" data-testid="button-generate-pm-job">
                      <Wrench className="h-4 w-4 mr-2" />
                      Generate PM Job
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Generate PM Job</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <p className="text-sm text-muted-foreground">
                        Select a date to generate a PM job with all configured parts.
                      </p>
                      <Input
                        type="date"
                        id="pm-job-date"
                        defaultValue={new Date().toISOString().split("T")[0]}
                        data-testid="input-pm-job-date"
                      />
                    </div>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                      </DialogClose>
                      <Button
                        onClick={() => {
                          const dateInput = document.getElementById("pm-job-date") as HTMLInputElement;
                          if (dateInput?.value) {
                            generateJobMutation.mutate(dateInput.value);
                          }
                        }}
                        disabled={generateJobMutation.isPending}
                        data-testid="button-confirm-generate-job"
                      >
                        {generateJobMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Generate Job
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {effectivePlan.hasPm && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Location Parts
              </CardTitle>
              <CardDescription>
                Parts used at each PM visit for this location.
              </CardDescription>
            </div>
            <Button onClick={() => setIsAddingPart(true)} data-testid="button-add-pm-part">
              <Plus className="h-4 w-4 mr-2" />
              Add Part
            </Button>
          </CardHeader>
          <CardContent>
            {pmParts.length === 0 && !isAddingPart ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No PM parts configured. Add parts that are used during each PM visit.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Qty/Visit</TableHead>
                    <TableHead>Equipment</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pmParts.map(part => (
                    <TableRow key={part.id} data-testid={`row-pm-part-${part.id}`}>
                      <TableCell>
                        {products.find(p => p.id === part.productId)?.name || "Unknown"}
                      </TableCell>
                      <TableCell>{getPartDescription(part)}</TableCell>
                      <TableCell>{part.quantityPerVisit}</TableCell>
                      <TableCell>
                        {part.equipmentLabel ? (
                          <Badge variant="secondary">{part.equipmentLabel}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingPartId(part.id)}
                            data-testid={`button-edit-part-${part.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deletePartMutation.mutate(part.id)}
                            disabled={deletePartMutation.isPending}
                            data-testid={`button-delete-part-${part.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {isAddingPart && (
                    <TableRow>
                      <TableCell>
                        <Select
                          value={newPart.productId}
                          onValueChange={(value) => setNewPart(prev => ({ ...prev, productId: value }))}
                        >
                          <SelectTrigger data-testid="select-new-part-product">
                            <SelectValue placeholder="Select product..." />
                          </SelectTrigger>
                          <SelectContent>
                            {products.map(product => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name || product.description || `${product.type}${product.sku ? ` - ${product.sku}` : ''}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={newPart.descriptionOverride}
                          onChange={(e) => setNewPart(prev => ({ ...prev, descriptionOverride: e.target.value }))}
                          placeholder="Override description..."
                          data-testid="input-new-part-description"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="1"
                          step="0.5"
                          value={newPart.quantityPerVisit}
                          onChange={(e) => setNewPart(prev => ({ ...prev, quantityPerVisit: e.target.value }))}
                          className="w-20"
                          data-testid="input-new-part-quantity"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={newPart.equipmentLabel}
                          onChange={(e) => setNewPart(prev => ({ ...prev, equipmentLabel: e.target.value }))}
                          placeholder="RTU #1..."
                          data-testid="input-new-part-equipment"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            onClick={() => addPartMutation.mutate(newPart)}
                            disabled={!newPart.productId || addPartMutation.isPending}
                            data-testid="button-save-new-part"
                          >
                            {addPartMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Add"
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setIsAddingPart(false);
                              setNewPart({ productId: "", quantityPerVisit: "1", descriptionOverride: "", equipmentLabel: "" });
                            }}
                            data-testid="button-cancel-new-part"
                          >
                            Cancel
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Equipment Section */}
      <LocationEquipmentSection locationId={locationId} />
    </div>
  );
}
