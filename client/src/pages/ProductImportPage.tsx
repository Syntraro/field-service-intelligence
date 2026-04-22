/**
 * ProductImportPage — thin wrapper around the canonical ImportWizard.
 *
 * 2026-04-21: All import logic — upload, mapping, preview, commit,
 * results — lives in `@/components/imports/ImportWizard`. This page
 * does nothing more than feed the Product config into the wizard.
 */

import { ImportWizard } from "@/components/imports/ImportWizard";
import { productImportConfig } from "@/components/imports/configs/productImportConfig";

export default function ProductImportPage() {
  return <ImportWizard config={productImportConfig} />;
}
