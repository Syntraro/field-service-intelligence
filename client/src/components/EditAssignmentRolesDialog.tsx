/**
 * EditAssignmentRolesDialog — Edit roles for an existing contact-to-location assignment.
 *
 * Opens from location contact cards to let users change which roles
 * a person holds at that specific location. Does NOT edit person identity.
 *
 * API: PATCH /api/customer-companies/:id/assignments/:assignmentId
 */
import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { STANDARD_CONTACT_ROLES } from "@/components/ContactFormDialog";

interface EditAssignmentRolesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerCompanyId: string;
  assignmentId: string;
  contactName: string;
  currentRoles: string[];
  onSuccess: () => void;
}

export function EditAssignmentRolesDialog({
  open, onOpenChange, customerCompanyId, assignmentId, contactName, currentRoles, onSuccess,
}: EditAssignmentRolesDialogProps) {
  const { toast } = useToast();
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set(currentRoles));

  // Sync when dialog opens with new data
  useEffect(() => {
    if (open) setSelectedRoles(new Set(currentRoles));
  }, [open, currentRoles]);

  const toggleRole = useCallback((role: string) => {
    setSelectedRoles(prev => { const n = new Set(prev); n.has(role) ? n.delete(role) : n.add(role); return n; });
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/customer-companies/${customerCompanyId}/assignments/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify({ roles: Array.from(selectedRoles) }),
      });
    },
    onSuccess: () => {
      onSuccess();
      onOpenChange(false);
      toast({ title: "Roles updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to update roles", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Roles</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Roles for <span className="font-medium text-foreground">{contactName}</span> at this location.
          </p>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Roles</Label>
          <div className="flex flex-wrap gap-1.5">
            {STANDARD_CONTACT_ROLES.map(role => (
              <button key={role} type="button" onClick={() => toggleRole(role)} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${selectedRoles.has(role) ? "bg-primary text-primary-foreground border-primary" : "bg-white text-muted-foreground border-slate-200 hover:border-slate-400"}`}>
                {role}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Save Roles"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
