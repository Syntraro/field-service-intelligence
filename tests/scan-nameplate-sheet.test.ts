/**
 * ScanNameplateSheet — source-pin tests (2026-05-13 Phase 1B)
 *
 * The vitest environment is "node" (no jsdom), so rendering is not available.
 * These tests read source files and assert that the structural contracts the
 * requirement specifies are present in the implementation.
 *
 * Covers:
 *   1. Capture step — camera input has capture="environment" + accept="image/*"
 *   2. Capture step — library input has accept="image/*" but no capture attribute
 *   3. Scan button is disabled until file selected
 *   4. OCR endpoint is called with fileId after upload
 *   5. Review step renders confidence badges
 *   6. Review step shows existing equipment values
 *   7. Save calls PATCH with accepted fields + nameplatePhotoId + ocrScanId
 *   8. Discard (review step) does not call PATCH
 *   9. Entry point: LeadVisitDetailPage has per-item Scan nameplate button
 *  10. EquipmentSnapshot interface / DTO includes nameplatePhotoId and tagNumber
 *  11. equipment_nameplate added to FileEntityType in useFileUpload
 *  12. OCR route returns scanId to client
 *  13. PATCH route uses scanId to mark scan reviewed + applied
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

const sheet = read("client/src/tech-app/components/ScanNameplateSheet.tsx");
const leadPage = read("client/src/tech-app/pages/LeadVisitDetailPage.tsx");
const uploadHook = read("client/src/hooks/useFileUpload.ts");
const ocrRoute = read("server/routes/equipmentOcr.ts");

// ── 1. Camera input: capture="environment" ───────────────────────────────────

describe("ScanNameplateSheet — capture step inputs", () => {
  it('camera input uses capture="environment"', () => {
    expect(sheet).toContain('capture="environment"');
  });

  it('camera input accepts image/* mime type', () => {
    // Both inputs have accept="image/*"; just verify it's present.
    expect(sheet).toMatch(/accept="image\/\*"/);
  });

  it('camera input has data-testid="input-camera"', () => {
    expect(sheet).toContain('data-testid="input-camera"');
  });

  it('library input has data-testid="input-library" and no capture attribute', () => {
    // Library input must not have capture attribute on the same element.
    expect(sheet).toContain('data-testid="input-library"');
    // The library input block should not contain capture= on its own element.
    // We verify this by checking that accept="image/*" appears twice (one per input)
    // while capture= appears exactly once (camera only).
    const captureCount = (sheet.match(/capture="environment"/g) ?? []).length;
    expect(captureCount).toBe(1);
  });

  it("image preview renders after file selected", () => {
    expect(sheet).toContain('data-testid="image-preview"');
  });
});

// ── 3. Scan button disabled until file selected ───────────────────────────────

describe("ScanNameplateSheet — Scan button gate", () => {
  it('Scan button is disabled when no file is selected', () => {
    // The button's disabled prop references selectedFile.
    expect(sheet).toMatch(/disabled=\{!selectedFile/);
  });

  it('Scan button has data-testid="button-scan"', () => {
    expect(sheet).toContain('data-testid="button-scan"');
  });
});

// ── 4. OCR endpoint called after upload ──────────────────────────────────────

describe("ScanNameplateSheet — OCR API call", () => {
  it("calls /api/tech/equipment/:id/ocr-nameplate after upload", () => {
    expect(sheet).toContain("/ocr-nameplate");
    expect(sheet).toContain("equipment.id");
  });

  it("sends fileId in the POST body", () => {
    expect(sheet).toContain("fileId");
    expect(sheet).toMatch(/JSON\.stringify\(\{.*fileId/s);
  });

  it("uses equipment_nameplate entity type for upload", () => {
    expect(sheet).toContain('"equipment_nameplate"');
  });
});

// ── 5. Confidence indicators in review step ───────────────────────────────────

describe("ScanNameplateSheet — confidence indicators", () => {
  it('confidence badge has data-testid="confidence-badge"', () => {
    expect(sheet).toContain('data-testid="confidence-badge"');
  });

  it("confidence is rendered as a percentage", () => {
    // Math.round(confidence * 100) pattern must appear.
    expect(sheet).toContain("confidence * 100");
  });

  it("review step section has data-testid", () => {
    expect(sheet).toContain('data-testid="review-step"');
  });
});

// ── 6. Existing equipment values shown in review ──────────────────────────────

describe("ScanNameplateSheet — existing values display", () => {
  it("shows existing value label beneath each field input", () => {
    expect(sheet).toContain("data-testid={`existing-value-");
  });

  it("existing value only shown when different from OCR value", () => {
    // The guard: existingValue && existingValue !== value
    expect(sheet).toContain("existingValue !== value");
  });

  it("existing manufacturer, modelNumber, serialNumber are passed from props", () => {
    expect(sheet).toContain("equipment.manufacturer");
    expect(sheet).toContain("equipment.modelNumber");
    expect(sheet).toContain("equipment.serialNumber");
  });
});

// ── 7. Save sends PATCH with correct fields ───────────────────────────────────

describe("ScanNameplateSheet — Save action", () => {
  it('Save button has data-testid="button-save"', () => {
    expect(sheet).toContain('data-testid="button-save"');
  });

  it("PATCH /api/tech/equipment/:id is called on save", () => {
    expect(sheet).toMatch(/PATCH/);
    expect(sheet).toContain(`/api/tech/equipment/\${equipment.id}`);
  });

  it("payload includes nameplatePhotoId", () => {
    expect(sheet).toContain("nameplatePhotoId");
  });

  it("payload includes ocrScanId from the scan result", () => {
    expect(sheet).toContain("ocrScanId");
    expect(sheet).toContain("scanResult?.scanId");
  });

  it("payload includes reviewed field values (manufacturer, modelNumber, serialNumber)", () => {
    expect(sheet).toContain("payload.manufacturer");
    expect(sheet).toContain("payload.modelNumber");
    expect(sheet).toContain("payload.serialNumber");
  });

  it("calls onSaved callback after successful PATCH", () => {
    expect(sheet).toContain("onSaved()");
  });
});

// ── 8. Discard does not call PATCH ───────────────────────────────────────────

describe("ScanNameplateSheet — Discard action", () => {
  it('Discard button on capture step has data-testid="button-discard-capture"', () => {
    expect(sheet).toContain('data-testid="button-discard-capture"');
  });

  it('Discard button on review step has data-testid="button-discard-review"', () => {
    expect(sheet).toContain('data-testid="button-discard-review"');
  });

  it("Discard calls handleClose (closes sheet), not handleSave (no PATCH)", () => {
    // The discard buttons call handleClose or onOpenChange, not handleSave.
    expect(sheet).toContain("handleClose");
    // Verify handleSave is wired only to the Save button, not discard buttons.
    const discardReviewBlock = sheet.match(
      /data-testid="button-discard-review"[\s\S]{0,200}/,
    )?.[0] ?? "";
    expect(discardReviewBlock).not.toContain("handleSave");
  });
});

// ── 9. Entry point: LeadVisitDetailPage ──────────────────────────────────────

describe("LeadVisitDetailPage — Scan nameplate entry point", () => {
  it('has per-item Scan nameplate button with aria-label', () => {
    expect(leadPage).toContain('aria-label="Scan nameplate"');
  });

  it('button has data-testid="button-scan-nameplate"', () => {
    expect(leadPage).toContain('data-testid="button-scan-nameplate"');
  });

  it("imports and renders ScanNameplateSheet", () => {
    expect(leadPage).toContain("ScanNameplateSheet");
    expect(leadPage).toContain("<ScanNameplateSheet");
  });

  it("invalidates location equipment query after save", () => {
    expect(leadPage).toContain('"/api/tech/locations"');
    expect(leadPage).toContain('"equipment"');
  });

  it("passes equipment snapshot including nameplatePhotoId to ScanNameplateSheet", () => {
    expect(leadPage).toContain("nameplatePhotoId");
  });
});

// ── 10. DTO interface ─────────────────────────────────────────────────────────

describe("LocationEquipmentItem DTO — Phase 1B fields", () => {
  it("includes nameplatePhotoId in the interface", () => {
    expect(leadPage).toContain("nameplatePhotoId");
  });

  it("includes tagNumber in the interface", () => {
    expect(leadPage).toContain("tagNumber");
  });

  it("EquipmentSnapshot interface exported from ScanNameplateSheet includes tagNumber", () => {
    expect(sheet).toContain("tagNumber");
    expect(sheet).toContain("EquipmentSnapshot");
  });
});

// ── 11. FileEntityType includes equipment_nameplate ───────────────────────────

describe("useFileUpload — equipment_nameplate entity type", () => {
  it('FileEntityType union includes "equipment_nameplate"', () => {
    expect(uploadHook).toContain('"equipment_nameplate"');
  });
});

// ── 12. OCR route returns scanId ─────────────────────────────────────────────

describe("OCR route — scanId in response", () => {
  it("POST /ocr-nameplate returns scanId alongside OcrNameplateResult", () => {
    expect(ocrRoute).toContain("scanId: scan.id");
    expect(ocrRoute).toMatch(/\{?\s*\.\.\.ocrResult,\s*scanId:/);
  });
});

// ── 13. PATCH route marks scan reviewed + applied ─────────────────────────────

describe("PATCH /api/tech/equipment/:id — OCR scan lifecycle", () => {
  it("PATCH route calls markReviewed and markApplied", () => {
    expect(ocrRoute).toContain("markReviewed");
    expect(ocrRoute).toContain("markApplied");
  });

  it("markReviewed called before markApplied", () => {
    const reviewIdx = ocrRoute.indexOf("markReviewed");
    const applyIdx  = ocrRoute.indexOf("markApplied");
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeLessThan(applyIdx);
  });

  it("scan is only reviewed if reviewedAt is null", () => {
    expect(ocrRoute).toContain("!scan.reviewedAt");
  });
});

// ── Phase 1C hardening — compression, URL cleanup, dvh fallback ──────────────

const compressUtil = read("client/src/tech-app/utils/compressImage.ts");

describe("compressImage utility — structure", () => {
  it("exports compressImage function", () => {
    expect(compressUtil).toContain("export async function compressImage");
  });

  it("applies max dimension constraint (1024)", () => {
    expect(compressUtil).toContain("1024");
  });

  it("prefers WebP output type", () => {
    expect(compressUtil).toContain("image/webp");
  });

  it("falls back to JPEG when WebP not available", () => {
    expect(compressUtil).toContain("image/jpeg");
  });

  it("uses quality 0.85", () => {
    expect(compressUtil).toContain("0.85");
  });

  it("uses createImageBitmap + OffscreenCanvas as primary path", () => {
    expect(compressUtil).toContain("createImageBitmap");
    expect(compressUtil).toContain("OffscreenCanvas");
  });

  it("has canvas fallback path for Safari", () => {
    expect(compressUtil).toContain("createElement(\"canvas\")");
  });

  it("returns original file on error (safe fallback)", () => {
    expect(compressUtil).toContain("return file");
  });
});

describe("ScanNameplateSheet — client-side compression", () => {
  it("imports compressImage utility", () => {
    expect(sheet).toContain("compressImage");
    expect(sheet).toMatch(/from ["']\.\.\/utils\/compressImage["']/);
  });

  it("applyFile is async (compression is awaited)", () => {
    expect(sheet).toMatch(/async function applyFile/);
  });

  it("compressImage is called inside applyFile", () => {
    expect(sheet).toContain("await compressImage(file)");
  });
});

describe("ScanNameplateSheet — blob URL cleanup", () => {
  it("tracks current preview URL in a ref (previewUrlRef)", () => {
    expect(sheet).toContain("previewUrlRef");
    expect(sheet).toMatch(/previewUrlRef\s*=\s*useRef/);
  });

  it("calls URL.revokeObjectURL on file change (applyFile)", () => {
    expect(sheet).toContain("URL.revokeObjectURL");
  });

  it("revokes on reset (resetToCapture)", () => {
    // revokeObjectURL must appear in resetToCapture context.
    const resetBlock = sheet.match(/function resetToCapture\(\)[\s\S]{0,300}/)?.[0] ?? "";
    expect(resetBlock).toContain("revokeObjectURL");
  });

  it("revokes on unmount via useEffect cleanup", () => {
    expect(sheet).toContain("useEffect");
    const effectBlock = sheet.match(/useEffect\(\(\)[\s\S]{0,200}/)?.[0] ?? "";
    expect(effectBlock).toContain("revokeObjectURL");
  });

  it("imports useEffect", () => {
    expect(sheet).toMatch(/import \{[^}]*useEffect[^}]*\}/);
  });
});

describe("ScanNameplateSheet — dvh fallback", () => {
  it("sheet panel has max-h-[92vh] Tailwind class as vh fallback", () => {
    expect(sheet).toContain("max-h-[92vh]");
  });

  it("sheet panel also has maxHeight: 92dvh inline style for progressive enhancement", () => {
    expect(sheet).toContain("92dvh");
  });
});
