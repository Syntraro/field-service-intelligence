/**
 * CreateClientModal modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `CreateClientModal` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. This file pins the
 * migration:
 *
 *   - Imports the canonical Modal primitives from
 *     `@/components/ui/modal` (NOT raw Dialog from `@/components/ui/dialog`).
 *   - Mounts via `<ModalShell>` with the call-site-owned width
 *     (Modal Taxonomy rule #5 — ModalShell stays width-neutral).
 *   - The form structure (header outside form; body+footer inside
 *     form) preserves submit-on-Enter behavior and the canonical
 *     close → reset → callback flow.
 *   - All form fields, testids, validation gates, mutation handlers,
 *     and the close/reset behavior are preserved verbatim.
 *
 * The pre-existing `tests/quick-create-job-client-flow.test.ts`
 * "CreateClientModal canonical contract" describe block continues to
 * cover the API contract (`initialValues` prop, the
 * `/api/clients/full-create` endpoint, the `onCreated` callback
 * signature). This file complements it with primitive-layer pins.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const createClientModalSrc = readFileSync(
  resolve(__dirname, "../client/src/components/CreateClientModal.tsx"),
  "utf-8",
);

// Code-only view — strip block + line + JSX comments so doc commentary
// that references the legacy `<Dialog>` surface (kept for context)
// doesn't false-match the negative pins below.
const codeOnly = createClientModalSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("CreateClientModal — uses canonical ModalShell + Modal* primitives", () => {
  it("imports the canonical Modal primitive set from @/components/ui/modal", () => {
    expect(createClientModalSrc).toMatch(
      /from\s+["']@\/components\/ui\/modal["']/,
    );
    for (const name of [
      "ModalShell",
      "ModalHeader",
      "ModalTitle",
      "ModalBody",
      "ModalFooter",
    ]) {
      expect(createClientModalSrc).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import any name from @/components/ui/dialog", () => {
    expect(codeOnly).not.toMatch(
      /from\s+["']@\/components\/ui\/dialog["']/,
    );
  });

  it("does NOT render any raw <Dialog*> JSX (post-migration)", () => {
    for (const name of [
      "Dialog",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogFooter",
      "DialogDescription",
    ]) {
      const re = new RegExp(`<${name}\\b`);
      expect(codeOnly).not.toMatch(re);
    }
  });
});

// ── 2. ModalShell composition + width contract ─────────────────────

describe("CreateClientModal — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + onOpenChange={handleClose}", () => {
    // handleClose is the close-with-pending-guard wrapper around
    // onOpenChange; pinning it ensures the in-flight protection
    // (no close while createMutation.isPending) survives a refactor.
    expect(createClientModalSrc).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{handleClose\}/,
    );
  });

  it("supplies width + height + scroll behavior at the call-site (ModalShell stays width-neutral)", () => {
    // Pin the explicit className contract. Pre-migration the
    // DialogContent baked these classes inline; post-migration the
    // ModalShell receives them via className per rule #5.
    expect(createClientModalSrc).toMatch(
      /<ModalShell[\s\S]*?className="sm:max-w-lg max-h-\[90vh\] overflow-y-auto"/,
    );
  });

  it("retains the canonical wrapper testid (dialog-create-client)", () => {
    expect(createClientModalSrc).toMatch(
      /<ModalShell[\s\S]*?data-testid="dialog-create-client"/,
    );
  });

  it("renders <ModalHeader> with <ModalTitle>New Client</ModalTitle>", () => {
    expect(createClientModalSrc).toMatch(
      /<ModalHeader>\s*<ModalTitle>\s*New Client\s*<\/ModalTitle>\s*<\/ModalHeader>/,
    );
  });
});

// ── 3. Form structure: header sibling, body+footer inside form ─────

describe("CreateClientModal — form wraps ModalBody + ModalFooter (submit-on-Enter preserved)", () => {
  it("the form opens after <ModalHeader> (header is sibling, not child of form)", () => {
    // Header outside form, form wraps body+footer. This is what
    // makes Enter-to-submit work on every focused input inside
    // ModalBody — the form is the submit boundary.
    expect(createClientModalSrc).toMatch(
      /<\/ModalHeader>\s*<form\s+onSubmit=\{handleSubmit\}>/,
    );
  });

  it("ModalBody carries space-y-4 for inter-section vertical rhythm", () => {
    // The pre-migration form had `space-y-4 py-1`. The space-y-4
    // moved to ModalBody (which also contributes its canonical
    // px-5 py-4 padding); the py-1 was redundant after that move.
    expect(createClientModalSrc).toMatch(
      /<ModalBody\s+className="space-y-4">/,
    );
  });

  it("ModalFooter sits inside the <form> so the submit button is the form's submit", () => {
    // Pin the close </form></ModalShell> sequence so a future
    // refactor can't accidentally hoist the footer out of the form
    // (which would break Enter-to-submit + the loading button).
    expect(createClientModalSrc).toMatch(
      /<\/ModalFooter>\s*<\/form>\s*<\/ModalShell>/,
    );
  });
});

// ── 4. Form fields preserved verbatim ──────────────────────────────

describe("CreateClientModal — form fields + testids preserved verbatim", () => {
  for (const testid of [
    // Identity
    "input-client-first-name",
    "input-client-last-name",
    "input-company-name",
    "checkbox-use-company-primary",
    // Contact
    "input-contact-phone",
    "input-contact-email",
    // Service address
    "input-service-street",
    "input-service-street2",
    "input-service-city",
    "input-service-province",
    "input-service-postal",
    // Billing toggle + (conditional) billing address
    "checkbox-billing-same",
    "input-billing-street",
    "input-billing-street2",
    "input-billing-city",
    "input-billing-province",
    "input-billing-postal",
    // Submit button
    "button-save-client",
  ]) {
    it(`preserves data-testid="${testid}"`, () => {
      expect(createClientModalSrc).toMatch(
        new RegExp(`data-testid="${testid}"`),
      );
    });
  }
});

// ── 5. Validation + mutation gating preserved ──────────────────────

describe("CreateClientModal — validation + mutation gating preserved", () => {
  it("Save is gated on canSubmit (firstName-or-companyName + email-valid + location-valid)", () => {
    // Canonical canSubmit expression — pin the three gates so a
    // future relaxation (e.g. dropping the email-valid check) trips.
    expect(createClientModalSrc).toMatch(
      /clientFirstName\.trim\(\)\s*\|\|\s*companyName\.trim\(\)/,
    );
    expect(createClientModalSrc).toMatch(/&&\s*emailValid/);
    expect(createClientModalSrc).toMatch(
      /locationNameSatisfied\s*\|\|\s*locationAddressSatisfied/,
    );
  });

  it("Save button is disabled when !canSubmit OR createMutation.isPending", () => {
    expect(createClientModalSrc).toMatch(
      /disabled=\{!canSubmit\s*\|\|\s*createMutation\.isPending\}/,
    );
  });

  it("Cancel button is disabled while createMutation.isPending (prevents close mid-submit)", () => {
    // The Cancel button block (button-type="button" with the
    // outline variant + the in-flight gate). Pin the disabled
    // expression so a regression can't drop the protection.
    expect(createClientModalSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*handleClose\(false\)\}[\s\S]*?disabled=\{createMutation\.isPending\}/,
    );
  });

  it("handleClose blocks closing while createMutation.isPending", () => {
    expect(createClientModalSrc).toMatch(
      /handleClose[\s\S]*?if\s*\(createMutation\.isPending\)\s*return/,
    );
  });

  it("submit button shows the spinner + 'Creating...' label while pending", () => {
    expect(createClientModalSrc).toMatch(
      /createMutation\.isPending\s*\?\s*\(\s*<Loader2/,
    );
    expect(createClientModalSrc).toMatch(
      /createMutation\.isPending\s*\?\s*"Creating\.\.\."\s*:\s*"Create Client"/,
    );
  });
});

// ── 6. Close → reset → callback flow preserved ─────────────────────

describe("CreateClientModal — close/reset/success-callback flow preserved", () => {
  it("resetForm clears every form-state setter", () => {
    // The canonical resetForm body must touch all setters. Pin the
    // important ones so a new field added without a corresponding
    // reset trips here.
    for (const setter of [
      "setCompanyName",
      "setClientFirstName",
      "setClientLastName",
      "setUseCompanyAsPrimary",
      "setPhone",
      "setEmail",
      "setSvcStreet",
      "setSvcCity",
      "setBillingSameAsService",
      "setServerError",
    ]) {
      expect(createClientModalSrc).toMatch(
        new RegExp(`resetForm[\\s\\S]*?\\b${setter}\\b`),
      );
    }
  });

  it("on success: invalidates clients + customer-companies queries, resets, closes, then either calls onCreated or navigates", () => {
    expect(createClientModalSrc).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/clients"\s*\]\s*\}\)/,
    );
    expect(createClientModalSrc).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/customer-companies"\s*\]\s*\}\)/,
    );
    expect(createClientModalSrc).toMatch(/resetForm\(\)/);
    expect(createClientModalSrc).toMatch(/onOpenChange\(false\)/);
    expect(createClientModalSrc).toMatch(
      /onCreated\(result\.customerCompany\.id,\s*result\.client\.id\)/,
    );
    expect(createClientModalSrc).toMatch(
      /setLocation\(`\/clients\/\$\{result\.customerCompany\.id\}`\)/,
    );
  });

  it("on error: surfaces the message via setServerError (does NOT clear the form)", () => {
    // The error path must preserve the user's input so they can
    // retry after a server-side validation failure.
    const onErrorBlock = createClientModalSrc.match(
      /onError:\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(onErrorBlock).not.toBeNull();
    const body = onErrorBlock![1];
    expect(body).toMatch(/setServerError\(/);
    // Must not call resetForm, setCompanyName, setClientFirstName,
    // etc. inside onError — those would clear the user's input.
    expect(body).not.toMatch(/resetForm\(\)/);
    expect(body).not.toMatch(/\bsetCompanyName\b/);
    expect(body).not.toMatch(/\bsetClientFirstName\b/);
    expect(body).not.toMatch(/\bsetSvcStreet\b/);
  });
});
