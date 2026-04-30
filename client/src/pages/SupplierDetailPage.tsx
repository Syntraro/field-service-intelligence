import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// Badge import removed 2026-04-10: QBO status display removed
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supplier, SupplierLocation } from "@shared/schema";
import { AddLocationDialog } from "@/components/suppliers/AddLocationDialog";
import { EditLocationDialog } from "@/components/suppliers/EditLocationDialog";
import { ListSurface, tableRowClass } from "@/components/ui/list-surface";

interface SupplierResponse {
  supplier: Supplier;
  locations: SupplierLocation[];
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const isCreateMode = id === "new";

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    accountNumber: "",
    notes: "",
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

  const supplier = data?.supplier;
  const locations = data?.locations || [];

  // Populate form from supplier record, falling back to primary location for email/phone
  useEffect(() => {
    if (!supplier) return;
    const primary = locations.find((l) => l.isPrimary) ?? locations[0];

    setFormData({
      name: supplier.name || "",
      email: supplier.email || primary?.email || "",
      phone: supplier.phone || primary?.phone || "",
      accountNumber: supplier.accountNumber || "",
      notes: supplier.notes || "",
      isActive: supplier.isActive ?? true,
    });
  }, [supplier?.id, locations]);

  /** Normalize form → API: empty strings become null so the DB stores NULL, not "". */
  const normalizePayload = (data: typeof formData) => ({
    name: data.name.trim(),
    email: data.email.trim() || null,
    phone: data.phone.trim() || null,
    accountNumber: data.accountNumber.trim() || null,
    notes: data.notes.trim() || null,
    isActive: data.isActive,
  });

  // Create supplier mutation
  const createMutation = useMutation({
    mutationFn: async (dataToCreate: typeof formData) => {
      return await apiRequest("/api/suppliers", {
        method: "POST",
        body: JSON.stringify(normalizePayload(dataToCreate)),
      });
    },
    onSuccess: (resp: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Supplier created successfully" });
      setLocation(`/suppliers/${resp.supplier.id}`);
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
    mutationFn: async (data: typeof formData) => {
      return await apiRequest(`/api/suppliers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(normalizePayload(data)),
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

  // Set location as primary mutation with optimistic UI update
  const setPrimaryMutation = useMutation({
    mutationFn: async (locationId: string) => {
      return await apiRequest(`/api/suppliers/${id}/locations/${locationId}/primary`, {
        method: "PATCH",
      });
    },
    onMutate: async (locationId: string) => {
      // Optimistic update: move the star immediately
      await queryClient.cancelQueries({ queryKey: ["/api/suppliers", id] });
      const previous = queryClient.getQueryData<SupplierResponse>(["/api/suppliers", id]);
      if (previous) {
        queryClient.setQueryData<SupplierResponse>(["/api/suppliers", id], {
          ...previous,
          locations: previous.locations.map((l) => ({
            ...l,
            isPrimary: l.id === locationId,
          })),
        });
      }
      return { previous };
    },
    onError: (_err, _locationId, context) => {
      // Roll back on failure
      if (context?.previous) {
        queryClient.setQueryData(["/api/suppliers", id], context.previous);
      }
      toast({
        title: "Error",
        description: "Failed to set primary location",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({ title: "Primary location updated" });
    },
    onSettled: () => {
      // Always refetch to ensure server truth
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", id] });
    },
  });

  // Delete supplier mutation (soft-delete)
  const [showDeleteSupplier, setShowDeleteSupplier] = useState(false);
  const deleteSupplierMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/suppliers/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Supplier deleted" });
      setLocation("/suppliers");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to delete supplier",
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
      const message = error?.message || "Failed to delete location";
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

  if (!isCreateMode && isLoading) {
    return (
      <div className="p-6 bg-app-bg dark:bg-gray-900">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-app-bg dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/suppliers")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold text-foreground">
            {isCreateMode ? "New Supplier" : "Supplier Details"}
          </h1>
        </div>
        {!isCreateMode && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setShowDeleteSupplier(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete Supplier
          </Button>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: Supplier Information */}
         <div className="lg:col-span-4 space-y-6">
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
                  />
                </div>

                <div className="space-y-4">
  <div>
    <Label htmlFor="email">Email</Label>
    <Input
      id="email"
      type="email"
      value={formData.email}
      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
      placeholder="email@example.com"
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
    />
  </div>

  <div>
    <Label htmlFor="accountNumber">Account Number</Label>
    <Input
      id="accountNumber"
      value={formData.accountNumber}
      onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
      placeholder="Optional"
    />
  </div>

  <div>
    <Label htmlFor="notes">Notes</Label>
    <Textarea
      id="notes"
      value={formData.notes}
      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
      placeholder="Payment terms, contact preferences, etc."
      rows={3}
    />
  </div>
</div>
              </div>

                {!isCreateMode && (
                  <div className="flex items-center justify-between py-2">
                    <Label htmlFor="active">Active</Label>
                    <Switch
                      id="active"
                      checked={formData.isActive}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, isActive: checked })
                      }
                    />
                  </div>
                )}
                {/* 2026-04-10: QBO Status section removed — supplier QBO sync is not implemented. */}
              
              <div className="flex gap-2 pt-4">
                <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                  {isCreateMode ? "Create Supplier" : "Save Changes"}
                </Button>
                <Button variant="outline" onClick={() => setLocation("/suppliers")}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>        
        </div>

        {/* RIGHT: Locations */}
        <div className="lg:col-span-8">
          {!isCreateMode && supplier && (
            <ListSurface>
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                <div className="text-sm font-semibold text-foreground">Locations</div>
                <Button onClick={() => setAddLocationOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Location
                </Button>
              </div>

              <div className="p-3">
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
                        <TableHead className="w-[70px] text-center"></TableHead>
                        <TableHead className="w-[60px] text-center"></TableHead>
                        <TableHead className="text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {locations.map((location) => (
                        <TableRow key={location.id} className={tableRowClass}>
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
                            {location.contactName || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            {location.phone || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => !location.isPrimary && setPrimaryMutation.mutate(location.id)}
                              disabled={location.isPrimary || setPrimaryMutation.isPending}
                              title={location.isPrimary ? "Primary location" : "Set as primary"}
                            >
                              <Star className={cn(
                                "h-4 w-4",
                                location.isPrimary ? "text-primary fill-primary" : "text-muted-foreground"
                              )} />
                            </Button>
                          </TableCell>
                          <TableCell className="text-center">
                            <div
                              className={cn(
                                "h-2.5 w-2.5 rounded-full mx-auto",
                                location.isActive ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600"
                              )}
                              title={location.isActive ? "Active" : "Inactive"}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" size="icon" onClick={() => handleEditLocation(location)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteLocationId(location.id)}
                                disabled={location.isPrimary}
                                title={location.isPrimary ? "Cannot delete primary location" : "Delete location"}
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
              </div>
            </ListSurface>
          )}
        </div>
      </div>

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

          <AlertDialog open={deleteLocationId !== null} onOpenChange={() => setDeleteLocationId(null)}>
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

      {/* Delete supplier confirmation */}
      <AlertDialog open={showDeleteSupplier} onOpenChange={setShowDeleteSupplier}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{supplier?.name || "this supplier"}"?
              This will also remove all associated locations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteSupplierMutation.mutate()}
              disabled={deleteSupplierMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSupplierMutation.isPending ? "Deleting..." : "Delete Supplier"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
