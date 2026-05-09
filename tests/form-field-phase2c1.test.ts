/**
 * Phase 2C-1 through 2C-6 form-field canonicalization — source-pin tests (2026-05-08/09).
 *
 * 2C-1: QuickAddSupplierDialog, AddEquipmentDialog, QboOverrideModal
 * 2C-2: AddLocationDialog, EditLocationDialog (supplier address twin dialogs)
 * 2C-3: CreateClientModal (client identity + service/billing address sections)
 * 2C-4: ProductServiceFormDialog (type/sku, name, pricing section, duration/category)
 * 2C-5: LocationFormModal (location name, site code, service address, switch cards)
 * 2C-6: CreateClientPage, CreateJobPage, CreateLeadPage, CreateTaskPage (tech-app pages)
 *
 * Locks the contract that all twelve targets use canonical form primitives
 * (FormField, FormLabel, FormRow, FormSection, FormHelperText, FormErrorText)
 * and no longer contain the raw drift patterns they shipped with.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const p = (rel: string) => resolve(ROOT, rel);

const supplierSrc = readFileSync(p("client/src/components/suppliers/QuickAddSupplierDialog.tsx"), "utf-8");
const equipmentSrc = readFileSync(p("client/src/components/AddEquipmentDialog.tsx"), "utf-8");
const qboSrc = readFileSync(p("client/src/components/invoice/QboOverrideModal.tsx"), "utf-8");
const addLocationSrc = readFileSync(p("client/src/components/suppliers/AddLocationDialog.tsx"), "utf-8");
const editLocationSrc = readFileSync(p("client/src/components/suppliers/EditLocationDialog.tsx"), "utf-8");
const createClientSrc = readFileSync(p("client/src/components/CreateClientModal.tsx"), "utf-8");
const psFormSrc = readFileSync(p("client/src/components/products-services/ProductServiceFormDialog.tsx"), "utf-8");
const locationFormSrc = readFileSync(p("client/src/components/LocationFormModal.tsx"), "utf-8");
const techCreateClientSrc = readFileSync(p("client/src/tech-app/pages/CreateClientPage.tsx"), "utf-8");
const techCreateJobSrc = readFileSync(p("client/src/tech-app/pages/CreateJobPage.tsx"), "utf-8");
const techCreateLeadSrc = readFileSync(p("client/src/tech-app/pages/CreateLeadPage.tsx"), "utf-8");
const techCreateTaskSrc = readFileSync(p("client/src/tech-app/pages/CreateTaskPage.tsx"), "utf-8");

// ─── 1. QuickAddSupplierDialog ──────────────────────────────────────

describe("QuickAddSupplierDialog — canonical form primitives", () => {
  it("imports FormField, FormLabel, FormRow from form-field", () => {
    expect(supplierSrc).toMatch(/import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/);
    expect(supplierSrc).toMatch(/FormLabel/);
    expect(supplierSrc).toMatch(/FormRow/);
  });

  it("does NOT import Label from @/components/ui/label", () => {
    expect(supplierSrc).not.toMatch(/import.*Label.*from\s*["']@\/components\/ui\/label["']/);
  });

  it("uses FormField wrappers (not bare <div> field containers)", () => {
    expect(supplierSrc).toMatch(/<FormField>/);
  });

  it("uses FormRow for the email/phone two-column row", () => {
    expect(supplierSrc).toMatch(/<FormRow\s+className="grid-cols-2">/);
  });

  it("uses FormLabel with srOnly for text inputs", () => {
    expect(supplierSrc).toMatch(/<FormLabel\s[^>]*srOnly/);
  });

  it("does NOT use raw <Label> elements", () => {
    expect(supplierSrc).not.toMatch(/<Label\s/);
  });

  it("does NOT use bare div field wrapper pattern (div>Label>Input)", () => {
    expect(supplierSrc).not.toMatch(/<div>\s*\n\s*<Label/);
  });

  it("does NOT use the old grid row div pattern", () => {
    expect(supplierSrc).not.toMatch(/className="grid grid-cols-2 gap-3"/);
  });
});

// ─── 2. AddEquipmentDialog ──────────────────────────────────────────

describe("AddEquipmentDialog — canonical form primitives", () => {
  it("imports FormField, FormLabel, FormRow from form-field", () => {
    expect(equipmentSrc).toMatch(/import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/);
    expect(equipmentSrc).toMatch(/FormLabel/);
    expect(equipmentSrc).toMatch(/FormRow/);
  });

  it("does NOT import Label from @/components/ui/label", () => {
    expect(equipmentSrc).not.toMatch(/import.*Label.*from\s*["']@\/components\/ui\/label["']/);
  });

  it("uses FormField wrappers", () => {
    expect(equipmentSrc).toMatch(/<FormField>/);
  });

  it("uses FormRow for the manufacturer/model two-column row", () => {
    expect(equipmentSrc).toMatch(/<FormRow\s+className="grid-cols-2">/);
  });

  it("uses FormLabel with srOnly for text inputs", () => {
    expect(equipmentSrc).toMatch(/<FormLabel\s[^>]*srOnly/);
  });

  it("does NOT use raw <Label> elements", () => {
    expect(equipmentSrc).not.toMatch(/<Label\s/);
  });

  it("does NOT use the old gap-1.5 field wrapper div pattern", () => {
    expect(equipmentSrc).not.toMatch(/className="grid gap-1\.5"/);
  });

  it("does NOT use the old grid row div pattern", () => {
    expect(equipmentSrc).not.toMatch(/className="grid grid-cols-2 gap-3"/);
  });

  it("preserves compact input density (h-8 text-sm)", () => {
    expect(equipmentSrc).toMatch(/className="h-8 text-sm"/);
  });
});

// ─── 3. QboOverrideModal ────────────────────────────────────────────

describe("QboOverrideModal — canonical form primitives for reason field", () => {
  it("imports FormField, FormLabel, FormHelperText, FormErrorText from form-field", () => {
    expect(qboSrc).toMatch(/import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/);
    expect(qboSrc).toMatch(/FormLabel/);
    expect(qboSrc).toMatch(/FormHelperText/);
    expect(qboSrc).toMatch(/FormErrorText/);
  });

  it("still imports Label for the acknowledgement checkbox (visible label kept)", () => {
    expect(qboSrc).toMatch(/import.*Label.*from\s*["']@\/components\/ui\/label["']/);
  });

  it("uses FormField for the reason textarea field", () => {
    expect(qboSrc).toMatch(/<FormField>/);
  });

  it("uses FormLabel (NOT srOnly) for the visible reason field label", () => {
    expect(qboSrc).toMatch(/<FormLabel\s+htmlFor="reason">/);
    // The reason label stays visible — it is NOT srOnly
    expect(qboSrc).not.toMatch(/<FormLabel\s+htmlFor="reason"\s+srOnly/);
  });

  it("uses FormErrorText for the inline validation error", () => {
    expect(qboSrc).toMatch(/<FormErrorText>/);
  });

  it("uses FormHelperText for the minimum-characters hint", () => {
    expect(qboSrc).toMatch(/<FormHelperText>/);
  });

  it("does NOT use raw <p className='text-xs text-destructive'> for validation error", () => {
    expect(qboSrc).not.toMatch(/<p\s+className="text-xs text-destructive"/);
  });

  it("does NOT use raw space-y-2 div wrapper for the reason field", () => {
    expect(qboSrc).not.toMatch(/<div\s+className="space-y-2">/);
  });

  it("helper text still carries the min-10-characters hint", () => {
    expect(qboSrc).toMatch(/Minimum 10 characters/);
  });
});

// ─── Phase 2C-2: supplier address twin dialogs ──────────────────────

// Shared assertions for both AddLocationDialog and EditLocationDialog so
// the two files stay structurally aligned.
function assertLocationDialogCanonical(src: string, label: string) {
  describe(`${label} — canonical form primitives`, () => {
    it("imports FormField, FormLabel, FormRow from form-field", () => {
      expect(src).toMatch(/import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/);
      expect(src).toMatch(/FormLabel/);
      expect(src).toMatch(/FormRow/);
    });

    it("keeps Label import for the checkbox/switch visible label", () => {
      expect(src).toMatch(/import.*Label.*from\s*["']@\/components\/ui\/label["']/);
    });

    it("uses FormField wrappers for text inputs", () => {
      expect(src).toMatch(/<FormField>/);
    });

    it("uses FormLabel with srOnly for text inputs", () => {
      expect(src).toMatch(/<FormLabel\s[^>]*srOnly/);
    });

    it("uses FormRow for the 3-column city/province/postal row", () => {
      expect(src).toMatch(/<FormRow\s+className="md:grid-cols-3">/);
    });

    it("uses FormRow for the 2-column contact/phone row", () => {
      expect(src).toMatch(/<FormRow\s+className="md:grid-cols-2">/);
    });

    it("does NOT use bare div field wrapper pattern (div>Label>Input)", () => {
      // The migrated fields should not have bare <div>\n<Label pattern
      expect(src).not.toMatch(/<div>\s*\n\s*<Label\s+htmlFor/);
    });

    it("does NOT use the old 3-column grid div pattern", () => {
      expect(src).not.toMatch(/className="grid md:grid-cols-3 gap-4"/);
    });

    it("does NOT use the old 2-column grid div pattern", () => {
      expect(src).not.toMatch(/className="grid md:grid-cols-2 gap-4"/);
    });

    it("the name field placeholder communicates the required indicator", () => {
      expect(src).toMatch(/placeholder="Location Name \*"/);
    });

    it("all address fields are present (name, address, address2, city, province, postalCode, country)", () => {
      expect(src).toMatch(/htmlFor=["'][a-z-]*(?:location-name|edit-location-name)["']/);
      expect(src).toMatch(/placeholder="Street address"/);
      expect(src).toMatch(/placeholder="Suite, Unit, Floor \(optional\)"/);
      expect(src).toMatch(/placeholder="City"/);
      expect(src).toMatch(/placeholder="Province"/);
      expect(src).toMatch(/placeholder="Postal Code"/);
      expect(src).toMatch(/placeholder="Country"/);
    });
  });
}

assertLocationDialogCanonical(addLocationSrc, "AddLocationDialog");
assertLocationDialogCanonical(editLocationSrc, "EditLocationDialog");

describe("AddLocationDialog — isPrimary checkbox keeps visible Label", () => {
  it("checkbox row still uses raw Label (not FormLabel)", () => {
    expect(addLocationSrc).toMatch(/<Label\s+htmlFor="isPrimary"/);
  });

  it("does NOT render FormLabel on the isPrimary checkbox", () => {
    expect(addLocationSrc).not.toMatch(/<FormLabel\s[^>]*htmlFor="isPrimary"/);
  });
});

describe("EditLocationDialog — isActive switch keeps visible Label", () => {
  it("switch row still uses raw Label (not FormLabel)", () => {
    expect(editLocationSrc).toMatch(/<Label\s+htmlFor="edit-isActive"/);
  });

  it("does NOT render FormLabel on the isActive switch", () => {
    expect(editLocationSrc).not.toMatch(/<FormLabel\s[^>]*htmlFor="edit-isActive"/);
  });

  it("switch row preserves justify-between layout for the Active toggle", () => {
    expect(editLocationSrc).toMatch(/justify-between/);
  });
});

// ─── Phase 2C-3: CreateClientModal ──────────────────────────────────

describe("CreateClientModal — canonical form primitives imported", () => {
  it("imports FormSection, FormField, FormLabel, FormRow, FormErrorText from form-field", () => {
    expect(createClientSrc).toMatch(
      /import\s*\{[^}]*FormSection[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/,
    );
    expect(createClientSrc).toMatch(/\bFormField\b/);
    expect(createClientSrc).toMatch(/\bFormLabel\b/);
    expect(createClientSrc).toMatch(/\bFormRow\b/);
    expect(createClientSrc).toMatch(/\bFormErrorText\b/);
  });

  it("retains Label import for checkbox rows (visible label canonical rule)", () => {
    expect(createClientSrc).toMatch(
      /import.*\bLabel\b.*from\s*["']@\/components\/ui\/label["']/,
    );
  });
});

describe("CreateClientModal — FormSection sections present", () => {
  it("uses FormSection for the Client Identity group", () => {
    expect(createClientSrc).toMatch(/FormSection\s+title="Client Identity/);
  });

  it("uses FormSection for the Primary Service Address group", () => {
    expect(createClientSrc).toMatch(/FormSection\s+title="Primary Service Address/);
  });

  it("uses FormSection for the Billing Address group", () => {
    expect(createClientSrc).toMatch(/FormSection\s+title="Billing Address"/);
  });

  it("does NOT use raw <fieldset> elements", () => {
    expect(createClientSrc).not.toMatch(/<fieldset/);
  });

  it("does NOT use raw <legend> elements", () => {
    expect(createClientSrc).not.toMatch(/<legend/);
  });
});

describe("CreateClientModal — FormField / FormLabel usage", () => {
  it("uses FormField wrappers for inputs", () => {
    expect(createClientSrc).toMatch(/<FormField>/);
  });

  it("uses FormLabel with srOnly for text inputs inside sections (service address)", () => {
    expect(createClientSrc).toMatch(/<FormLabel\s[^>]*srOnly[^>]*htmlFor="input-service-street"|<FormLabel\s+htmlFor="input-service-street"\s+srOnly/);
  });

  it("uses FormLabel with srOnly for billing address inputs", () => {
    expect(createClientSrc).toMatch(/<FormLabel\s[^>]*srOnly[^>]*htmlFor="input-billing-street"|<FormLabel\s+htmlFor="input-billing-street"\s+srOnly/);
  });

  it("uses FormLabel with srOnly for first/last name inputs", () => {
    expect(createClientSrc).toMatch(/<FormLabel\s[^>]*srOnly[^>]*htmlFor="input-client-first-name"|<FormLabel\s+htmlFor="input-client-first-name"\s+srOnly/);
  });

  it("does NOT use raw space-y-1 field wrapper divs", () => {
    expect(createClientSrc).not.toMatch(/className="space-y-1"/);
  });

  it("does NOT use raw space-y-1.5 field wrapper divs", () => {
    expect(createClientSrc).not.toMatch(/<div\s+className="space-y-1\.5"/);
  });
});

describe("CreateClientModal — FormRow grid rows", () => {
  it("uses FormRow grid-cols-2 for the first/last name row", () => {
    expect(createClientSrc).toMatch(/<FormRow\s+className="grid-cols-2">/);
  });

  it("uses FormRow grid-cols-3 for city/province/postal rows", () => {
    expect(createClientSrc).toMatch(/<FormRow\s+className="grid-cols-3">/);
  });

  it("does NOT use raw <div className='grid grid-cols-2 ...'> field rows", () => {
    expect(createClientSrc).not.toMatch(/<div\s+className="grid grid-cols-2/);
  });

  it("does NOT use raw <div className='grid grid-cols-3 ...'> field rows", () => {
    expect(createClientSrc).not.toMatch(/<div\s+className="grid grid-cols-3/);
  });
});

describe("CreateClientModal — FormErrorText for validation errors", () => {
  it("uses FormErrorText for the email validation error", () => {
    expect(createClientSrc).toMatch(/<FormErrorText/);
  });

  it("does NOT use raw <p className='text-xs text-destructive'> for inline errors", () => {
    expect(createClientSrc).not.toMatch(/<p\s+className="text-xs text-destructive"/);
  });

  it("email error carries a data-testid for traceability", () => {
    expect(createClientSrc).toMatch(/data-testid="contact-email-error"/);
  });
});

describe("CreateClientModal — checkbox rows keep raw Label (canonical rule)", () => {
  it("use-company-primary checkbox has a visible raw Label", () => {
    expect(createClientSrc).toMatch(/<Label\s+htmlFor="use-company-primary"/);
  });

  it("billing-same checkbox has a visible raw Label", () => {
    expect(createClientSrc).toMatch(/<Label\s+htmlFor="billing-same"/);
  });

  it("does NOT render FormLabel on checkbox rows", () => {
    expect(createClientSrc).not.toMatch(/<FormLabel\s[^>]*htmlFor="use-company-primary"/);
    expect(createClientSrc).not.toMatch(/<FormLabel\s[^>]*htmlFor="billing-same"/);
  });
});

// ─── Phase 2C-4: ProductServiceFormDialog ───────────────────────────

describe("ProductServiceFormDialog — canonical form primitives imported", () => {
  it("imports FormField, FormLabel, FormRow, FormSection, FormErrorText from form-field", () => {
    expect(psFormSrc).toMatch(
      /import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/,
    );
    expect(psFormSrc).toMatch(/\bFormSection\b/);
    expect(psFormSrc).toMatch(/\bFormRow\b/);
    expect(psFormSrc).toMatch(/\bFormErrorText\b/);
  });

  it("retains Label import for checkbox rows (visible label canonical rule)", () => {
    expect(psFormSrc).toMatch(
      /import.*\bLabel\b.*from\s*["']@\/components\/ui\/label["']/,
    );
  });
});

describe("ProductServiceFormDialog — setField rename (no setFormField)", () => {
  it("uses setField as the mutation helper name", () => {
    expect(psFormSrc).toMatch(/const setField\s*=/);
  });

  it("does NOT contain setFormField (causes false-positive FormField audits)", () => {
    expect(psFormSrc).not.toMatch(/\bsetFormField\b/);
  });
});

describe("ProductServiceFormDialog — FormSection + FormRow field rows", () => {
  it("Pricing fields are inside a FormSection with border-t pt-2", () => {
    expect(psFormSrc).toMatch(/FormSection\s+title="Pricing"\s+className="border-t pt-2"/);
  });

  it("does NOT use a bare <div className='border-t pt-2'> as a named section wrapper", () => {
    // The pre-migration pattern was a plain div with only border-t pt-2 acting as
    // a section container. Now it's FormSection. The remaining border-t uses are
    // on FormRow (visual separator, no title) and the flex checkbox div.
    expect(psFormSrc).not.toMatch(/<div\s+className="border-t pt-2">/);
  });

  it("uses FormRow grid-cols-3 for cost/markup/price pricing row", () => {
    expect(psFormSrc).toMatch(/<FormRow\s+className="grid-cols-3">/);
  });

  it("uses FormRow grid-cols-2 for type/sku and duration/category rows", () => {
    const matches = psFormSrc.match(/<FormRow\s+className="grid-cols-2[^"]*">/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT use raw <div className='grid grid-cols-2'> for field rows", () => {
    expect(psFormSrc).not.toMatch(/<div\s+className="grid grid-cols-2/);
  });

  it("does NOT use raw <div className='grid grid-cols-3'> for field rows", () => {
    expect(psFormSrc).not.toMatch(/<div\s+className="grid grid-cols-3/);
  });
});

describe("ProductServiceFormDialog — FormField / FormLabel usage", () => {
  it("uses FormField wrappers for inputs", () => {
    expect(psFormSrc).toMatch(/<FormField>/);
  });

  it("uses srOnly FormLabel for text/number inputs (sku, name, cost, markup, price, duration)", () => {
    expect(psFormSrc).toMatch(/<FormLabel\s[^>]*srOnly[^>]*htmlFor="ps-sku"|<FormLabel\s+htmlFor="ps-sku"\s+srOnly/);
    expect(psFormSrc).toMatch(/<FormLabel\s[^>]*srOnly[^>]*htmlFor="ps-name"|<FormLabel\s+htmlFor="ps-name"\s+srOnly/);
    expect(psFormSrc).toMatch(/<FormLabel\s[^>]*srOnly[^>]*htmlFor="ps-cost"|<FormLabel\s+htmlFor="ps-cost"\s+srOnly/);
    expect(psFormSrc).toMatch(/<FormLabel\s[^>]*srOnly[^>]*htmlFor="ps-duration"|<FormLabel\s+htmlFor="ps-duration"\s+srOnly/);
  });

  it("uses visible FormLabel (no srOnly) for Select fields (Type, Category)", () => {
    expect(psFormSrc).toMatch(/<FormLabel>Type \*/);
    expect(psFormSrc).toMatch(/<FormLabel>Category/);
  });

  it("does NOT use raw space-y-1 or space-y-1.5 field wrapper divs", () => {
    expect(psFormSrc).not.toMatch(/<div\s+className="space-y-1[^"]*"/);
  });
});

