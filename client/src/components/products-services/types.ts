export interface Part {
  id: string;
  type: string;
  name?: string | null;
  sku?: string | null;
  description?: string | null;
  cost?: string | null;
  markupPercent?: string | null;
  unitPrice?: string | null;
  isTaxable?: boolean | null;
  taxCode?: string | null;
  category?: string | null;
  isActive?: boolean | null;
  estimatedDurationMinutes?: number | null;
  trackInventory?: boolean | null;
  qboItemId?: string | null;
  qboSyncToken?: string | null;
  qboSyncStatus?: string | null;
  qboSyncError?: string | null;
  qboLastSyncedAt?: string | null;
  updatedAt?: string | null;
  // Optional item image (added 2026-05-18)
  imageFileId?: string | null;
  imageStorageKey?: string | null;
  imageMimeType?: string | null;
  imageFileName?: string | null;
  imageAltText?: string | null;
  thumbnailStorageKey?: string | null;
}

export interface ProductFormData {
  type: "service" | "product";
  name: string;
  sku: string;
  description: string;
  cost: string;
  markupPercent: string;
  unitPrice: string;
  isTaxable: boolean;
  taxCode: string;
  category: string;
  isActive: boolean;
  estimatedDurationMinutes: string; // Stored as string in form, parsed to int on save
}

export interface PartsResponse {
  data?: Part[];
  items?: Part[];
  meta?: {
    limit: number;
    hasMore: boolean;
    nextOffset?: number;
  };
}

export type SortField = "name" | "type" | "category" | "cost" | "unitPrice" | "estimatedDurationMinutes";
export type SortDirection = "asc" | "desc";
export type StatusFilter = "all" | "active" | "archived";
export type TypeFilter = "all" | "product" | "service";

export const defaultFormData: ProductFormData = {
  type: "product",
  name: "",
  sku: "",
  description: "",
  cost: "",
  markupPercent: "",
  unitPrice: "",
  isTaxable: true,
  taxCode: "",
  category: "",
  isActive: true,
  estimatedDurationMinutes: "",
};

export function formatCurrency(value: string | null | undefined): string {
  if (!value) return "-";
  const num = parseFloat(value);
  if (isNaN(num)) return "-";
  return `$${num.toFixed(2)}`;
}

export { formatDuration } from "@/lib/formatters";
