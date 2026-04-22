import { Users } from "lucide-react";
import type { ImportWizardConfig } from "../types";
import { CLIENT_FIELD_DEFS } from "@shared/importPipeline/zod/client";

const TEMPLATE_CSV = [
  "Company Name,Legal Name,Company Phone,Company Email,Billing Street,Billing City,Billing Province,Billing Postal Code,Location Name,Service Street,Service City,Service Province,Service Postal Code,Site Code,Contact First Name,Contact Last Name,Contact Email,Contact Phone",
  "Acme Heating Ltd,Acme Heating Limited,416-555-0101,info@acme.example,100 Head Office Rd,Toronto,ON,M5V 2T6,Acme Main Office,123 Main St,Toronto,ON,M5V 2T6,ROOF-A1,Jane,Doe,jane@acme.example,416-555-0199",
  "Basil HVAC Inc,Basil HVAC Incorporated,905-555-0202,office@basil.example,45 Pine Rd,Mississauga,ON,L5B 3Y9,Basil North Branch,,,,,,John,Smith,,905-555-0288",
].join("\n");

export const clientImportConfig: ImportWizardConfig = {
  entity: "clients",
  title: "Import clients",
  description: "Upload a CSV to create customer companies, service locations, and primary contacts in one pass.",
  rowNoun: "client rows",
  icon: Users,
  fieldDefs: CLIENT_FIELD_DEFS.map((f) => ({ ...f })),
  template: { filename: "clients-template.csv", csv: TEMPLATE_CSV },
  uploadBanner:
    "One CSV row = one company + one location + one optional contact. Existing companies (matched by normalized name) gain the location/contact without duplicating; matching addresses are skipped.",
  commitBanner:
    "This creates companies, locations, and contacts in your tenant. Subscription location limits are enforced server-side. Duplicates detected in the preview won't be committed.",
};
