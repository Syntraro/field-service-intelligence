import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, Wrench, Edit } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface Equipment {
  id: string;
  clientId: string;
  name: string;
  modelNumber?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface Client {
  id: string;
  companyName: string;
  location?: string | null;
  inactive: boolean;
}

interface EquipmentFormProps {
  equipment: Partial<Equipment> | null;
  onSave: (equipment: Partial<Equipment>) => void;
  onCancel: () => void;
}

function EquipmentForm({ equipment, onSave, onCancel }: EquipmentFormProps) {
  const [formData, setFormData] = useState<Partial<Equipment>>({
    id: equipment?.id,
    name: equipment?.name || '',
    modelNumber: equipment?.modelNumber || '',
    serialNumber: equipment?.serialNumber || '',
    notes: equipment?.notes || '',
  });

  useEffect(() => {
    setFormData({
      id: equipment?.id,
      name: equipment?.name || '',
      modelNumber: equipment?.modelNumber || '',
      serialNumber: equipment?.serialNumber || '',
      notes: equipment?.notes || '',
    });
  }, [equipment]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) return;
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="border rounded-md p-3 space-y-3" data-testid="form-equipment">
      <div className="space-y-2">
        <Label htmlFor="equipment-name">Equipment Name *</Label>
        <Input
          id="equipment-name"
          data-testid="input-equipment-name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Rooftop Unit #1"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="equipment-model">Model #</Label>
          <Input
            id="equipment-model"
            data-testid="input-equipment-model"
            value={formData.modelNumber || ''}
            onChange={(e) => setFormData({ ...formData, modelNumber: e.target.value })}
            placeholder="Model number"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="equipment-serial">Serial #</Label>
          <Input
            id="equipment-serial"
            data-testid="input-equipment-serial"
            value={formData.serialNumber || ''}
            onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
            placeholder="Serial number"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="equipment-notes">Notes</Label>
        <Textarea
          id="equipment-notes"
          data-testid="input-equipment-notes"
          value={formData.notes || ''}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Additional notes or details..."
          rows={2}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCancel}
          data-testid="button-cancel-equipment"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          data-testid="button-save-equipment"
          disabled={!formData.name?.trim()}
        >
          Save Equipment
        </Button>
      </div>
    </form>
  );
}

interface ClientEquipmentSectionProps {
  client: Client;
  equipment: Equipment[];
  onAdd: (clientId: string) => void;
  onEdit: (equipment: Equipment) => void;
  onDelete: (equipmentId: string) => void;
}

function ClientEquipmentSection({ client, equipment, onAdd, onEdit, onDelete }: ClientEquipmentSectionProps) {
  return (
    <Card data-testid={`client-equipment-${client.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{client.companyName}</CardTitle>
            <p className="text-sm text-muted-foreground">{client.location}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onAdd(client.id)}
            data-testid={`button-add-equipment-${client.id}`}
            className="gap-2"
          >
            <Plus className="h-3 w-3" />
            Add Equipment
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {equipment.length === 0 ? (
          <p className="text-sm text-muted-foreground">No equipment tracked for this client.</p>
        ) : (
          <div className="space-y-2">
            {equipment.map((eq, index) => (
              <div
                key={eq.id}
                className="flex items-start gap-2 p-3 border rounded-md"
                data-testid={`equipment-item-${index}`}
              >
                <Wrench className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-medium">{eq.name}</p>
                  {(eq.modelNumber || eq.serialNumber) && (
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {eq.modelNumber && <p>Model: {eq.modelNumber}</p>}
                      {eq.serialNumber && <p>Serial: {eq.serialNumber}</p>}
                    </div>
                  )}
                  {eq.notes && (
                    <p className="text-xs text-muted-foreground italic">{eq.notes}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onEdit(eq)}
                    data-testid={`button-edit-equipment-${index}`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(eq.id)}
                    data-testid={`button-delete-equipment-${index}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function EquipmentList() {
  const { toast } = useToast();
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingEquipment, setEditingEquipment] = useState<Partial<Equipment> | null>(null);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: allEquipment = [] } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
  });

  const createMutation = useMutation({
    mutationFn: async ({ clientId, equipment }: { clientId: string; equipment: Partial<Equipment> }) => {
      return await apiRequest(`/api/clients/${clientId}/equipment`, { method: 'POST', body: JSON.stringify(equipment) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/equipment'] });
      setEditingClientId(null);
      setEditingEquipment(null);
      toast({
        title: "Success",
        description: "Equipment added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add equipment",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, equipment }: { id: string; equipment: Partial<Equipment> }) => {
      return await apiRequest(`/api/equipment/${id}`, { method: 'PUT', body: JSON.stringify(equipment) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/equipment'] });
      setEditingClientId(null);
      setEditingEquipment(null);
      toast({
        title: "Success",
        description: "Equipment updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update equipment",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (equipmentId: string) => {
      await apiRequest(`/api/equipment/${equipmentId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/equipment'] });
      toast({
        title: "Success",
        description: "Equipment deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete equipment",
        variant: "destructive",
      });
    },
  });

  const handleAdd = (clientId: string) => {
    setEditingClientId(clientId);
    setEditingEquipment({ name: '', modelNumber: '', serialNumber: '', notes: '' });
  };

  const handleEdit = (equipment: Equipment) => {
    setEditingClientId(equipment.clientId);
    setEditingEquipment(equipment);
  };

  const handleSave = (equipment: Partial<Equipment>) => {
    if (equipment.id) {
      updateMutation.mutate({ id: equipment.id, equipment });
    } else if (editingClientId) {
      createMutation.mutate({ clientId: editingClientId, equipment });
    }
  };

  const handleDelete = (equipmentId: string) => {
    if (confirm('Are you sure you want to delete this equipment?')) {
      deleteMutation.mutate(equipmentId);
    }
  };

  const handleCancel = () => {
    setEditingClientId(null);
    setEditingEquipment(null);
  };

  const activeClients = clients.filter(c => !c.inactive);

  return (
    <div className="space-y-4">
      {editingClientId && editingEquipment && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {editingEquipment.id ? 'Edit Equipment' : 'Add Equipment'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EquipmentForm
              equipment={editingEquipment}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          </CardContent>
        </Card>
      )}

      {activeClients.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground">No clients yet. Add a client to start tracking equipment.</p>
          </CardContent>
        </Card>
      ) : (
        activeClients
          .sort((a, b) => a.companyName.localeCompare(b.companyName))
          .map(client => (
            <ClientEquipmentSection
              key={client.id}
              client={client}
              equipment={allEquipment.filter(eq => eq.clientId === client.id)}
              onAdd={handleAdd}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))
      )}
    </div>
  );
}
