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
import { Button } from "@/components/ui/button";
import { Loader2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import { InlineInput, FormHelperText } from "@/components/ui/form-field";

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
      // 2026-05-05: routed through apiRequest for CSRF compliance.
      await apiRequest("/api/portal/auth/request-link", {
        method: "POST",
        body: JSON.stringify({ email: normalized }),
      });
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
    <ModalShell open={open} onOpenChange={onOpenChange} className="sm:max-w-md">
      <ModalHeader>
        <ModalTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-[#76B054]" />
          Send payment link
          {invoiceNumber ? <span className="text-sm font-normal text-muted-foreground">Invoice #{invoiceNumber}</span> : null}
        </ModalTitle>
        <ModalDescription>
          {description ??
            "We'll email a one-time sign-in link to your customer. The link expires in 15 minutes and lands them on their invoice in the customer portal."}
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <InlineInput
          id="send-payment-link-email"
          label="Recipient email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="customer@example.com"
          disabled={isSending}
          autoFocus
          data-testid="input-send-payment-link-email"
          wrapperClassName="mb-2"
        />
        <FormHelperText>
          Must be a contact already saved on the customer account. Unknown emails are silently ignored to prevent account enumeration.
        </FormHelperText>
      </ModalBody>
      <ModalFooter>
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
      </ModalFooter>
    </ModalShell>
  );
}

export default SendPaymentLinkDialog;
