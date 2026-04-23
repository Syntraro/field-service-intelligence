import { Users } from "lucide-react";
import type { ImportWizardConfig } from "../types";
import { CLIENT_FIELD_DEFS } from "@shared/importPipeline/zod/client";
import { jobberClientsPreset } from "../presets";

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
    "Each row becomes one client with an optional service location and primary contact. If a client with the same name already exists, the new location and contact are added to them instead of creating a duplicate.",
  commitBanner:
    "This imports clients, locations, and contacts. Duplicate rows found in preview will not be imported.",
  presets: [jobberClientsPreset],
  // 2026-04-22 Phase 2b: Clients import writes one row into up to three
  // canonical entities (customer_company + client_location + client_contact).
  // Custom fields can target the Client or Location; column-name heuristics
  // (roof|gate|alarm|filter|PM|building|access) default to Location.
  customFieldEntities: [
    { id: "customer_company", label: "Client" },
    { id: "client_location", label: "Location" },
  ],
};
