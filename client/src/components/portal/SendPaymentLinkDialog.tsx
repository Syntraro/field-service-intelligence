/**
 * SendPaymentLinkDialog — office-side trigger for the portal magic-link
 * email. Used by InvoiceDetailPage and ClientBillingTab.
 *
 * Flow: user confirms the target contact email → we POST to the existing
 * public endpoint `/api/portal/auth/request-link` → Resend dispatches a
 * 15-min single-use magic link. No new backend route, no schema change.
 *
 * The endpoint is deliberately anti-enumeration (returns `sent: true` for
 * any well-formed email whether or not a contact row matches). The UI
 * tells the user honestly that a link is on its way IF the email is a
 * registered contact, so nothing leaks either direction.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SendPaymentLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default/primary recipient email (typically the invoice's primary contact). */
  defaultEmail?: string | null;
  /** Optional invoice number for the dialog title. */
  invoiceNumber?: string | null;
  /** Optional description override (defaults to the generic copy below). */
  description?: string;
}

export function SendPaymentLinkDialog({
  open,
  onOpenChange,
  defaultEmail,
  invoiceNumber,
  description,
}: SendPaymentLinkDialogProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [isSending, setIsSending] = useState(false);

  // Reset when dialog reopens so the default email is honored each time.
  useEffect(() => {
    if (open) setEmail(defaultEmail ?? "");
  }, [open, defaultEmail]);

  const handleSend = async () => {
    const normalized = email.trim();
    if (!normalized) {
      toast({ title: "Enter an email", variant: "destructive" });
      return;
    }
    setIsSending(true);
    try {
      const res = await fetch("/api/portal/auth/request-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      toast({
        title: "Payment link sent",
        description: `If ${normalized} is a registered contact, they'll receive a sign-in link within a minute.`,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Unable to send link",
        description: err?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-[#76B054]" />
            Send payment link
            {invoiceNumber ? <span className="text-sm font-normal text-muted-foreground">Invoice #{invoiceNumber}</span> : null}
          </DialogTitle>
          <DialogDescription>
            {description ??
              "We'll email a one-time sign-in link to your customer. The link expires in 15 minutes and lands them on their invoice in the customer portal."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="send-payment-link-email" className="text-xs">Recipient email</Label>
          <Input
            id="send-payment-link-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="customer@example.com"
            disabled={isSending}
            autoFocus
            data-testid="input-send-payment-link-email"
          />
          <p className="text-xs text-muted-foreground">
            Must be a contact already saved on the customer account. Unknown emails are silently ignored to prevent account enumeration.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={isSending || !email.trim()}
            className="bg-[#76B054] hover:bg-[#6aa147] text-white"
            data-testid="button-confirm-send-payment-link"
          >
            {isSending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
            Send link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SendPaymentLinkDialog;
