/**
 * parseNameplateFields — direct unit tests (2026-05-13 hardening)
 *
 * Tests the shared field-extraction module independently of any OCR provider.
 * These are pure unit tests — no mocks, no DB, no I/O.
 *
 * Covers:
 *   FIELD_PATTERNS registry
 *   1. Has exactly 6 entries (one per OcrFieldMap field)
 *   2. Covers all expected field keys
 *
 *   Primary label patterns
 *   3. manufacturer — "Manufacturer:" label
 *   4. manufacturer — "Mfr:" abbreviated label
 *   5. modelNumber  — "Model No:" label
 *   6. modelNumber  — "Mdl:" abbreviated label
 *   7. serialNumber — "Serial No:" label
 *   8. serialNumber — "S/N:" abbreviation
 *   9. serialNumber — "Ser:" abbreviation
 *  10. equipmentType — "Type:" label
 *  11. equipmentType — "Unit Type:" label
 *  12. tagNumber — "Tag No:" label
 *  13. tagNumber — "Asset Tag:" label
 *  14. installDate — "Install Date:" label
 *  15. installDate — "Installed On:" variant
 *
 *   Multi-field and edge cases
 *  16. All fields extracted from a realistic nameplate
 *  17. Returns empty object on text with no recognized labels
 *  18. Returns empty object on empty string input
 *
 *   Confidence arithmetic
 *  19. Per-field confidence = overallConfidence + 0.05
 *  20. Per-field confidence is capped at 1.0
 *  21. All detected-field confidences stay within [0, 1]
 */

import { describe, it, expect } from "vitest";
import {
  FIELD_PATTERNS,
  parseNameplateFields,
} from "../server/services/ocr/parseNameplateFields";

// ── 1–2. Registry ─────────────────────────────────────────────────────────────

describe("FIELD_PATTERNS — registry", () => {
  it("1. has exactly 6 entries (one per OcrFieldMap field)", () => {
    expect(FIELD_PATTERNS).toHaveLength(6);
  });

  it("2. covers all canonical OcrFieldMap field keys", () => {
    const fields = FIELD_PATTERNS.map((p) => p.field);
    expect(fields).toContain("manufacturer");
    expect(fields).toContain("modelNumber");
    expect(fields).toContain("serialNumber");
    expect(fields).toContain("equipmentType");
    expect(fields).toContain("tagNumber");
    expect(fields).toContain("installDate");
  });
});

// ── 3–15. Primary label patterns ──────────────────────────────────────────────

describe("parseNameplateFields — manufacturer patterns", () => {
  it('3. parses manufacturer from "Manufacturer:" label', () => {
    const fields = parseNameplateFields("Manufacturer: Carrier", 0.9);
    expect(fields.manufacturer?.value).toBe("Carrier");
  });

  it('4. parses manufacturer from "Mfr:" abbreviated label (case-insensitive)', () => {
    const fields = parseNameplateFields("Mfr: Trane", 0.85);
    expect(fields.manufacturer?.value).toBe("Trane");
  });

  it('parses manufacturer from "Make:" label', () => {
    const fields = parseNameplateFields("Make: York", 0.8);
    expect(fields.manufacturer?.value).toBe("York");
  });
});

describe("parseNameplateFields — modelNumber patterns", () => {
  it('5. parses modelNumber from "Model No:" label', () => {
    const fields = parseNameplateFields("Model No: 50XC060", 0.9);
    expect(fields.modelNumber?.value).toBe("50XC060");
  });

  it('6. parses modelNumber from "Mdl:" abbreviated label', () => {
    const fields = parseNameplateFields("Mdl: XC21-060", 0.88);
    expect(fields.modelNumber?.value).toBe("XC21-060");
  });

  it('parses modelNumber from "Model Number:" label', () => {
    const fields = parseNameplateFields("Model Number: 2TWB3024A1000AA", 0.9);
    expect(fields.modelNumber?.value).toBe("2TWB3024A1000AA");
  });
});

describe("parseNameplateFields — serialNumber patterns", () => {
  it('7. parses serialNumber from "Serial No:" label', () => {
    const fields = parseNameplateFields("Serial No: 1234ABCD5678", 0.9);
    expect(fields.serialNumber?.value).toBe("1234ABCD5678");
  });

  it('8. parses serialNumber from "S/N:" abbreviation', () => {
    const fields = parseNameplateFields("S/N: ABCD1234XY", 0.88);
    expect(fields.serialNumber?.value).toBe("ABCD1234XY");
  });

  it('9. parses serialNumber from "Ser:" abbreviation', () => {
    const fields = parseNameplateFields("Ser: 9876WXYZ1234", 0.82);
    expect(fields.serialNumber?.value).toBe("9876WXYZ1234");
  });
});

