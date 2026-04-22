// 2026-04-20 Phase 2 Team Hub: Real invite dialog.
// Replaces the toast-only stub in ManageTeam.tsx (handleInviteSubmit at line 235)
// and the legacy /api/technicians/invite path in TechnicianManagementPage.tsx.
// Hits canonical POST /api/invitations (server/routes/invitations.ts), which
// enforces role hierarchy via canAssignRole and global email uniqueness.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { AlertCircle, Mail, Copy } from "lucide-react";

// Backend createInvitationSchema restricts role to these three (server/routes/invitations.ts:16-19).
// `manager` and `owner` invites are intentionally blocked at the API layer.
const INVITABLE_ROLES = [
  { value: "technician", label: "Technician" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "admin", label: "Admin" },
] as const;

type InvitableRole = (typeof INVITABLE_ROLES)[number]["value"];

interface InviteResponse {
  token: string;
  expiresAt: string;
}

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteMemberDialog({ open, onOpenChange }: InviteMemberDialogProps) {
  const { toast } = useToast();
  const dirty = useUnsavedChanges();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("technician");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<InviteResponse | null>(null);

  const inviteMutation = useMutation({
    mutationFn: async (payload: { email: string; role: InvitableRole }) => {
      return await apiRequest<InviteResponse>("/api/invitations", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      setIssued(data);
      setError(null);
      // Once the invite is issued, the dialog is showing a result, not a draft —
      // close should not prompt.
      dirty.markClean();
      toast({ title: "Invitation created", description: `Invite sent for ${email}` });
    },
    onError: (err: any) => {
      const message = err?.message || "Failed to create invitation";
      setError(message);
    },
  });

  const acceptUrl = issued
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/invite?token=${issued.token}`
    : "";

  const reset = () => {
    setEmail("");
    setRole("technician");
    setError(null);
    setIssued(null);
    dirty.markClean();
  };

  const handleClose = (next: boolean) => {
    if (!next) {
      // No prompt after the invite has been issued (success state).
      // Otherwise prompt only when the user actually typed something.
      if (issued) {
        reset();
        onOpenChange(false);
        return;
      }
      dirty.confirmLeave(
        () => {
          reset();
          onOpenChange(false);
        },
        "Discard the invitation draft?",
      );
      return;
    }
    onOpenChange(next);
  };

  const copyAcceptUrl = async () => {
    if (!acceptUrl) return;
    try {
      await navigator.clipboard.writeText(acceptUrl);
      toast({ title: "Link copied" });
    } catch {
      toast({ variant: "destructive", title: "Copy failed", description: "Please copy manually." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-testid="dialog-invite-member">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Send an invitation. Each email can only belong to one company.
          </DialogDescription>
        </DialogHeader>

        {!issued ? (
          <div className="space-y-4 py-2">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  dirty.markDirty();
                }}
                placeholder="name@example.com"
                data-testid="input-invite-email"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={role}
                onValueChange={(v) => {
                  setRole(v as InvitableRole);
                  dirty.markDirty();
                }}
              >
                <SelectTrigger id="invite-role" data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITABLE_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Owner and manager roles must be assigned from a user's profile after signup.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <Alert>
              <Mail className="h-4 w-4" />
              <AlertDescription>
                Invitation created for <span className="font-medium">{email}</span>. Share the link
                below — it expires on {new Date(issued.expiresAt).toLocaleString()}.
              </AlertDescription>
            </Alert>
            <div className="space-y-1">
              <Label>Accept link</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={acceptUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  data-testid="input-invite-link"
                />
                <Button variant="outline" onClick={copyAcceptUrl} data-testid="button-copy-invite-link">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!issued ? (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => inviteMutation.mutate({ email, role })}
                disabled={!email || inviteMutation.isPending}
                data-testid="button-send-invite"
              >
                <Mail className="h-4 w-4 mr-2" />
                {inviteMutation.isPending ? "Sending..." : "Send Invite"}
              </Button>
            </>
          ) : (
            <Button onClick={() => handleClose(false)} data-testid="button-close-invite">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
