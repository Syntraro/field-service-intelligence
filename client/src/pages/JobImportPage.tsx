/**
 * JobImportPage — thin wrapper around the canonical ImportWizard.
 *
 * 2026-04-21: All import logic lives in `@/components/imports/ImportWizard`.
 * Historical-jobs policy (archived status, Jobber header aliases, timezone-
 * aware date parsing) is encapsulated in the backend JobImportAdapter.
 */

import { ImportWizard } from "@/components/imports/ImportWizard";
import { jobImportConfig } from "@/components/imports/configs/jobImportConfig";

export default function JobImportPage() {
  return <ImportWizard config={jobImportConfig} />;
}