describe("parseNameplateFields — equipmentType patterns", () => {
  it('10. parses equipmentType from "Type:" label', () => {
    const fields = parseNameplateFields("Type: RTU", 0.85);
    expect(fields.equipmentType?.value).toBe("RTU");
  });

  it('11. parses equipmentType from "Unit Type:" label', () => {
    const fields = parseNameplateFields("Unit Type: Split System", 0.83);
    expect(fields.equipmentType?.value).toBe("Split System");
  });
});

describe("parseNameplateFields — tagNumber patterns", () => {
  it('12. parses tagNumber from "Tag No:" label', () => {
    const fields = parseNameplateFields("Tag No: TAG-001", 0.9);
    expect(fields.tagNumber?.value).toBe("TAG-001");
  });

  it('13. parses tagNumber from "Asset Tag:" label', () => {
    const fields = parseNameplateFields("Asset Tag: HVAC2024", 0.88);
    expect(fields.tagNumber?.value).toBe("HVAC2024");
  });
});

describe("parseNameplateFields — installDate patterns", () => {
  it('14. parses installDate from "Install Date:" label', () => {
    const fields = parseNameplateFields("Install Date: 03/15/2022", 0.87);
    expect(fields.installDate?.value).toBe("03/15/2022");
  });

  it('15. parses installDate from "Installed On:" variant', () => {
    const fields = parseNameplateFields("Installed On: 06-01-2023", 0.84);
    expect(fields.installDate?.value).toBe("06-01-2023");
  });
});

// ── 16–18. Multi-field and edge cases ────────────────────────────────────────

describe("parseNameplateFields — multi-field extraction", () => {
  it("16. extracts all six fields from a realistic Carrier nameplate", () => {
    const text = [
      "Carrier Corporation",
      "Manufacturer: Carrier",
      "Model No.: 50XCA060-311",
      "Serial No.: 2318G30002",
      "Type: RTU",
      "Tag No: ROOF-05",
      "Install Date: 06/01/2023",
    ].join("\n");

    const fields = parseNameplateFields(text, 0.88);
    expect(fields.manufacturer?.value).toBeTruthy();
    expect(fields.modelNumber?.value).toBeTruthy();
    expect(fields.serialNumber?.value).toBeTruthy();
    expect(fields.equipmentType?.value).toBeTruthy();
    expect(fields.tagNumber?.value).toBeTruthy();
    expect(fields.installDate?.value).toBe("06/01/2023");
  });

  it("17. returns empty object when text contains no recognized labels", () => {
    const fields = parseNameplateFields("QWERTY ASDF 12345 XYZ some random text", 0.9);
    expect(Object.keys(fields)).toHaveLength(0);
  });

  it("18. returns empty object on empty-string input", () => {
    const fields = parseNameplateFields("", 0);
    expect(Object.keys(fields)).toHaveLength(0);
  });

  it("result field values are trimmed (no leading/trailing whitespace)", () => {
    const fields = parseNameplateFields("Manufacturer:   Lennox  ", 0.85);
    if (fields.manufacturer) {
      expect(fields.manufacturer.value).toBe(fields.manufacturer.value.trim());
    }
  });
});

// ── 19–21. Confidence arithmetic ──────────────────────────────────────────────

describe("parseNameplateFields — confidence arithmetic", () => {
  it("19. per-field confidence = overallConfidence + 0.05 when below cap", () => {
    const overall = 0.80;
    const fields = parseNameplateFields("Manufacturer: York", overall);
    expect(fields.manufacturer?.confidence).toBeCloseTo(overall + 0.05, 5);
  });

  it("20. per-field confidence is capped at 1.0 even when overall is near 1.0", () => {
    const fields = parseNameplateFields("Manufacturer: York", 0.98);
    expect(fields.manufacturer?.confidence).toBeLessThanOrEqual(1.0);
  });

  it("20b. per-field confidence is exactly 1.0 when overall + 0.05 would exceed 1.0", () => {
    const fields = parseNameplateFields("Manufacturer: York", 1.0);
    expect(fields.manufacturer?.confidence).toBe(1.0);
  });

  it("21. all detected-field confidences remain within [0, 1]", () => {
    const text = [
      "Manufacturer: Lennox",
      "Model No: XC21-060",
      "Serial No: 2301C12345",
      "Type: Split",
      "Tag No: RTU-01",
      "Install Date: 01/01/2020",
    ].join("\n");

    const fields = parseNameplateFields(text, 0.75);
    for (const [, f] of Object.entries(fields)) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });
});
