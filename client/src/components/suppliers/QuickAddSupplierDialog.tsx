/**
 * QuickAddSupplierDialog — Enhanced create-supplier modal.
 *
 * 2026-04-10: Expanded from name-only to include email, phone, account number,
 * and notes. Only name is required. On success, navigates to supplier detail page.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel, FormRow } from "@/components/ui/form-field";
// 2026-05-06 Phase 1 modal canonicalization: swapped raw Dialog primitives
// for the canonical ModalShell + Modal* primitives per CLAUDE.md Modal
// Taxonomy rule #2 (generic / simple form modal). Completes the supplier
// modal triplet (paired with AddLocationDialog + EditLocationDialog).
// Same body-shape decision (use ModalBody), same form structure (form
// wraps body+footer, header sibling), same width contract.
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supplier } from "@shared/schema";

interface QuickAddSupplierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (supplier: Supplier) => void;
}

export function QuickAddSupplierDialog({
  open,
  onOpenChange,
  onSuccess,
}: QuickAddSupplierDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setAccountNumber("");
    setNotes("");
  };

  const mutation = useMutation({
    mutationFn: async (data: {
      name: string;
      email?: string | null;
      phone?: string | null;
      accountNumber?: string | null;
      notes?: string | null;
    }) => {
      return await apiRequest("/api/suppliers", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Supplier created successfully" });
      onOpenChange(false);
      resetForm();
      if (onSuccess && data.supplier) {
        onSuccess(data.supplier);
      }
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.message || "Failed to create supplier",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({
        title: "Validation Error",
        description: "Supplier name is required",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate({
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      accountNumber: accountNumber.trim() || null,
      notes: notes.trim() || null,
    });
  };

  return (
    // 2026-05-06: width passed at the call-site per Modal Taxonomy
    // rule #5. The `max-w-md` width matches the prior DialogContent —
    // a narrow quick-create dialog for the minimal supplier identity
    // fields. ModalShell stays width-neutral.
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-md"
    >
      <ModalHeader>
        <ModalTitle>Add New Supplier</ModalTitle>
        <ModalDescription>
          Add a new supplier. You can add locations and more details later.
        </ModalDescription>
      </ModalHeader>

      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-3">
          <FormField>
            <FormLabel htmlFor="supplier-name" srOnly>Supplier Name</FormLabel>
            <Input
              id="supplier-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Supplier Name *"
              required
              autoFocus
            />
          </FormField>

          <FormRow className="grid-cols-2">
            <FormField>
              <FormLabel htmlFor="supplier-email" srOnly>Email</FormLabel>
              <Input
                id="supplier-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="supplier-phone" srOnly>Phone</FormLabel>
              <Input
                id="supplier-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone"
              />
            </FormField>
          </FormRow>

          <FormField>
            <FormLabel htmlFor="supplier-account" srOnly>Account Number</FormLabel>
            <Input
              id="supplier-account"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="Account Number (optional)"
            />
          </FormField>

          <FormField>
            <FormLabel htmlFor="supplier-notes" srOnly>Notes</FormLabel>
            <Textarea
              id="supplier-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Payment terms, contact preferences, etc."
              rows={2}
            />
          </FormField>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating..." : "Create Supplier"}
          </Button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}
