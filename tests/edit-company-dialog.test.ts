/**
 * EditCompanyDialog modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `EditCompanyDialog` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. The modal is the
 * canonical surface for editing a customer company's identity (first
 * name / last name / company name / use-company-as-primary toggle) +
 * contact (phone / email) + billing address — mounted from
 * `ClientDetailPage`. Behavior, validation gating (`firstName OR
 * companyName` required), the prefill flow (`useEffect` reads
 * `parentCompany` only when the modal is closed so user edits aren't
 * blown away), the PATCH mutation contract with the
 * `useCompanyAsPrimary` derivation, the canonical query invalidations,
 * and every form field are preserved verbatim — only the primitive
 * layer changed.
 *
 * Body-shape decision. Standard `space-y` form layout — fits cleanly
 * inside `<ModalBody>`. Same precedent as `LocationFormModal` /
 * `AddEquipmentDialog` / `CreateClientModal`. The prior `py-2` on the
 * body div is dropped because `<ModalBody>` bakes its own canonical
 * `py-4`.
 *
 * Width contract. The prior `<DialogContent>` had no explicit `max-w`
 * (relied on the shadcn default `max-w-lg`). Migration makes the width
 * explicit at the call-site per Modal Taxonomy rule #5; net visual
 * effect is byte-identical.
 *
 * No `<form>` wrapper. The modal uses `<Button onClick>` rather than a
 * form-submit boundary (same as `LocationFormModal` / `AddEquipmentDialog`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/EditCompanyDialog.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("EditCompanyDialog — uses canonical ModalShell + Modal* primitives", () => {
  it("imports the canonical Modal primitive set from @/components/ui/modal", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    for (const name of [
      "ModalShell",
      "ModalHeader",
      "ModalTitle",
      "ModalBody",
      "ModalFooter",
    ]) {
      expect(src).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import any name from @/components/ui/dialog", () => {
    expect(codeOnly).not.toMatch(
      /import\s*\{[^}]*?\}\s*from\s*["']@\/components\/ui\/dialog["']/,
    );
  });

  it("does NOT render any raw <Dialog*> JSX (post-migration)", () => {
    for (const name of [
      "Dialog",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogDescription",
      "DialogFooter",
    ]) {
      const re = new RegExp(`<${name}\\b`);
      expect(codeOnly).not.toMatch(re);
    }
  });

  it("does NOT import or render <ModalDescription> (no description in source)", () => {
    expect(codeOnly).not.toMatch(/<ModalDescription\b/);
    expect(codeOnly).not.toMatch(/\bModalDescription\b/);
  });
});

// ── 2. ModalShell composition + width contract ────────────────────

describe("EditCompanyDialog — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + onOpenChange forwarded from props", () => {
    expect(src).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}/,
    );
  });

  it("supplies width + height + scroll behavior at the call-site (max-w-lg max-h-[90vh] overflow-y-auto)", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?className="max-w-lg max-h-\[90vh\] overflow-y-auto"/,
    );
  });

  it("does NOT pass `p-0 gap-0` inline (already baked into ModalShell)", () => {
    const shellMatch = codeOnly.match(/<ModalShell[\s\S]*?className="([^"]+)"/);
    expect(shellMatch).not.toBeNull();
    expect(shellMatch![1]).not.toMatch(/\bp-0\b/);
    expect(shellMatch![1]).not.toMatch(/\bgap-0\b/);
  });
});

// ── 3. Header + body ─────────────────────────────────────────────

describe("EditCompanyDialog — header + body shape", () => {
  it("ModalHeader contains <ModalTitle>Edit Client</ModalTitle>", () => {
    expect(src).toMatch(
      /<ModalHeader>\s*<ModalTitle>\s*Edit Client\s*<\/ModalTitle>\s*<\/ModalHeader>/,
    );
  });

  it("ModalBody carries className=\"space-y-4\" (the prior py-2 was redundant after migration)", () => {
    expect(src).toMatch(/<ModalBody\s+className="space-y-4">/);
  });

  it("does NOT carry a `py-` override on ModalBody (canonical py-4 takes over)", () => {
    const bodyMatch = codeOnly.match(/<ModalBody[\s\S]*?className="([^"]+)"/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).not.toMatch(/\bpy-/);
    expect(bodyMatch![1]).not.toMatch(/\bp-\d/);
  });

  it("body is a direct child of ModalShell with no <form> wrapper (uses Button onClick)", () => {
    // Negative pin: no form element wraps the body or footer.
    expect(codeOnly).not.toMatch(/<form\b/);
  });
});

// ── 4. Form sections preserved verbatim ──────────────────────────

describe("EditCompanyDialog — form sections preserved verbatim", () => {
  it("Identity fieldset with First name + Last name + Company name + use-company-as-primary checkbox", () => {
    expect(src).toMatch(/<fieldset\s+className="space-y-2">/);
    expect(src).toMatch(
      /<legend\s+className="text-sm font-medium">[\s\S]*?Client Identity[\s\S]*?\(first name or company required\)/,
    );
    expect(src).toMatch(/placeholder="First name"\s+value=\{form\.firstName\}/);
    expect(src).toMatch(/placeholder="Last name"\s+value=\{form\.lastName\}/);
    expect(src).toMatch(/placeholder="Company name"\s+value=\{form\.name\}/);
    expect(src).toMatch(/id="edit-use-company-primary"/);
    expect(src).toMatch(/Use company name as primary client name/);
  });

  it("Phone + Email row in a 2-column grid", () => {
    expect(src).toMatch(
      /<div\s+className="grid grid-cols-2 gap-3">[\s\S]*?<Label>Phone<\/Label>[\s\S]*?<Label>Email<\/Label>/,
    );
  });

  it("Billing Street + Billing Street 2 (with placeholder)", () => {
    expect(src).toMatch(/<Label>Billing Street<\/Label>[\s\S]*?value=\{form\.billingStreet\}/);
    expect(src).toMatch(
      /<Label>Billing Street 2<\/Label>[\s\S]*?value=\{form\.billingStreet2\}[\s\S]*?placeholder="Suite, Unit, PO Box \(optional\)"/,
    );
  });

  it("City + Province + Postal Code row in a 3-column grid", () => {
    expect(src).toMatch(
      /<div\s+className="grid grid-cols-3 gap-3">[\s\S]*?<Label>City<\/Label>[\s\S]*?<Label>Province<\/Label>[\s\S]*?<Label>Postal Code<\/Label>/,
    );
  });

  it("ModalFooter contains Cancel + Save Changes buttons", () => {
    expect(src).toMatch(
      /<ModalFooter>[\s\S]*?Cancel[\s\S]*?Save Changes[\s\S]*?<\/ModalFooter>/,
    );
  });
});

// ── 5. Validation + submit gating + loading state ───────────────

describe("EditCompanyDialog — validation + submit gating preserved", () => {
  it("canSave gate requires firstName OR companyName (matches create-modal validation)", () => {
    expect(src).toMatch(
      /const\s+canSave\s*=\s*!!\(form\.firstName\.trim\(\)\s*\|\|\s*form\.name\.trim\(\)\)/,
    );
  });

  it("Save button is disabled when !canSave OR editClientMutation.isPending", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?onClick=\{\(\)\s*=>\s*editClientMutation\.mutate\(\)\}[\s\S]*?disabled=\{!canSave\s*\|\|\s*editClientMutation\.isPending\}/,
    );
  });

  it("Save button label switches between 'Saving...' (pending) and 'Save Changes' (idle)", () => {
    expect(src).toMatch(
      /\{editClientMutation\.isPending\s*\?\s*"Saving\.\.\."\s*:\s*"Save Changes"\}/,
    );
  });

  it("Cancel button calls onOpenChange(false)", () => {
    expect(src).toMatch(
      /<Button\s+variant="outline"\s+onClick=\{\(\)\s*=>\s*onOpenChange\(false\)\}>\s*Cancel\s*<\/Button>/,
    );
  });
});

// ── 6. Mutation contract + invalidations preserved ──────────────

describe("EditCompanyDialog — mutation contract preserved (PATCH)", () => {
  it("PATCHes /api/customer-companies/:companyId", () => {
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/customer-companies\/\$\{companyId\}`\s*,\s*\{\s*method:\s*"PATCH"/,
    );
  });

  it("payload trims every text field and maps blank values to null", () => {
    expect(src).toMatch(/firstName:\s*form\.firstName\.trim\(\)\s*\|\|\s*null/);
    expect(src).toMatch(/lastName:\s*form\.lastName\.trim\(\)\s*\|\|\s*null/);
    expect(src).toMatch(/name:\s*form\.name\.trim\(\)\s*\|\|\s*null/);
    expect(src).toMatch(/phone:\s*form\.phone\.trim\(\)\s*\|\|\s*null/);
    expect(src).toMatch(/email:\s*form\.email\.trim\(\)\s*\|\|\s*null/);
    expect(src).toMatch(/billingStreet:\s*form\.billingStreet\.trim\(\)\s*\|\|\s*null/);
    expect(src).toMatch(/billingStreet2:\s*form\.billingStreet2\.trim\(\)\s*\|\|\s*null/);
    expect(src).toMatch(/billingCity:\s*form\.billingCity\.trim\(\)\s*\|\|\s*null/);
    expect(src).toMatch(/billingProvince:\s*form\.billingProvince\.trim\(\)\s*\|\|\s*null/);
    expect(src).toMatch(/billingPostalCode:\s*form\.billingPostalCode\.trim\(\)\s*\|\|\s*null/);
  });

  it("payload's useCompanyAsPrimary derivation matches the create-modal rule (false when no company; true when no firstName; otherwise the toggle value)", () => {
    // Pre-existing rule: if there's no company name → false (can't use
    // empty company as primary). If there's no first name → true
    // (company is the only identity available). Otherwise honor the
    // user's checkbox.
    expect(src).toMatch(
      /useCompanyAsPrimary:\s*!form\.name\.trim\(\)\s*\?\s*false\s*:\s*!form\.firstName\.trim\(\)\s*\?\s*true\s*:\s*form\.useCompanyAsPrimary/,
    );
  });

  it("on success: invalidates clients overview + clients detail + customer-companies detail; closes the modal; toasts", () => {
    expect(src).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/clients"\s*,\s*clientId\s*,\s*"overview"\s*\]\s*\}\)/,
    );
    expect(src).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/clients"\s*,\s*clientId\s*\]\s*\}\)/,
    );
    expect(src).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/customer-companies"\s*,\s*companyId\s*\]\s*\}\)/,
    );
    expect(src).toMatch(/onOpenChange\(false\)/);
    expect(src).toMatch(/title:\s*"Client updated"/);
    expect(src).toMatch(/description:\s*"Client details saved\."/);
  });

  it("on error: surfaces a destructive toast with the server message and does NOT touch form state", () => {
    const errBlock = src.match(
      /editClientMutation\s*=\s*useMutation\(\{[\s\S]*?onError:\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(errBlock).not.toBeNull();
    const body = errBlock![1];
    expect(body).toMatch(/toast\(/);
    expect(body).toMatch(/variant:\s*"destructive"/);
    expect(body).toMatch(
      /description:\s*error\?\.message\s*\|\|\s*"Failed to update client\."/,
    );
    // Must not call any form-state setter.
    expect(body).not.toMatch(/\bsetForm\b/);
  });

  it("companyId guard: mutation throws 'Company not loaded yet.' when companyId is undefined", () => {
    expect(src).toMatch(
      /if\s*\(!companyId\)\s*throw\s+new\s+Error\("Company not loaded yet\."\)/,
    );
  });
});

// ── 7. Prefill flow preserved (useEffect with anti-overwrite guard) ─

describe("EditCompanyDialog — prefill flow preserved", () => {
  it("useEffect prefills the form ONLY when parentCompany is loaded AND the modal is closed (avoids overwriting in-flight edits)", () => {
    // The guard is: `if (parentCompany && !open)`. Pin both clauses.
    expect(src).toMatch(
      /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(parentCompany\s*&&\s*!open\)\s*\{[\s\S]*?setForm\(\{/,
    );
  });

  it('prefill writes all 11 form fields from parentCompany (with `|| ""` fallbacks for nullable strings + `!== false` for the toggle)', () => {
    expect(src).toMatch(/firstName:\s*parentCompany\.firstName\s*\|\|\s*""/);
    expect(src).toMatch(/lastName:\s*parentCompany\.lastName\s*\|\|\s*""/);
    expect(src).toMatch(/name:\s*parentCompany\.name\s*\|\|\s*""/);
    expect(src).toMatch(
      /useCompanyAsPrimary:\s*parentCompany\.useCompanyAsPrimary\s*!==\s*false/,
    );
    expect(src).toMatch(/phone:\s*parentCompany\.phone\s*\|\|\s*""/);
    expect(src).toMatch(/email:\s*parentCompany\.email\s*\|\|\s*""/);
    expect(src).toMatch(/billingStreet:\s*parentCompany\.billingStreet\s*\|\|\s*""/);
    expect(src).toMatch(/billingStreet2:\s*parentCompany\.billingStreet2\s*\|\|\s*""/);
    expect(src).toMatch(/billingCity:\s*parentCompany\.billingCity\s*\|\|\s*""/);
    expect(src).toMatch(/billingProvince:\s*parentCompany\.billingProvince\s*\|\|\s*""/);
    expect(src).toMatch(/billingPostalCode:\s*parentCompany\.billingPostalCode\s*\|\|\s*""/);
  });

  it("useEffect dependency array is [parentCompany, open]", () => {
    expect(src).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\s*parentCompany\s*,\s*open\s*\]\s*\)/,
    );
  });

  it("initial state (useState seed) is an empty form (the prefill happens via useEffect, not the initializer)", () => {
    expect(src).toMatch(
      /useState\(\{[\s\S]*?firstName:\s*""[\s\S]*?lastName:\s*""[\s\S]*?name:\s*""[\s\S]*?useCompanyAsPrimary:\s*true[\s\S]*?phone:\s*""[\s\S]*?email:\s*""[\s\S]*?billingStreet:\s*""[\s\S]*?billingStreet2:\s*""[\s\S]*?billingCity:\s*""[\s\S]*?billingProvince:\s*""[\s\S]*?billingPostalCode:\s*""[\s\S]*?\}\)/,
    );
  });
});
