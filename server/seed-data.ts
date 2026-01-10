import { InsertItem } from "@shared/schema";

// Generate belt sizes 18-70 for both A and B types as products
const generateBelts = (): InsertItem[] => {
  const belts: InsertItem[] = [];
  
  for (let size = 18; size <= 70; size++) {
    belts.push({ type: "product", name: `Belt A${size}` });
    belts.push({ type: "product", name: `Belt B${size}` });
  }
  
  return belts;
};

// Generate filter sizes with x1 and x2 thickness variants as products
// M = Media, P = Pleated, T = Throwaway
const generateFilters = (): InsertItem[] => {
  const filters: InsertItem[] = [];
  
  // Base filter sizes (without thickness)
  const baseSizes = [
    "10x10", "10x20", "12x12", "12x24", "14x20", "14x24", "14x25", "15x20",
    "16x16", "16x20", "16x24", "16x25", "16x30", "18x18", "18x24", "18x25",
    "20x20", "20x24", "20x25", "20x30", "24x24", "24x30", "25x25"
  ];
  
  // Filter types with their abbreviations
  const filterTypes = [
    { abbrev: "M", name: "Media" },
    { abbrev: "P", name: "Pleated" },
    { abbrev: "T", name: "Throwaway" }
  ];
  
  // Thickness variants
  const thicknesses = ["1", "2"];
  
  for (const filterType of filterTypes) {
    for (const baseSize of baseSizes) {
      for (const thickness of thicknesses) {
        filters.push({
          type: "product",
          name: `${filterType.abbrev} Filter ${baseSize}x${thickness}`
        });
      }
    }
  }
  
  return filters;
};

export const STANDARD_BELTS: InsertItem[] = generateBelts();
export const STANDARD_FILTERS: InsertItem[] = generateFilters();