describe("ProductServiceFormDialog — FormErrorText for validation errors", () => {
  it("uses FormErrorText for the duplicate name error", () => {
    expect(psFormSrc).toMatch(/<FormErrorText>/);
  });

  it("does NOT use raw <p className='text-xs text-destructive'> for inline errors", () => {
    expect(psFormSrc).not.toMatch(/<p\s+className="text-xs text-destructive"/);
  });
});

describe("ProductServiceFormDialog — checkbox rows keep raw Label (canonical rule)", () => {
  it("taxable checkbox has a visible raw Label", () => {
    expect(psFormSrc).toMatch(/<Label\s+htmlFor="taxable"/);
  });

  it("active checkbox has a visible raw Label", () => {
    expect(psFormSrc).toMatch(/<Label\s+htmlFor="active"/);
  });

  it("does NOT render FormLabel on checkbox rows", () => {
    expect(psFormSrc).not.toMatch(/<FormLabel\s[^>]*htmlFor="taxable"/);
    expect(psFormSrc).not.toMatch(/<FormLabel\s[^>]*htmlFor="active"/);
  });
});

describe("ProductServiceFormDialog — dialog identity preserved", () => {
  it("dialog carries data-testid='dialog-product'", () => {
    expect(psFormSrc).toMatch(/data-testid="dialog-product"/);
  });

  it("save button carries data-testid='button-save'", () => {
    expect(psFormSrc).toMatch(/data-testid="button-save"/);
  });
});

