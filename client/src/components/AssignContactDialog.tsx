/**
 * AssignContactDialog — Assign an existing company contact to a location with roles.
 *
 * Used on the Location page to pick from the company person directory
 * and assign them to the current location with specific roles.
 *
 * API: POST /api/customer-companies/:id/contacts/:contactId/assign
 */
import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { STANDARD_CONTACT_ROLES } from "@/components/ContactFormDialog";

interface AssignContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerCompanyId: string;
  locationId: string;
  assignedPersonIds: string[];
  onSuccess: () => void;
}

export function AssignContactDialog({
  open, onOpenChange, customerCompanyId, locationId, assignedPersonIds, onSuccess,
}: AssignContactDialogProps) {
  const { toast } = useToast();
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());

  const { data: contactsData } = useQuery<{ companyContacts: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }[] }>({
    queryKey: ["/api/customer-companies", customerCompanyId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/customer-companies/${customerCompanyId}/contacts`, { credentials: "include" });
      if (!res.ok) return { companyContacts: [] };
      return res.json();
    },
    enabled: open && Boolean(customerCompanyId),
  });

  const availablePersons = (contactsData?.companyContacts ?? []).filter(p => !assignedPersonIds.includes(p.id));

  const toggleRole = useCallback((role: string) => {
    setSelectedRoles(prev => { const n = new Set(prev); n.has(role) ? n.delete(role) : n.add(role); return n; });
  }, []);

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPersonId) throw new Error("No person selected");
      return apiRequest(`/api/customer-companies/${customerCompanyId}/contacts/${selectedPersonId}/assign`, {
        method: "POST",
        body: JSON.stringify({ locationId, roles: Array.from(selectedRoles) }),
      });
    },
    onSuccess: () => {
      // 2026-04-26: explicit self-invalidation. The parent component also
      // refreshes via its own onSuccess callback today, but a future caller
      // that forgets to wire the callback would otherwise leave the
      // contact lists stale.
      queryClient.invalidateQueries({
        queryKey: ["/api/customer-companies", customerCompanyId, "contacts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", locationId, "contacts"],
      });
      onSuccess();
      onOpenChange(false);
      reset();
      toast({ title: "Contact assigned to location" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to assign contact", variant: "destructive" });
    },
  });

  const reset = () => { setSelectedPersonId(null); setSelectedRoles(new Set()); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Contact to Location</DialogTitle>
          <p className="text-xs text-muted-foreground">Select an existing company contact to assign.</p>
        </DialogHeader>
        <div className="space-y-4">
          {availablePersons.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">All company contacts are already assigned.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Contact</Label>
                <div className="border rounded-md max-h-48 overflow-y-auto">
                  {availablePersons.map(p => (
                    <button key={p.id} className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition-colors ${selectedPersonId === p.id ? "bg-[rgba(118,176,84,0.08)] border-[#76B054]" : "hover:bg-slate-50"}`} onClick={() => setSelectedPersonId(p.id)}>
                      <span className="font-medium text-slate-800">{[p.firstName, p.lastName].filter(Boolean).join(" ") || "Unnamed"}</span>
                      {(p.email || p.phone) && <span className="text-xs text-slate-500 ml-2">{p.email || p.phone}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Roles at this location</Label>
                <div className="flex flex-wrap gap-1.5">
                  {STANDARD_CONTACT_ROLES.map(role => (
                    <button key={role} type="button" onClick={() => toggleRole(role)} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${selectedRoles.has(role) ? "bg-primary text-primary-foreground border-primary" : "bg-white text-muted-foreground border-slate-200 hover:border-slate-400"}`}>
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => assignMutation.mutate()} disabled={!selectedPersonId || assignMutation.isPending}>
            {assignMutation.isPending ? "Assigning..." : "Assign Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
