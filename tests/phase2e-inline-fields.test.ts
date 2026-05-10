/**
 * Phase 2E — Payment / member / link dialog inline-field migration tests.
 * (2026-05-10)
 *
 * Pins the structural contracts for the four P1 dialogs migrated in Phase 2E:
 *   1. CollectPaymentDialog — inline-field primitives only (no ModalShell:
 *      custom scrollable/sticky layout exception — see REFACTORING_LOG.md).
 *   2. RefundPaymentDialog — ModalShell + InlineInput/InlineSelectTrigger/InlineTextarea.
 *   3. InviteMemberDialog — ModalShell + InlineInput/InlineSelectTrigger.
 *   4. SendPaymentLinkDialog — ModalShell + InlineInput.
 *
 * Each section verifies:
 *   a) Correct shell: ModalShell (3–4) or documented raw-Dialog exception (1).
 *   b) Inline primitives imported and used.
 *   c) No raw Label-above-input or SelectTrigger patterns remain.
 *   d) Stripe PaymentElement (EmbeddedStripeCardForm) untouched in (1).
 *   e) Allocation amount <Input> rows preserved in (1) — compact widget, not a form field.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

const collectSrc = read("client/src/components/invoice/CollectPaymentDialog.tsx");
const refundSrc  = read("client/src/components/invoice/RefundPaymentDialog.tsx");
const inviteSrc  = read("client/src/components/team-hub/InviteMemberDialog.tsx");
const sendSrc    = read("client/src/components/portal/SendPaymentLinkDialog.tsx");

// ── 1. CollectPaymentDialog ───────────────────────────────────────────

describe("CollectPaymentDialog — inline-field migration (raw-Dialog exception)", () => {
  it("imports InlineInput from form-field", () => {
    expect(collectSrc).toMatch(/InlineInput/);
    expect(collectSrc).toMatch(/from "@\/components\/ui\/form-field"/);
  });

  it("imports InlineSelectTrigger from form-field", () => {
    expect(collectSrc).toMatch(/InlineSelectTrigger/);
  });

  it("imports InlineTextarea from form-field", () => {
    expect(collectSrc).toMatch(/InlineTextarea/);
  });

  it("uses FormRow for method/date grid", () => {
    expect(collectSrc).toMatch(/<FormRow/);
  });

  it("uses InlineSelectTrigger for payment method", () => {
    expect(collectSrc).toMatch(/InlineSelectTrigger[\s\S]*?id="payment-method"/);
  });

  it("uses InlineInput for transaction date", () => {
    expect(collectSrc).toMatch(/InlineInput[\s\S]*?id="payment-date"/);
  });

  it("uses InlineInput for reference", () => {
    expect(collectSrc).toMatch(/InlineInput[\s\S]*?id="payment-reference"/);
  });

  it("uses InlineTextarea for details/notes", () => {
    expect(collectSrc).toMatch(/InlineTextarea[\s\S]*?id="payment-notes"/);
  });

  it("retains raw Dialog shell (scrollable-layout exception)", () => {
    // The custom max-h-[88vh] overflow-hidden flex-col layout with sticky footer
    // cannot be modelled by ModalShell + ModalBody without significant restructuring.
    // This is an intentional documented exception — raw Dialog is kept.
    expect(collectSrc).toMatch(/from "@\/components\/ui\/dialog"/);
    expect(collectSrc).toMatch(/<Dialog\s/);
  });

  it("does NOT import ModalShell (consistent with raw-Dialog exception)", () => {
    expect(collectSrc).not.toMatch(/ModalShell/);
  });

  it("Stripe EmbeddedStripeCardForm is untouched", () => {
    expect(collectSrc).toMatch(/EmbeddedStripeCardForm/);
    expect(collectSrc).toMatch(/Elements.*stripe/s);
  });

  it("allocation-row <Input> elements are preserved (compact widget, not form fields)", () => {
    // The per-invoice amount inputs inside the invoice list are not labeled fields —
    // they use aria-label and are intentionally kept as raw <Input>.
    expect(collectSrc).toMatch(/data-testid={`collect-payment-amount-\${inv\.id}`}/);
    expect(collectSrc).toMatch(/import.*Input.*from "@\/components\/ui\/input"/);
  });

  it("has NO raw <div className=\"space-y-1\"> field wrappers", () => {
    expect(collectSrc).not.toMatch(/<div\s+className="space-y-1"/);
  });

  it("has NO raw <SelectTrigger> (replaced by InlineSelectTrigger)", () => {
    // Check no JSX <SelectTrigger usage (InlineSelectTrigger is fine).
    expect(collectSrc).not.toMatch(/<SelectTrigger[\s/>]/);
    // Check no import of SelectTrigger from shadcn select.
    expect(collectSrc).not.toMatch(/import[^}]*\bSelectTrigger\b[^}]*from "@\/components\/ui\/select"/s);
  });
});

// ── 2. RefundPaymentDialog ────────────────────────────────────────────

describe("RefundPaymentDialog — ModalShell + inline fields", () => {
  it("imports ModalShell from modal", () => {
    expect(refundSrc).toMatch(/ModalShell/);
    expect(refundSrc).toMatch(/from "@\/components\/ui\/modal"/);
  });

  it("uses ModalShell as root element", () => {
    expect(refundSrc).toMatch(/<ModalShell/);
  });

  it("does NOT import raw Dialog from dialog.tsx", () => {
    expect(refundSrc).not.toMatch(/from "@\/components\/ui\/dialog"/);
  });

  it("imports InlineInput from form-field", () => {
    expect(refundSrc).toMatch(/InlineInput/);
    expect(refundSrc).toMatch(/from "@\/components\/ui\/form-field"/);
  });

  it("imports InlineSelectTrigger from form-field", () => {
    expect(refundSrc).toMatch(/InlineSelectTrigger/);
  });

  it("imports InlineTextarea from form-field", () => {
    expect(refundSrc).toMatch(/InlineTextarea/);
  });

  it("uses InlineInput for refund amount", () => {
    expect(refundSrc).toMatch(/InlineInput[\s\S]*?id="refund-amount"/);
  });

  it("uses InlineSelectTrigger for Stripe reason", () => {
    expect(refundSrc).toMatch(/InlineSelectTrigger[\s\S]*?id="refund-reason"/);
  });

  it("uses InlineSelectTrigger for manual refund method", () => {
    expect(refundSrc).toMatch(/InlineSelectTrigger[\s\S]*?id="refund-method"/);
  });

  it("uses InlineTextarea for notes", () => {
    expect(refundSrc).toMatch(/InlineTextarea[\s\S]*?id="refund-notes"/);
  });

  it("uses FormErrorText for amount validation error", () => {
    expect(refundSrc).toMatch(/FormErrorText/);
    expect(refundSrc).toMatch(/<FormErrorText>/);
  });

  it("uses FormHelperText for Stripe reason hint", () => {
    expect(refundSrc).toMatch(/FormHelperText/);
    expect(refundSrc).toMatch(/<FormHelperText>/);
  });

  it("has a single ModalFooter (no DialogFooter inside state divs)", () => {
    expect(refundSrc).toMatch(/<ModalFooter>/);
    expect(refundSrc).not.toMatch(/DialogFooter/);
    // Only one ModalFooter closing tag
    const footerCloseCount = (refundSrc.match(/<\/ModalFooter>/g) ?? []).length;
    expect(footerCloseCount).toBe(1);
  });

  it("settled and reconciliation_pending states are in ModalBody (not separate containers with DialogFooter)", () => {
    expect(refundSrc).toMatch(/data-testid="refund-reconciliation-pending"/);
    expect(refundSrc).toMatch(/data-testid="refund-settled"/);
    // These should be inside ModalBody, not followed by their own DialogFooter
    expect(refundSrc).not.toMatch(/data-testid="refund-settled"[\s\S]*?<DialogFooter/);
    expect(refundSrc).not.toMatch(/data-testid="refund-reconciliation-pending"[\s\S]*?<DialogFooter/);
  });

  it("has NO raw <Label> above input fields", () => {
    // No JSX <SelectTrigger (InlineSelectTrigger is fine).
    expect(refundSrc).not.toMatch(/<SelectTrigger[\s/>]/);
    // No Label+Input pattern
    expect(refundSrc).not.toMatch(/<Label htmlFor="refund-/);
  });
});

// ── 3. InviteMemberDialog ─────────────────────────────────────────────

describe("InviteMemberDialog — ModalShell + inline fields", () => {
  it("imports ModalShell from modal", () => {
    expect(inviteSrc).toMatch(/ModalShell/);
    expect(inviteSrc).toMatch(/from "@\/components\/ui\/modal"/);
  });

  it("uses ModalShell as root element", () => {
    expect(inviteSrc).toMatch(/<ModalShell/);
  });

  it("does NOT import raw Dialog from dialog.tsx", () => {
    expect(inviteSrc).not.toMatch(/from "@\/components\/ui\/dialog"/);
  });

  it("imports InlineInput from form-field", () => {
    expect(inviteSrc).toMatch(/InlineInput/);
  });

  it("imports InlineSelectTrigger from form-field", () => {
    expect(inviteSrc).toMatch(/InlineSelectTrigger/);
  });

  it("uses InlineInput for email field", () => {
    expect(inviteSrc).toMatch(/InlineInput[\s\S]*?id="invite-email"/);
  });

  it("uses InlineSelectTrigger for role field", () => {
    expect(inviteSrc).toMatch(/InlineSelectTrigger[\s\S]*?id="invite-role"/);
  });

  it("retains FormHelperText for role hint", () => {
    expect(inviteSrc).toMatch(/FormHelperText/);
    expect(inviteSrc).toMatch(/Owner and manager roles/);
  });

  it("preserves accept-link FormField in success state (readonly, not a form input)", () => {
    expect(inviteSrc).toMatch(/data-testid="input-invite-link"/);
    expect(inviteSrc).toMatch(/Accept link/);
  });

  it("has NO raw SelectTrigger (replaced by InlineSelectTrigger)", () => {
    // No JSX <SelectTrigger (InlineSelectTrigger is fine).
    expect(inviteSrc).not.toMatch(/<SelectTrigger[\s/>]/);
    // No import of SelectTrigger from shadcn select.
    expect(inviteSrc).not.toMatch(/import[^}]*\bSelectTrigger\b[^}]*from "@\/components\/ui\/select"/s);
  });

  it("has NO raw Label above email/role fields", () => {
    expect(inviteSrc).not.toMatch(/<Label htmlFor="invite-email"/);
    expect(inviteSrc).not.toMatch(/<Label htmlFor="invite-role"/);
  });
});

// ── 4. SendPaymentLinkDialog ──────────────────────────────────────────

describe("SendPaymentLinkDialog — ModalShell + InlineInput", () => {
  it("imports ModalShell from modal", () => {
    expect(sendSrc).toMatch(/ModalShell/);
    expect(sendSrc).toMatch(/from "@\/components\/ui\/modal"/);
  });

  it("uses ModalShell as root element", () => {
    expect(sendSrc).toMatch(/<ModalShell/);
  });

  it("does NOT import raw Dialog from dialog.tsx", () => {
    expect(sendSrc).not.toMatch(/from "@\/components\/ui\/dialog"/);
  });

  it("imports InlineInput from form-field", () => {
    expect(sendSrc).toMatch(/InlineInput/);
  });

  it("uses InlineInput for recipient email", () => {
    expect(sendSrc).toMatch(/InlineInput[\s\S]*?id="send-payment-link-email"/);
  });

  it("retains FormHelperText for enumeration-protection hint", () => {
    expect(sendSrc).toMatch(/FormHelperText/);
    expect(sendSrc).toMatch(/silently ignored/);
  });

  it("has NO raw Label above email input", () => {
    expect(sendSrc).not.toMatch(/<Label htmlFor="send-payment-link-email"/);
  });

  it("has NO raw Input import (replaced by InlineInput)", () => {
    expect(sendSrc).not.toMatch(/import.*\bInput\b.*from "@\/components\/ui\/input"/);
  });
});