// ─── Phase 2C-5: LocationFormModal ──────────────────────────────────

describe("LocationFormModal — canonical form primitives imported", () => {
  it("imports FormField, FormLabel, FormHelperText, FormRow from form-field", () => {
    expect(locationFormSrc).toMatch(
      /import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/,
    );
    expect(locationFormSrc).toMatch(/\bFormLabel\b/);
    expect(locationFormSrc).toMatch(/\bFormHelperText\b/);
    expect(locationFormSrc).toMatch(/\bFormRow\b/);
  });

  it("does NOT import Label (switch cards use FormLabel, no raw Label needed)", () => {
    expect(locationFormSrc).not.toMatch(
      /import.*\bLabel\b.*from\s*["']@\/components\/ui\/label["']/,
    );
  });

  it("does NOT use raw <Label> elements anywhere in the file", () => {
    expect(locationFormSrc).not.toMatch(/<Label[\s>]/);
  });
});

describe("LocationFormModal — text input fields use FormField + FormLabel", () => {
  it("location-name field is wrapped in FormField with visible FormLabel", () => {
    expect(locationFormSrc).toMatch(/<FormLabel\s+htmlFor="location-name">Location Name/);
  });

  it("site-code field is wrapped in FormField with visible FormLabel", () => {
    expect(locationFormSrc).toMatch(/<FormLabel\s+htmlFor="site-code">Site Code/);
  });

  it("Service Address group has a visible FormLabel", () => {
    expect(locationFormSrc).toMatch(/<FormLabel>Service Address/);
  });

  it("location-name field has FormHelperText guidance hint", () => {
    expect(locationFormSrc).toMatch(
      /FormHelperText>Enter a location name, or provide street address and city\./,
    );
  });

  it("does NOT use raw space-y-1 wrapper divs for field stacks", () => {
    expect(locationFormSrc).not.toMatch(/<div\s+className="space-y-1"/);
  });

  it("does NOT use raw space-y-1.5 wrapper divs for field stacks", () => {
    expect(locationFormSrc).not.toMatch(/<div\s+className="space-y-1\.5"/);
  });
});

describe("LocationFormModal — address subfields use FormRow (no raw grid divs)", () => {
  it("city/province row uses FormRow grid-cols-2", () => {
    expect(locationFormSrc).toMatch(/<FormRow\s+className="grid-cols-2">/);
  });

  it("does NOT use raw <div className='grid grid-cols-2'> for field rows", () => {
    expect(locationFormSrc).not.toMatch(/<div\s+className="grid grid-cols-2/);
  });

  it("AddressAutocomplete component is still present and unchanged", () => {
    expect(locationFormSrc).toMatch(/AddressAutocomplete/);
    expect(locationFormSrc).toMatch(/onPlaceSelect/);
  });
});

describe("LocationFormModal — switch cards use FormField + FormLabel + FormHelperText", () => {
  it("billWithParent switch card uses FormLabel with htmlFor", () => {
    expect(locationFormSrc).toMatch(/<FormLabel\s+htmlFor="bill-with-parent"/);
  });

  it("billWithParent switch has matching id", () => {
    expect(locationFormSrc).toMatch(/id="bill-with-parent"/);
  });

  it("billWithParent switch card uses FormHelperText for the description", () => {
    expect(locationFormSrc).toMatch(
      /FormHelperText>[\s\S]*?Invoices for this location will be billed/,
    );
  });

  it("isActive switch card uses FormLabel with htmlFor", () => {
    expect(locationFormSrc).toMatch(/<FormLabel\s+htmlFor="is-active"/);
  });

  it("isActive switch has matching id", () => {
    expect(locationFormSrc).toMatch(/id="is-active"/);
  });

  it("isActive switch card uses FormHelperText for the description", () => {
    expect(locationFormSrc).toMatch(
      /FormHelperText>[\s\S]*?Inactive locations are hidden from schedules/,
    );
  });

  it("does NOT use raw <p className='text-xs text-muted-foreground'> in switch cards", () => {
    expect(locationFormSrc).not.toMatch(/<p\s+className="text-xs text-muted-foreground"/);
  });
});

// ─── Phase 2C-6: tech-app pages ─────────────────────────────────────

describe("CreateClientPage — canonical form primitives imported", () => {
  it("imports FormField and FormLabel from form-field", () => {
    expect(techCreateClientSrc).toMatch(
      /import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/,
    );
    expect(techCreateClientSrc).toMatch(/\bFormLabel\b/);
  });

  it("does NOT import Label from @/components/ui/label", () => {
    expect(techCreateClientSrc).not.toMatch(
      /import.*\bLabel\b.*from\s*["']@\/components\/ui\/label["']/,
    );
  });
});

describe("CreateClientPage — field wrappers use FormField + FormLabel", () => {
  it("uses FormField wrappers for fields", () => {
    expect(techCreateClientSrc).toMatch(/<FormField/);
    expect(techCreateClientSrc).toMatch(/<FormLabel\s+htmlFor=/);
  });

  it("Company Name field uses FormField + FormLabel", () => {
    expect(techCreateClientSrc).toMatch(/<FormLabel\s+htmlFor="tech-cc-company"/);
  });

  it("Phone field uses FormField + FormLabel", () => {
    expect(techCreateClientSrc).toMatch(/<FormLabel\s+htmlFor="tech-cc-phone"/);
  });

  it("Address field uses FormField + FormLabel", () => {
    expect(techCreateClientSrc).toMatch(/<FormLabel\s+htmlFor="tech-cc-address"/);
  });

  it("flex-1 column wrappers use FormField (not bare div) for First/Last name row", () => {
    expect(techCreateClientSrc).toMatch(/<FormField\s+className="flex-1">/);
  });

  it("w-24 column wrapper uses FormField (not bare div) for Province", () => {
    expect(techCreateClientSrc).toMatch(/<FormField\s+className="w-24">/);
  });

  it("w-32 postal code wrapper uses FormField (not bare div)", () => {
    expect(techCreateClientSrc).toMatch(/<FormField\s+className="w-32">/);
  });

  it("does NOT use the old bare-div + Label block mb-1 pattern", () => {
    expect(techCreateClientSrc).not.toMatch(/<Label[^>]*className="block mb-1"/);
  });
});

describe("CreateJobPage — canonical form primitives imported", () => {
  it("imports FormField and FormLabel from form-field", () => {
    expect(techCreateJobSrc).toMatch(
      /import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/,
    );
    expect(techCreateJobSrc).toMatch(/\bFormLabel\b/);
  });

  it("does NOT import Label from @/components/ui/label", () => {
    expect(techCreateJobSrc).not.toMatch(
      /import.*\bLabel\b.*from\s*["']@\/components\/ui\/label["']/,
    );
  });
});

describe("CreateJobPage — field wrappers use FormField + FormLabel", () => {
  it("Location field uses FormField + FormLabel", () => {
    expect(techCreateJobSrc).toMatch(/<FormLabel>Location \*<\/FormLabel>/);
  });

  it("Summary field uses FormField + FormLabel", () => {
    expect(techCreateJobSrc).toMatch(/<FormLabel>Summary \*<\/FormLabel>/);
  });

  it("Assigned To field uses FormField + FormLabel", () => {
    expect(techCreateJobSrc).toMatch(/<FormLabel>Assigned To<\/FormLabel>/);
  });

  it("Scheduling field uses FormField + FormLabel", () => {
    expect(techCreateJobSrc).toMatch(/<FormLabel>Scheduling<\/FormLabel>/);
  });

  it("Description field uses FormField + FormLabel", () => {
    expect(techCreateJobSrc).toMatch(/<FormLabel>Description<\/FormLabel>/);
  });

  it("does NOT use the old bare-div + Label block mb-1 pattern for outer fields", () => {
    expect(techCreateJobSrc).not.toMatch(/<Label[^>]*className="block mb-1"/);
  });

  it("preserves scheduling compact labels (text-[10px]) untouched", () => {
    expect(techCreateJobSrc).toMatch(/text-\[10px\]/);
    expect(techCreateJobSrc).toMatch(/<label\s+className="text-\[10px\]/);
  });
});

describe("CreateLeadPage — canonical form primitives imported", () => {
  it("imports FormField and FormLabel from form-field", () => {
    expect(techCreateLeadSrc).toMatch(
      /import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/,
    );
    expect(techCreateLeadSrc).toMatch(/\bFormLabel\b/);
  });

  it("does NOT import Label from @/components/ui/label", () => {
    expect(techCreateLeadSrc).not.toMatch(
      /import.*\bLabel\b.*from\s*["']@\/components\/ui\/label["']/,
    );
  });
});

describe("CreateLeadPage — field wrappers use FormField + FormLabel", () => {
  it("Client/Location field uses FormField + FormLabel", () => {
    expect(techCreateLeadSrc).toMatch(/<FormLabel>Client \/ Location \*<\/FormLabel>/);
  });

  it("Title field uses FormField + FormLabel", () => {
    expect(techCreateLeadSrc).toMatch(/<FormLabel>What did you find\? \*<\/FormLabel>/);
  });

  it("Details field uses FormField + FormLabel", () => {
    expect(techCreateLeadSrc).toMatch(/<FormLabel>Details<\/FormLabel>/);
  });

  it("does NOT use the old bare-div + Label block mb-1 pattern", () => {
    expect(techCreateLeadSrc).not.toMatch(/<Label[^>]*className="block mb-1"/);
  });
});

describe("CreateTaskPage — canonical form primitives imported", () => {
  it("imports FormField and FormLabel from form-field", () => {
    expect(techCreateTaskSrc).toMatch(
      /import\s*\{[^}]*FormField[^}]*\}\s*from\s*["']@\/components\/ui\/form-field["']/,
    );
    expect(techCreateTaskSrc).toMatch(/\bFormLabel\b/);
  });

  it("does NOT import Label from @/components/ui/label", () => {
    expect(techCreateTaskSrc).not.toMatch(
      /import.*\bLabel\b.*from\s*["']@\/components\/ui\/label["']/,
    );
  });
});

describe("CreateTaskPage — field wrappers use FormField + FormLabel", () => {
  it("Title field uses FormField + FormLabel", () => {
    expect(techCreateTaskSrc).toMatch(/<FormLabel>Title \*<\/FormLabel>/);
  });

  it("Supplier field uses FormField + FormLabel", () => {
    expect(techCreateTaskSrc).toMatch(/<FormLabel>Supplier \*<\/FormLabel>/);
  });

  it("Location field uses FormField + FormLabel", () => {
    expect(techCreateTaskSrc).toMatch(/<FormLabel>Location<\/FormLabel>/);
  });

  it("PO Number field uses FormField + FormLabel", () => {
    expect(techCreateTaskSrc).toMatch(/<FormLabel>PO Number<\/FormLabel>/);
  });

  it("Notes field uses FormField + FormLabel", () => {
    expect(techCreateTaskSrc).toMatch(/<FormLabel>Notes<\/FormLabel>/);
  });

  it("does NOT use the old bare-div + Label block mb-1 pattern", () => {
    expect(techCreateTaskSrc).not.toMatch(/<Label[^>]*className="block mb-1"/);
  });
});
