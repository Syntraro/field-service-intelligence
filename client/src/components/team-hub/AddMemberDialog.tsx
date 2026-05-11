// 2026-04-20 Phase 2 Team Hub: Direct add-member dialog.
// Extracted from ManageTeam.tsx so the hub can reuse the canonical
// POST /api/team flow without pulling in the whole roster page.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { AlertCircle, UserPlus } from "lucide-react";
import { FormHelperText } from "@/components/ui/form-field";

interface Role {
  id: string;
  name: string;
  displayName: string;
  hierarchy: number;
}

interface AddMemberResponse {
  id: string;
  fullName: string | null;
  email: string;
  message?: string;
}

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMemberDialog({ open, onOpenChange }: AddMemberDialogProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const dirty = useUnsavedChanges();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    roleId: "",
    disabled: false,
  });
  const [error, setError] = useState<string | null>(null);

  const { data: roles = [] } = useQuery<Role[]>({ queryKey: ["/api/roles"] });

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((p) => ({ ...p, [key]: value }));
    dirty.markDirty();
  };

  const reset = () => {
    setForm({ fullName: "", email: "", phone: "", roleId: "", disabled: false });
    setError(null);
    dirty.markClean();
  };

  const handleClose = (next: boolean) => {
    if (!next) {
      // Confirm before discarding edits — only prompts when actually dirty.
      dirty.confirmLeave(
        () => {
          reset();
          onOpenChange(false);
        },
        "Discard new member details?",
      );
      return;
    }
    onOpenChange(next);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmed = form.fullName.trim();
      const parts = trimmed.split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
      return await apiRequest<AddMemberResponse>("/api/team", {
        method: "POST",
        body: JSON.stringify({
          fullName: trimmed,
          firstName,
          lastName,
          email: form.email,
          phone: form.phone || null,
          roleId: form.roleId || undefined,
          disabled: form.disabled,
        }),
      });
    },
    onSuccess: (member) => {
      toast({
        title: "Team member created",
        description: member.message || `${member.fullName || member.email} has been added.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
      // Successful save → mark clean so the close-confirmation skips the prompt.
      dirty.markClean();
      reset();
      onOpenChange(false);
      navigate(`/manage-team/${member.id}`);
    },
    onError: (err: any) => {
      setError(err?.message || "Failed to create team member");
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-testid="dialog-add-member">
        <DialogHeader>
          <DialogTitle>Add Team Member</DialogTitle>
          <DialogDescription>
            Creates a member directly. They'll need a password reset to log in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="add-name">Full Name *</Label>
            <Input
              id="add-name"
              value={form.fullName}
              onChange={(e) => setField("fullName", e.target.value)}
              placeholder="John Doe"
              data-testid="input-add-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-email">Email *</Label>
            <Input
              id="add-email"
              type="email"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
              placeholder="john@example.com"
              data-testid="input-add-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-phone">Phone</Label>
            <Input
              id="add-phone"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="(555) 123-4567"
              data-testid="input-add-phone"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-role">Role *</Label>
            <Select value={form.roleId} onValueChange={(v) => setField("roleId", v)}>
              <SelectTrigger id="add-role" data-testid="select-add-role">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between pt-2">
            <div>
              <Label htmlFor="add-enabled">Account Enabled</Label>
              <FormHelperText>Disabled accounts cannot log in</FormHelperText>
            </div>
            <Switch
              id="add-enabled"
              checked={!form.disabled}
              onCheckedChange={(checked) => setField("disabled", !checked)}
              data-testid="switch-add-enabled"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.email || !form.fullName || !form.roleId || createMutation.isPending}
            data-testid="button-create-member"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            {createMutation.isPending ? "Creating..." : "Create Member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
