import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Printer, Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface Part {
  id: string;
  type: string;
  filterType?: string | null;
  beltType?: string | null;
  size?: string | null;
  name?: string | null;
  description?: string | null;
}

interface ClientPart {
  id: string;
  clientId: string;
  partId: string;
  quantity: number;
  part: Part;
}

interface Equipment {
  id: string;
  clientId: string;
  name: string;
  type?: string | null;
  location?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
}

interface Client {
  id: string;
  companyName: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  roofLadderCode?: string | null;
  notes?: string | null;
  selectedMonths: number[];
  inactive: boolean;
  nextDue: string;
}

interface ClientReportData {
  client: Client;
  parts: ClientItem[];
  equipment: Equipment[];
}

interface ClientNote {
  id: string;
  clientId: string;
  companyId: string;
  userId: string;
  noteText: string;
  createdAt: string;
  updatedAt: string | null;
}

interface ClientReportDialogProps {
  clientId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const getPartDisplayName = (part: Part): string => {
  if (part.type === 'filter' && part.filterType && part.size) {
    return `${part.filterType} Filter ${part.size}`;
  } else if (part.type === 'belt' && part.beltType && part.size) {
    return `Belt ${part.beltType}${part.size}`;
  } else if (part.name) {
    return part.name;
  }
  return 'Unknown Part';
};

export default function ClientReportDialog({ clientId, open, onOpenChange }: ClientReportDialogProps) {
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");

  const { data: reportData, isLoading } = useQuery<ClientReportData>({
    queryKey: ['/api/clients', clientId, 'report'],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/report`, {
        credentials: 'include',
      });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch client report: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!clientId && open,
    retry: false,
  });

  const { data: clientNotes = [], isLoading: isLoadingNotes } = useQuery<ClientNote[]>({
    queryKey: ['/api/client-notes', clientId],
    queryFn: async () => {
      const res = await fetch(`/api/client-notes/${clientId}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch client notes: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!clientId && open,
  });

  const createNoteMutation = useMutation({
    mutationFn: async (noteText: string) => {
      return apiRequest('/api/client-notes', {
        method: 'POST',
        body: JSON.stringify({ clientId, noteText }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-notes', clientId] });
      setNewNoteText("");
      setIsAddingNote(false);
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ id, noteText }: { id: string; noteText: string }) => {
      return apiRequest(`/api/client-notes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ noteText }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-notes', clientId] });
      setEditingNoteId(null);
      setEditNoteText("");
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/client-notes/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-notes', clientId] });
    },
  });

  const [, setLocation] = useLocation();

  const handlePrint = () => {
    window.print();
  };

  const handleEdit = () => {
    if (reportData?.client) {
      // Navigate to new client detail page
      onOpenChange(false);
      setLocation(`/clients/${reportData.client.id}`);
    }
  };

  if (!clientId) return null;

  const { client, parts = [], equipment = [] } = reportData || {};
  const pmMonths = client?.selectedMonths.map(m => MONTH_NAMES[m]).join(", ") || "";

  const hasContactInfo = client && (client.contactName || client.email || client.phone || client.address || client.city || client.province || client.postalCode || client.roofLadderCode || client.notes);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b pb-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl font-bold">Client Report</DialogTitle>
            <div className="flex gap-2">
              <Button onClick={handleEdit} size="default" variant="outline" data-testid="button-edit" className="gap-2">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button onClick={handlePrint} data-testid="button-print" size="default" variant="outline" className="gap-2 no-print">
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="p-8">
            <p className="text-center text-muted-foreground">Loading report...</p>
          </div>
        ) : client ? (
          <div className="space-y-6 pt-2">
            {/* Client Information Section */}
            <div className="space-y-3">
              <h2 className="text-xl font-bold">Client Information</h2>
              <div className="grid grid-cols-3 gap-8">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Company Name</p>
                  <p className="text-base font-medium" data-testid="text-company-name">
                    {client.companyName}
                    {client.location && ` - ${client.location}`}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Status</p>
                  <p className="text-base font-medium" data-testid="text-status">
                    {client.inactive ? "Inactive (On-Call)" : "Active"}
                  </p>
                </div>
                {!client.inactive && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Next Maintenance Due</p>
                    <p className="text-base font-medium" data-testid="text-next-due">
                      {format(new Date(client.nextDue), "MMMM d, yyyy")}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Contact Information Section */}
            <div className="space-y-3 border-t pt-6">
              <h2 className="text-xl font-bold">Contact Information</h2>
              {hasContactInfo ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {client.contactName && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Contact Name</p>
                      <p className="text-base" data-testid="text-contact-name">{client.contactName}</p>
                    </div>
                  )}
                  {client.email && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Email</p>
                      <p className="text-base" data-testid="text-email">{client.email}</p>
                    </div>
                  )}
                  {client.phone && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Phone</p>
                      <p className="text-base" data-testid="text-phone">{client.phone}</p>
                    </div>
                  )}
                  {client.address && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Address</p>
                      <p className="text-base" data-testid="text-address">{client.address}</p>
                    </div>
                  )}
                  {client.city && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">City</p>
                      <p className="text-base" data-testid="text-city">{client.city}</p>
                    </div>
                  )}
                  {client.province && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Province/State</p>
                      <p className="text-base" data-testid="text-province">{client.province}</p>
                    </div>
                  )}
                  {client.postalCode && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Postal/Zip Code</p>
                      <p className="text-base" data-testid="text-postal-code">{client.postalCode}</p>
                    </div>
                  )}
                  {client.roofLadderCode && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Roof/Ladder Code</p>
                      <p className="text-base" data-testid="text-roof-ladder-code">{client.roofLadderCode}</p>
                    </div>
                  )}
                  {client.notes && (
                    <div className="md:col-span-4">
                      <p className="text-sm text-muted-foreground mb-1">Notes</p>
                      <p className="text-base" data-testid="text-notes">{client.notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-base text-muted-foreground">No contact information available</p>
              )}
            </div>

            {/* PM Schedule and Parts Inventory Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t pt-6">
              <div className="space-y-3">
                <h2 className="text-xl font-bold">PM Schedule</h2>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Scheduled Months</p>
                  <p className="text-base" data-testid="text-pm-months">
                    {client.inactive ? "On-Call / As-Needed" : pmMonths}
                  </p>
                </div>
              </div>

              {parts.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-xl font-bold">Parts Inventory</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 text-sm font-medium text-muted-foreground">Part Name</th>
                          <th className="text-left py-2 text-sm font-medium text-muted-foreground">Type</th>
                          <th className="text-right py-2 text-sm font-medium text-muted-foreground">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parts.map((clientPart, index) => (
                          <tr key={clientPart.id} className="border-b" data-testid={`row-part-${index}`}>
                            <td className="py-2 text-base">{getPartDisplayName(clientPart.part)}</td>
                            <td className="py-2 text-base capitalize">{clientPart.part.type}</td>
                            <td className="py-2 text-base text-right">{clientPart.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Equipment Section */}
            <div className="space-y-3 border-t pt-6">
              <h2 className="text-xl font-bold">Equipment</h2>
              {equipment.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Equipment Name</th>
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Type</th>
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Location</th>
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Model Number</th>
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Serial Number</th>
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equipment.map((eq, index) => (
                        <tr key={eq.id} className="border-b" data-testid={`row-equipment-${index}`}>
                          <td className="py-2 text-base font-medium">{eq.name}</td>
                          <td className="py-2 text-base">{eq.type || '—'}</td>
                          <td className="py-2 text-base">{eq.location || '—'}</td>
                          <td className="py-2 text-base">{eq.modelNumber || '—'}</td>
                          <td className="py-2 text-base">{eq.serialNumber || '—'}</td>
                          <td className="py-2 text-base">{eq.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No equipment tracked for this client.</p>
              )}
            </div>

            {/* Client Notes Section */}
            <div className="space-y-3 border-t pt-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-bold">Notes</h2>
                {!isAddingNote && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsAddingNote(true)}
                    data-testid="button-add-note"
                    className="gap-1"
                  >
                    <Plus className="h-4 w-4" />
                    Add Note
                  </Button>
                )}
              </div>

              {isAddingNote && (
                <div className="space-y-2 p-3 border rounded-md bg-muted/50">
                  <Textarea
                    placeholder="Enter note..."
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    data-testid="input-new-note"
                    rows={3}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsAddingNote(false);
                        setNewNoteText("");
                      }}
                      data-testid="button-cancel-note"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => createNoteMutation.mutate(newNoteText)}
                      disabled={!newNoteText.trim() || createNoteMutation.isPending}
                      data-testid="button-save-note"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Save
                    </Button>
                  </div>
                </div>
              )}

              {isLoadingNotes ? (
                <p className="text-sm text-muted-foreground">Loading notes...</p>
              ) : clientNotes.length > 0 ? (
                <div className="space-y-3">
                  {clientNotes.map((note) => (
                    <div
                      key={note.id}
                      className="p-3 border rounded-md"
                      data-testid={`note-item-${note.id}`}
                    >
                      {editingNoteId === note.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editNoteText}
                            onChange={(e) => setEditNoteText(e.target.value)}
                            data-testid="input-edit-note"
                            rows={3}
                          />
                          <div className="flex gap-2 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingNoteId(null);
                                setEditNoteText("");
                              }}
                              data-testid="button-cancel-edit"
                            >
                              <X className="h-4 w-4 mr-1" />
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => updateNoteMutation.mutate({ id: note.id, noteText: editNoteText })}
                              disabled={!editNoteText.trim() || updateNoteMutation.isPending}
                              data-testid="button-save-edit"
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-base whitespace-pre-wrap" data-testid={`text-note-${note.id}`}>
                              {note.noteText}
                            </p>
                            <div className="flex gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  setEditingNoteId(note.id);
                                  setEditNoteText(note.noteText);
                                }}
                                data-testid={`button-edit-note-${note.id}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => deleteNoteMutation.mutate(note.id)}
                                disabled={deleteNoteMutation.isPending}
                                data-testid={`button-delete-note-${note.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            {format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}
                            {note.updatedAt && note.updatedAt !== note.createdAt && (
                              <span> (edited {format(new Date(note.updatedAt), "MMM d, yyyy")})</span>
                            )}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No notes for this client.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8">
            <p className="text-center text-muted-foreground">Client not found</p>
          </div>
        )}
      </DialogContent>

    </Dialog>
  );
}
