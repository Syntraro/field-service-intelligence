/**
 * Phase 2F — srOnly/placeholder-first to inline-field migration tests.
 * (2026-05-10)
 *
 * Pins the structural contracts for the three forms migrated in Phase 2F:
 *   1. CreateClientModal — InlineInput for all text/address fields;
 *      visible FormLabel retained for phone/email migrated to InlineInput label.
 *   2. EditCompanyDialog — InlineInput replaces srOnly fields;
 *      InlineSelectTrigger replaces SelectTrigger for payment terms.
 *   3. AddEquipmentDialog — InlineInput/InlineTextarea replace Input/Textarea;
 *      EquipmentTypeCombobox keeps visible FormLabel (custom widget exception).
 *
 * Each section verifies:
 *   a) InlineInput/InlineTextarea/InlineSelectTrigger imported and used.
 *   b) No FormLabel srOnly for migrated standard fields.
 *   c) No raw Input/Textarea/SelectTrigger for migrated fields.
 *   d) Checkbox/switch labels unchanged (canonical exception).
 *   e) All data-testids and IDs preserved.
 *   f) Behavior logic (validation, mutation) unchanged.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

const createSrc  = read("client/src/components/CreateClientModal.tsx");
const editSrc    = read("client/src/components/EditCompanyDialog.tsx");
const equipSrc   = read("client/src/components/AddEquipmentDialog.tsx");

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "")
   .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
   .replace(/\/\/[^\n]*/g, "");

const createCode = stripComments(createSrc);
const editCode   = stripComments(editSrc);
const equipCode  = stripComments(equipSrc);

// ── 1. CreateClientModal ──────────────────────────────────────────────

describe("CreateClientModal — Phase 2F inline-field migration", () => {
  it("imports InlineInput from form-field", () => {
    expect(createSrc).toMatch(/InlineInput/);
    expect(createSrc).toMatch(/from "@\/components\/ui\/form-field"/);
  });

  it("does NOT import raw Input from @/components/ui/input", () => {
    expect(createSrc).not.toMatch(/from "@\/components\/ui\/input"/);
  });

  it("does NOT import FormLabel (all labels are InlineInput label prop)", () => {
    expect(createCode).not.toMatch(/\bFormLabel\b/);
  });

  it("does NOT have any FormLabel srOnly in source", () => {
    expect(createCode).not.toMatch(/<FormLabel[\s\S]*?srOnly/);
  });

  it("uses InlineInput for first name", () => {
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-client-first-name"/);
    expect(createSrc).toMatch(/InlineInput[\s\S]*?label="First name"/);
  });

  it("uses InlineInput for last name", () => {
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-client-last-name"/);
  });

  it("uses InlineInput for company name", () => {
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-company-name"/);
  });

  it("uses InlineInput for phone with label='Phone'", () => {
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-contact-phone"[\s\S]*?label="Phone"/);
  });

  it("uses InlineInput for email with error prop for validation", () => {
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-contact-email"[\s\S]*?error=\{showEmailError\}/);
  });

  it("retains FormErrorText for email validation below InlineInput", () => {
    expect(createSrc).toMatch(/FormErrorText[\s\S]*?data-testid="contact-email-error"/);
    expect(createSrc).toMatch(/<FormErrorText/);
  });

  it("uses InlineInput for service address fields", () => {
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-service-street"/);
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-service-street2"/);
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-service-city"/);
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-service-province"/);
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-service-postal"/);
  });

  it("uses InlineInput for billing address fields", () => {
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-billing-street"/);
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-billing-city"/);
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-billing-province"/);
    expect(createSrc).toMatch(/InlineInput[\s\S]*?id="input-billing-postal"/);
  });

  it("retains all data-testids", () => {
    for (const testid of [
      "input-client-first-name", "input-client-last-name", "input-company-name",
      "checkbox-use-company-primary", "input-contact-phone", "input-contact-email",
      "input-service-street", "input-service-city", "input-service-postal",
      "checkbox-billing-same", "input-billing-street", "input-billing-city",
      "button-save-client",
    ]) {
      expect(createSrc).toMatch(new RegExp(`data-testid="${testid}"`));
    }
  });

  it("checkbox labels remain as raw Label (canonical exception)", () => {
    expect(createSrc).toMatch(/<Label htmlFor="use-company-primary"/);
    expect(createSrc).toMatch(/<Label htmlFor="billing-same"/);
  });

  it("does NOT have raw <Input in code", () => {
    expect(createCode).not.toMatch(/<Input\b/);
  });
});

// ── 2. EditCompanyDialog ──────────────────────────────────────────────

