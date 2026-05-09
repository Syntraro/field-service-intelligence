import { Package } from "lucide-react";
import type { ImportWizardConfig } from "../types";
import { PRODUCT_FIELD_DEFS } from "@shared/importPipeline/zod/product";
import { jobberProductsPreset } from "../presets";

const TEMPLATE_CSV = [
  "Name,Description,Category,Unit Price,Unit Cost,Taxable,Active,Duration (minutes),SKU",
  "Furnace Filter 16x20,Standard pleated filter,product,29.99,12.00,yes,yes,,FILT-16X20",
  "Diagnostic Service,Standard diagnostic visit,service,129.00,,yes,yes,60,no,SVC-DIAG",
].join("\n");

export const productImportConfig: ImportWizardConfig = {
  entity: "products",
  title: "Import products & services",
  description: "Upload a CSV of catalog items (products, services, parts). Duplicates are detected by SKU or by name+type.",
  rowNoun: "items",
  icon: Package,
  fieldDefs: [...PRODUCT_FIELD_DEFS],
  template: { filename: "products-template.csv", csv: TEMPLATE_CSV },
  uploadBanner:
    "Items default to taxable and active when those columns aren't mapped. Map them yourself if your catalog has non-default values.",
  commitBanner:
    "This imports catalog items (products, services, parts). Items that already exist (matched by SKU or name+type) are updated rather than duplicated.",
  presets: [jobberProductsPreset],
  // 2026-04-22 Phase 2b: Products / Services import can attach custom fields
  // to the catalog item (item entity on the canonical Reference-Fields system).
  customFieldEntities: [{ id: "item", label: "Product / Service" }],
};
