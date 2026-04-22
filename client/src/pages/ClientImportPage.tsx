/**
 * ClientImportPage — thin wrapper around the canonical ImportWizard.
 *
 * 2026-04-21: All import logic lives in `@/components/imports/ImportWizard`.
 * The customer-company / location / contact three-entity transaction is
 * encapsulated in the backend ClientImportAdapter.
 */

import { ImportWizard } from "@/components/imports/ImportWizard";
import { clientImportConfig } from "@/components/imports/configs/clientImportConfig";

export default function ClientImportPage() {
  return <ImportWizard config={clientImportConfig} />;
}
