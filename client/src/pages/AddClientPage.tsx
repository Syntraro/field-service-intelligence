import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AddClientDialog, { ClientFormData } from "@/components/AddClientDialog";
import AddClientWithCompanyDialog, { ClientWithCompanyFormData } from "@/components/AddClientWithCompanyDialog";
import type { Client } from "@shared/schema";

export default function AddClientPage() {
  const [, setLocation] = useLocation();
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const isEditing = Boolean(id);
  const [activeTab, setActiveTab] = useState<"simple" | "with-company">("with-company");

  const { data: allClients = [] } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const {data: client, isLoading} = useQuery<Client>({
    queryKey: id ? ["/api/clients", id] : [],
    enabled: Boolean(id),
  });

  const calculateNextDueDate = (selectedMonths: number[], inactive: boolean) => {
    if (inactive || selectedMonths.length === 0) return null;
    
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const currentDay = today.getDate();
    
    const sortedMonths = [...selectedMonths].sort((a, b) => a - b);
    
    if (sortedMonths.includes(currentMonth) && currentDay < 15) {
      return new Date(currentYear, currentMonth, 15);
    }
    
    let nextMonth = sortedMonths.find(m => m > currentMonth);
    
    if (nextMonth === undefined) {
      nextMonth = sortedMonths[0];
      return new Date(currentYear + 1, nextMonth, 15);
    }
    
    return new Date(currentYear, nextMonth, 15);
  };

  // Mutation for creating client with company (new QBO-compatible flow)
  const createClientWithCompanyMutation = useMutation({
    mutationFn: async (data: ClientWithCompanyFormData) => {
      return await apiRequest("/api/clients/with-company", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });

      toast({
        title: "Client added",
        description: "The client and company have been added successfully.",
      });
      setLocation("/");
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to add client.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Legacy mutation for simple client creation (backward compatible)
  const createClientMutation = useMutation({
    mutationFn: async (data: ClientFormData) => {
      const nextDue = calculateNextDueDate(data.selectedMonths, data.inactive);
      const clientData = {
        companyName: data.companyName,
        location: data.location,
        address: data.address,
        city: data.city,
        province: data.province,
        postalCode: data.postalCode,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        roofLadderCode: data.roofLadderCode,
        notes: data.notes,
        selectedMonths: data.selectedMonths,
        inactive: data.inactive,
        nextDue: nextDue ? nextDue.toISOString() : new Date('9999-12-31').toISOString(),
        parts: data.parts,
      };
      
      const newClient = await apiRequest("/api/clients", { method: "POST", body: JSON.stringify(clientData) });
      return newClient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });

      toast({
        title: "Client added",
        description: "The client has been added successfully.",
      });
      setLocation("/");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add client.",
        variant: "destructive",
      });
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ClientFormData }) => {
      const nextDue = calculateNextDueDate(data.selectedMonths, data.inactive);
      const clientData = {
        companyName: data.companyName,
        location: data.location,
        address: data.address,
        city: data.city,
        province: data.province,
        postalCode: data.postalCode,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        roofLadderCode: data.roofLadderCode,
        notes: data.notes,
        selectedMonths: data.selectedMonths,
        inactive: data.inactive,
        nextDue: nextDue ? nextDue.toISOString() : new Date('9999-12-31').toISOString(),
      };
      
      const updatedClient = await apiRequest(`/api/clients/${id}`, { method: "PUT", body: JSON.stringify(clientData) });
      return updatedClient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });

      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/recently-completed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/statuses"] });
      toast({
        title: "Client updated",
        description: "The client has been updated successfully.",
      });
      setLocation("/");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update client.",
        variant: "destructive",
      });
    },
  });

  const handleSimpleSubmit = (data: ClientFormData) => {
    if (isEditing && id) {
      updateClientMutation.mutate({ id, data });
    } else {
      createClientMutation.mutate(data);
    }
  };

  const handleWithCompanySubmit = (data: ClientWithCompanyFormData) => {
    createClientWithCompanyMutation.mutate(data);
  };

  const editData = client ? {
    id: client.id,
    companyName: client.companyName,
    location: client.location,
    address: client.address,
    city: client.city,
    province: client.province,
    postalCode: client.postalCode,
    contactName: client.contactName,
    email: client.email,
    phone: client.phone,
    roofLadderCode: client.roofLadderCode,
    notes: client.notes,
    selectedMonths: client.selectedMonths,
    inactive: client.inactive,
  } : undefined;

  if (isEditing && isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container mx-auto p-6">
          <div className="animate-pulse">
            <div className="h-8 bg-muted rounded w-1/4 mb-6"></div>
            <div className="space-y-4">
              <div className="h-10 bg-muted rounded"></div>
              <div className="h-10 bg-muted rounded"></div>
              <div className="h-10 bg-muted rounded"></div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (isEditing && !client) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container mx-auto p-6">
          <p className="text-muted-foreground">Client not found</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto p-6">
        <div className="mb-6 flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {isEditing ? 'Edit Client' : 'Add New Client'}
          </h1>
          <p className="text-muted-foreground">
            {isEditing ? 'Update client information and required parts.' : 'Add a new client with their maintenance schedule and required parts.'}
          </p>
        </div>
      </div>

        {isEditing ? (
          // Use legacy dialog for editing existing clients
          editData ? (
            <AddClientDialog
              onCancel={() => setLocation("/")}
              onSubmit={handleSimpleSubmit}
              editData={editData}
            />
          ) : null
        ) : (
          // For new clients, show tabbed interface with both options
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "simple" | "with-company")}>
            <TabsList className="mb-4">
              <TabsTrigger value="with-company" data-testid="tab-with-company">
                With Company (QBO Ready)
              </TabsTrigger>
              <TabsTrigger value="simple" data-testid="tab-simple">
                Simple Client
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="with-company">
              <AddClientWithCompanyDialog
                onCancel={() => setLocation("/")}
                onSubmit={handleWithCompanySubmit}
                isSubmitting={createClientWithCompanyMutation.isPending}
              />
            </TabsContent>
            
            <TabsContent value="simple">
              <AddClientDialog
                onCancel={() => setLocation("/")}
                onSubmit={handleSimpleSubmit}
              />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