describe("EditCompanyDialog — Phase 2F inline-field migration", () => {
  it("imports InlineInput and InlineSelectTrigger from form-field", () => {
    expect(editSrc).toMatch(/InlineInput/);
    expect(editSrc).toMatch(/InlineSelectTrigger/);
    expect(editSrc).toMatch(/from "@\/components\/ui\/form-field"/);
  });

  it("does NOT import raw Input from @/components/ui/input", () => {
    expect(editSrc).not.toMatch(/from "@\/components\/ui\/input"/);
  });

  it("does NOT import FormLabel", () => {
    expect(editCode).not.toMatch(/\bFormLabel\b/);
  });

  it("does NOT import or use raw SelectTrigger", () => {
    expect(editCode).not.toMatch(/<SelectTrigger[\s/>]/);
    expect(editCode).not.toMatch(/\bSelectTrigger\b(?!s)/);
  });

  it("uses InlineInput for identity fields", () => {
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-first-name"[\s\S]*?label="First name"/);
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-last-name"[\s\S]*?label="Last name"/);
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-company-name"[\s\S]*?label="Company name"/);
  });

  it("uses InlineInput for phone and email", () => {
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-phone"[\s\S]*?label="Phone"/);
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-email"[\s\S]*?label="Email"/);
  });

  it("uses InlineInput for billing address fields", () => {
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-billing-street"[\s\S]*?label="Billing street"/);
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-billing-city"[\s\S]*?label="City"/);
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-billing-province"[\s\S]*?label="Province"/);
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-billing-postal-code"[\s\S]*?label="Postal code"/);
  });

  it("uses InlineSelectTrigger for payment terms select", () => {
    expect(editSrc).toMatch(/InlineSelectTrigger[\s\S]*?id="edit-payment-terms-mode"/);
    expect(editSrc).toMatch(/InlineSelectTrigger[\s\S]*?label="Payment terms"/);
  });

  it("retains FormHelperText for payment terms hint", () => {
    expect(editSrc).toMatch(/<FormHelperText[\s\S]*?data-testid="text-client-payment-terms-helper"/);
  });

  it("uses InlineInput for custom payment days", () => {
    expect(editSrc).toMatch(/InlineInput[\s\S]*?id="edit-payment-terms-custom-days"[\s\S]*?label="Custom days"/);
  });

  it("checkbox row label stays as raw Label (canonical exception)", () => {
    expect(editSrc).toMatch(/<Label htmlFor="edit-use-company-primary"/);
  });

  it("retains data-testid for payment terms select and custom days input", () => {
    expect(editSrc).toMatch(/data-testid="select-client-payment-terms"/);
    expect(editSrc).toMatch(/data-testid="input-client-payment-terms-custom-days"/);
  });

  it("does NOT have raw <Input in code", () => {
    expect(editCode).not.toMatch(/<Input\b/);
  });
});

// ── 3. AddEquipmentDialog ─────────────────────────────────────────────

describe("AddEquipmentDialog — Phase 2F inline-field migration", () => {
  it("imports InlineInput and InlineTextarea from form-field", () => {
    expect(equipSrc).toMatch(/InlineInput/);
    expect(equipSrc).toMatch(/InlineTextarea/);
    expect(equipSrc).toMatch(/from "@\/components\/ui\/form-field"/);
  });

  it("does NOT import raw Input from @/components/ui/input", () => {
    expect(equipSrc).not.toMatch(/from "@\/components\/ui\/input"/);
  });

  it("does NOT import raw Textarea from @/components/ui/textarea", () => {
    expect(equipSrc).not.toMatch(/from "@\/components\/ui\/textarea"/);
  });

  it("does NOT have FormLabel srOnly for any field", () => {
    expect(equipCode).not.toMatch(/<FormLabel[\s\S]*?srOnly/);
  });

  it("uses InlineInput for equipment name with required prop", () => {
    expect(equipSrc).toMatch(/InlineInput[\s\S]*?id="eq-name"[\s\S]*?label="Equipment Name"[\s\S]*?required/);
  });

  it("uses InlineInput for manufacturer and model", () => {
    expect(equipSrc).toMatch(/InlineInput[\s\S]*?id="eq-manufacturer"[\s\S]*?label="Manufacturer"/);
    expect(equipSrc).toMatch(/InlineInput[\s\S]*?id="eq-model"[\s\S]*?label="Model Number"/);
  });

  it("uses InlineInput for serial number", () => {
    expect(equipSrc).toMatch(/InlineInput[\s\S]*?id="eq-serial"[\s\S]*?label="Serial Number"/);
  });

  it("uses InlineTextarea for notes with rows={2}", () => {
    expect(equipSrc).toMatch(/InlineTextarea[\s\S]*?id="eq-notes"[\s\S]*?rows=\{2\}/);
  });

  it("EquipmentTypeCombobox keeps visible FormLabel (custom widget — cannot accept inline label)", () => {
    expect(equipSrc).toMatch(/<FormLabel>Type<\/FormLabel>/);
    expect(equipSrc).toMatch(/<EquipmentTypeCombobox/);
  });

  it("does NOT have raw <Input or <Textarea in code", () => {
    expect(equipCode).not.toMatch(/<Input\b/);
    expect(equipCode).not.toMatch(/<Textarea\b/);
  });

  it("preserves all field IDs", () => {
    for (const id of ["eq-name", "eq-manufacturer", "eq-model", "eq-serial", "eq-notes"]) {
      expect(equipSrc).toMatch(new RegExp(`id="${id}"`));
    }
  });
});
