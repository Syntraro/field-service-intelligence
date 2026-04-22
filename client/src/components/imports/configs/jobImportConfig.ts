import { Briefcase } from "lucide-react";
import type { ImportWizardConfig } from "../types";
import { JOB_FIELD_DEFS } from "@shared/importPipeline/zod/job";
import { jobberJobsPreset } from "../presets";

const TEMPLATE_CSV = [
  "Job #,Title,Client Name,Service Property Name,Service Address,Service City,Service Province,Service Postal Code,Created Date,Closed Date,Total Revenue ($),Line Items,Lead Source",
  "1001,Annual PM Visit,Acme Heating Ltd,Acme Main Office,123 Main St,Toronto,ON,M5V 2T6,2024-01-15,2024-01-15,850.00,\"Gas furnace PM; Filter replacement\",Referral",
  "1002,Boiler Repair,Basil HVAC Inc,Basil North Branch,45 Pine Rd,Mississauga,ON,L5B 3Y9,2024-02-10,2024-02-11,1250.00,\"Igniter replacement; Pressure test\",Website",
].join("\n");

export const jobImportConfig: ImportWizardConfig = {
  entity: "jobs",
  title: "Import historical jobs",
  description: "Upload a Jobber-style CSV of closed/historical jobs. Imported jobs are created as archived records.",
  rowNoun: "historical jobs",
  icon: Briefcase,
  fieldDefs: JOB_FIELD_DEFS.map((f) => ({ ...f })),
  template: { filename: "historical-jobs-template.csv", csv: TEMPLATE_CSV },
  uploadBanner:
    "Historical jobs are created with status = archived. They won't appear in dispatch, won't create visits, and won't affect live KPIs. Companies must already exist in your account — import clients first.",
  commitBanner:
    "This will write archived job records directly. Archived jobs are still visible in reporting and search, but they're separate from your live operations workflow.",
  presets: [jobberJobsPreset],
  // 2026-04-22 Phase 2b: Jobs import writes custom fields onto the Job
  // entity. Location targeting is intentionally omitted from this config —
  // the canonical Phase 2b brief allowed deferring Job→Location targeting
  // to preserve the existing working Jobs custom-field flow unchanged.
  customFieldEntities: [{ id: "job", label: "Job" }],
};
