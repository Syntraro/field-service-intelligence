/**
 * PartsManagementPage - Pricebook settings page
 * (UI label "Pricebook" — internal route /settings/products and DB
 * table `items` retain their canonical names per CLAUDE.md.)
 * Uses standardized styling matching Jobs/Invoices pages.
 * Phase: Consolidated header - toolbar handles title/actions, page provides workspace bg
 */
import ProductsServicesManager from "@/components/ProductsServicesManager";

export default function PartsManagementPage() {
  return (
    <div className="min-h-screen bg-app-bg dark:bg-gray-900">
      <main className="p-6 space-y-4">
        <ProductsServicesManager />
      </main>
    </div>
  );
}
