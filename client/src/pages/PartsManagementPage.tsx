/**
 * PartsManagementPage - Products & Services settings page
 * Uses standardized styling matching Jobs/Invoices pages
 * Phase: Consolidated header - toolbar handles title/actions, page provides workspace bg
 */
import ProductsServicesManager from "@/components/ProductsServicesManager";

export default function PartsManagementPage() {
  return (
    <div className="min-h-screen bg-gray-200 dark:bg-gray-900">
      <main className="p-6 space-y-6">
        <ProductsServicesManager />
      </main>
    </div>
  );
}
