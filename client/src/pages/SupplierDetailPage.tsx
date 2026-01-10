import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Star,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supplier, SupplierLocation } from "@shared/schema";
import { AddLocationDialog } from "@/components/suppliers/AddLocationDialog";
import { EditLocationDialog } from "@/components/suppliers/EditLocationDialog";

interface SupplierResponse {
  supplier: Supplier;
  locations: SupplierLocation[];
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const isCreateMode = id === "new";
 
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    website: "",
    isActive: true,
  });

  // Dialog states
  const [addLocationOpen, setAddLocationOpen] = useState(false);
  const [editLocationOpen, setEditLocationOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<SupplierLocation | null>(null);
  const [deleteLocationId, setDeleteLocationId] = useState<string | null>(null);

  // Fetch supplier data (edit mode only)
  const { data, isLoading } = useQuery<SupplierResponse>({
    queryKey: ["/api/suppliers", id],
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch supplier");
      return res.json();
    },
    enabled: !isCreateMode,
  });

  // Set form data from fetched supplier
  useState(() => {
    if (data?.supplier) {
      setFormData({
        name: data.supplier.name || "",
        email: data.supplier.email || "",
        phone: data.supplier.phone || "",
        website: data.supplier.website || "",
        isActive: data.supplier.isActive ?? true,
      });
    }
  });

  const supplier = data?.supplier;
  const locations = data?.locations || [];

  // Create supplier mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("/api/suppliers", {
        method: "POST",
        body: JSON.stringify({ name: data.name }),
      });
      return res;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Supplier created successfully" });
      setLocation(`/suppliers/${data.supplier.id}`);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create supplier",
        variant: "destructive",
      });
    },
  });

  // Update supplier mutation
  const updateMutation = useMutation({
    mutationFn: async (data: Partial<typeof formData>) => {
      return await apiRequest(`/api/suppliers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Supplier updated successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update supplier",
        variant: "destructive",
      });
    },
  });

  // Set location as primary mutation
  const setPrimaryMutation = useMutation({
    mutationFn: async (locationId: string) => {
      return await apiRequest(`/api/suppliers/${id}/locations/${locationId}/primary`, {
        method: "PATCH",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", id] });
      toast({ title: "Primary location updated" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to set primary location",
        variant: "destructive",
      });
    },
  });

  // Delete location mutation
  const deleteLocationMutation = useMutation({
    mutationFn: async (locationId: string) => {
      return await apiRequest(`/api/suppliers/${id}/locations/${locationId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", id] });
      setDeleteLocationId(null);
      toast({ title: "Location deleted successfully" });
    },
    onError: (error: any) => {
      const message = error.message || "Failed to delete location";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Supplier name is required",
        variant: "destructive",
      });
      return;
    }

    if (isCreateMode) {
      createMutation.mutate(formData);
    } else {
      updateMutation.mutate(formData);
    }
  };

  const handleEditLocation = (location: SupplierLocation) => {
    setEditingLocation(location);
    setEditLocationOpen(true);
  };

  const getQboStatusBadge = () => {
    if (!supplier?.qboVendorId) {
      return <Badge variant="outline">Not Linked to QBO</Badge>;
    }
    return <Badge variant="default">Linked to QBO</Badge>;
  };

  if (!isCreateMode && isLoading) {
    return (
      <div className="p-6">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/suppliers")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-semibold">
            {isCreateMode ? "New Supplier" : "Supplier Details"}
          </h1>
        </div>
      </div>

      {/* Supplier Information */}
      <Card>
        <CardHeader>
          <CardTitle>Supplier Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Supplier name"
                disabled={false}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@example.com"
                  disabled={false}
                />
              </div>

              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  disabled={false}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                type="url"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="https://example.com"
                disabled={false}
              />
            </div>

            {!isCreateMode && (
              <>
                <div className="flex items-center justify-between py-2">
                  <Label htmlFor="active">Active</Label>
                  <Switch
                    id="active"
                    checked={formData.isActive}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isActive: checked })
                    }
                    disabled={false}
                  />
                </div>

                <div className="pt-2">
                  <Label>QBO Status</Label>
                  <div className="mt-2">{getQboStatusBadge()}</div>
                  {supplier?.qboSyncStatus === "ERROR" && supplier.qboSyncError && (
                    <p className="text-sm text-destructive mt-2">{supplier.qboSyncError}</p>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            
              <Button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {isCreateMode ? "Create Supplier" : "Save Changes"}
              </Button>
            
            <Button variant="outline" onClick={() => setLocation("/suppliers")}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Locations Section (Edit Mode Only) */}
      {!isCreateMode && supplier && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Locations</CardTitle>
              
                <Button onClick={() => setAddLocationOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Location
                </Button>
              
            </div>
          </CardHeader>
          <CardContent>
            {locations.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No locations yet. Click "Add Location" to create one.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-center">Primary</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((location) => (
                    <TableRow key={location.id}>
                      <TableCell className="font-medium">{location.name}</TableCell>
                      <TableCell>
                        {location.city && location.province ? (
                          <div className="text-sm">
                            {location.city}, {location.province}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {location.contactName || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {location.phone || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {location.isPrimary ? (
                          <Badge variant="default">
                            <Star className="h-3 w-3 mr-1" />
                            Primary
                          </Badge>
                        ) :  (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPrimaryMutation.mutate(location.id)}
                          >
                            Set Primary
                          </Button>
                        
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {location.isActive ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500 mx-auto" />
                        )}
                      </TableCell>
                      
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditLocation(location)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteLocationId(location.id)}
                              disabled={location.isPrimary}
                              title={
                                location.isPrimary
                                  ? "Cannot delete primary location"
                                  : "Delete location"
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      {!isCreateMode && supplier && (
        <>
          <AddLocationDialog
            open={addLocationOpen}
            onOpenChange={setAddLocationOpen}
            supplierId={supplier.id}
          />

          {editingLocation && (
            <EditLocationDialog
              open={editLocationOpen}
              onOpenChange={(open) => {
                setEditLocationOpen(open);
                if (!open) setEditingLocation(null);
              }}
              supplierId={supplier.id}
              location={editingLocation}
            />
          )}

          <AlertDialog
            open={deleteLocationId !== null}
            onOpenChange={() => setDeleteLocationId(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Location</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this location? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteLocationId && deleteLocationMutation.mutate(deleteLocationId)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
