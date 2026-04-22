import { Package } from "lucide-react";
import type { ImportWizardConfig } from "../types";
import { PRODUCT_FIELD_DEFS } from "@shared/importPipeline/zod/product";

const TEMPLATE_CSV = [
  "Name,Description,Category,Unit Price,Unit Cost,Taxable,Active,Duration (minutes),Track Inventory,SKU",
  "Furnace Filter 16x20,Standard pleated filter,product,29.99,12.00,yes,yes,,yes,FILT-16X20",
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
    "Products default to taxable = yes and active = yes when the column is not mapped. Map the Taxable/Active columns explicitly if your catalog has non-default values.",
  commitBanner:
    "This will create catalog items in your tenant. Existing items with the same name+type or SKU are matched (not duplicated).",
};
