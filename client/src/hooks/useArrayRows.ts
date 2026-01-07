import { useState, useCallback } from "react";

/**
 * Hook for managing array state with add, update, and remove operations.
 * Eliminates repetitive array manipulation code across forms.
 */
export function useArrayRows<T extends Record<string, unknown>>(
  initialRows: T[] = [],
  defaultRow: T
) {
  const [rows, setRows] = useState<T[]>(initialRows);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, { ...defaultRow }]);
  }, [defaultRow]);

  const updateRow = useCallback(<K extends keyof T>(
    index: number,
    field: K,
    value: T[K]
  ) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  const updateRowMultiple = useCallback((
    index: number,
    updates: Partial<T>
  ) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }, []);

  const removeRow = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const resetRows = useCallback((newRows: T[] = []) => {
    setRows(newRows.length > 0 ? newRows : [{ ...defaultRow }]);
  }, [defaultRow]);

  const clearRows = useCallback(() => {
    setRows([]);
  }, []);

  return {
    rows,
    setRows,
    addRow,
    updateRow,
    updateRowMultiple,
    removeRow,
    resetRows,
    clearRows,
  };
}

// Type helper for part rows (common pattern)
export interface PartRow {
  partId: string;
  quantity: number;
  category?: string;
}

export const DEFAULT_PART_ROW: PartRow = {
  partId: "",
  quantity: 1,
};

// Type helper for equipment rows
export interface EquipmentRow {
  id?: string;
  label: string;
  type: string;
  make?: string;
  model?: string;
  serialNumber?: string;
}

export const DEFAULT_EQUIPMENT_ROW: EquipmentRow = {
  label: "",
  type: "",
  make: "",
  model: "",
  serialNumber: "",
};
