/**
 * ScanNameplateSheet — tech-app equipment nameplate OCR flow (2026-05-13 Phase 1B).
 *
 * Three-step mobile bottom sheet:
 *   1. Capture  — select image via camera or photo library
 *   2. Scanning — upload → OCR → "Reading nameplate..."
 *   3. Review   — editable fields with confidence indicators; Save or Discard
 *
 * Save calls PATCH /api/tech/equipment/:equipmentId with the reviewed fields,
 * the uploaded file's id (nameplatePhotoId), and the scanId so the server can
 * mark the scan reviewed + applied in one round trip.
 *
 * Never auto-saves. Never overwrites data unless the tech explicitly taps Save.
 */

import { useRef, useState, useEffect } from "react";
import { Loader2, Camera, ImageIcon, X, CheckCircle2, AlertCircle } from "lucide-react";
import { useFileUpload } from "@/hooks/useFileUpload";
import { apiRequest } from "@/lib/queryClient";
import { compressImage } from "../utils/compressImage";

// ── Types ────────────────────────────────────────────────────────────────────

type Step = "capture" | "scanning" | "review";

export interface EquipmentSnapshot {
  id: string;
  name: string | null;
  equipmentType: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  tagNumber: string | null;
  notes: string | null;
  nameplatePhotoId: string | null;
}

interface OcrField {
  value: string;
  confidence: number;
}

interface OcrResponse {
  rawText: string;
  fields: {
    manufacturer?: OcrField;
    modelNumber?: OcrField;
    serialNumber?: OcrField;
    equipmentType?: OcrField;
    tagNumber?: OcrField;
    installDate?: OcrField;
  };
  overallConfidence: number;
  provider: string;
  scannedAt: string;
  scanId: string;
}

interface ReviewFields {
  equipmentType: string;
  manufacturer: string;
  modelNumber: string;
  serialNumber: string;
  tagNumber: string;
  notes: string;
}

interface ScanNameplateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipment: EquipmentSnapshot;
  locationId: string;
  onSaved: () => void;
}

// ── Confidence indicator ─────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.8
      ? "text-emerald-600"
      : confidence >= 0.5
        ? "text-amber-500"
        : "text-slate-400";
  return (
    <span
      className={`text-[10px] font-medium ${color} tabular-nums`}
      data-testid="confidence-badge"
    >
      {pct}%
    </span>
  );
}

// ── Review field row ─────────────────────────────────────────────────────────

function ReviewField({
  label,
  value,
  confidence,
  existingValue,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  confidence: number | null;
  existingValue: string | null;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const hasValue = value.trim().length > 0;
  const showExisting =
    existingValue &&
    existingValue.trim().length > 0 &&
    existingValue !== value;

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium text-slate-500">{label}</label>
        {confidence !== null && hasValue && (
          <ConfidenceBadge confidence={confidence} />
        )}
      </div>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 pr-8 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          data-testid={`review-field-${label.toLowerCase().replace(/\s+/g, "-")}`}
        />
        {hasValue && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {showExisting && (
        <p className="text-[10px] text-slate-400" data-testid={`existing-value-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          Current: {existingValue}
        </p>
      )}
    </div>
  );
}

// ── Main sheet ───────────────────────────────────────────────────────────────

export function ScanNameplateSheet({
  open,
  onOpenChange,
  equipment,
  locationId: _locationId,
  onSaved,
}: ScanNameplateSheetProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [step, setStep] = useState<Step>("capture");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<OcrResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewFields>({
    equipmentType: "",
    manufacturer: "",
    modelNumber: "",
    serialNumber: "",
    tagNumber: "",
    notes: "",
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveInProgress, setSaveInProgress] = useState(false);

  const { upload, isUploading } = useFileUpload();

  // Revoke blob URL on unmount to prevent memory leaks.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function handleClose() {
    onOpenChange(false);
  }

  function resetToCapture() {
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    setStep("capture");
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadedFileId(null);
    setScanResult(null);
    setScanError(null);
    setSaveError(null);
    setReview({ equipmentType: "", manufacturer: "", modelNumber: "", serialNumber: "", tagNumber: "", notes: "" });
  }

  async function applyFile(file: File) {
    const compressed = await compressImage(file);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(compressed);
    previewUrlRef.current = url;
    setSelectedFile(compressed);
    setPreviewUrl(url);
    setScanError(null);
  }

  function handleCameraChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void applyFile(file);
  }

  function handleLibraryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void applyFile(file);
  }

  function populateReviewFromOcr(result: OcrResponse) {
    setReview({
      equipmentType: result.fields.equipmentType?.value ?? equipment.equipmentType ?? "",
      manufacturer:  result.fields.manufacturer?.value  ?? equipment.manufacturer  ?? "",
      modelNumber:   result.fields.modelNumber?.value   ?? equipment.modelNumber   ?? "",
      serialNumber:  result.fields.serialNumber?.value  ?? equipment.serialNumber  ?? "",
      tagNumber:     result.fields.tagNumber?.value     ?? equipment.tagNumber     ?? "",
      notes:         equipment.notes ?? "",
    });
  }

  // ── Scan action ────────────────────────────────────────────────────────────

  async function handleScan() {
    if (!selectedFile) return;
    setScanError(null);
    setStep("scanning");

    try {
      // Step 1–3: canonical R2 upload pipeline
      const uploaded = await upload(selectedFile, {
        entityType: "equipment_nameplate",
        entityId: equipment.id,
      });
      setUploadedFileId(uploaded.id);

      // Call OCR route
      const result = await apiRequest<OcrResponse>(
        `/api/tech/equipment/${equipment.id}/ocr-nameplate`,
        {
          method: "POST",
          body: JSON.stringify({ fileId: uploaded.id }),
        },
      );

      setScanResult(result);
      populateReviewFromOcr(result);
      setStep("review");
    } catch (err: any) {
      setScanError(err?.message ?? "OCR failed. Please retry.");
      setStep("capture");
    }
  }

  // ── Save action ────────────────────────────────────────────────────────────

  async function handleSave() {
    if (saveInProgress) return;
    setSaveError(null);
    setSaveInProgress(true);

    const payload: Record<string, string | null> = {};
    if (review.equipmentType.trim()) payload.equipmentType = review.equipmentType.trim();
    if (review.manufacturer.trim())  payload.manufacturer  = review.manufacturer.trim();
    if (review.modelNumber.trim())   payload.modelNumber   = review.modelNumber.trim();
    if (review.serialNumber.trim())  payload.serialNumber  = review.serialNumber.trim();
    if (review.tagNumber.trim())     payload.tagNumber     = review.tagNumber.trim();
    if (review.notes.trim())         payload.notes         = review.notes.trim();
    if (uploadedFileId)              payload.nameplatePhotoId = uploadedFileId;
    if (scanResult?.scanId)          (payload as any).ocrScanId = scanResult.scanId;

    try {
      await apiRequest(`/api/tech/equipment/${equipment.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onSaved();
      handleClose();
    } catch (err: any) {
      setSaveError(err?.message ?? "Failed to save. Please retry.");
    } finally {
      setSaveInProgress(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!open) return null;

  const isBusy = isUploading || step === "scanning";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      data-testid="scan-nameplate-sheet"
      onClick={() => { if (!isBusy && !saveInProgress) handleClose(); }}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-2xl shadow-xl flex flex-col max-h-[92vh]"
        style={{ maxHeight: "92dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <h2 className="text-sm font-bold text-slate-900">
            {step === "capture" && "Scan Nameplate"}
            {step === "scanning" && "Reading nameplate…"}
            {step === "review" && "Review Nameplate Fields"}
          </h2>
          <button
            onClick={handleClose}
            aria-label="Close"
            disabled={isBusy || saveInProgress}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">

          {/* ── Capture step ── */}
          {step === "capture" && (
            <>
              {/* Hidden file inputs */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-label="Take photo with camera"
                data-testid="input-camera"
                onChange={handleCameraChange}
              />
              <input
                ref={libraryInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label="Choose from photo library"
                data-testid="input-library"
                onChange={handleLibraryChange}
              />

              {/* Preview or picker buttons */}
              {previewUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                  <img
                    src={previewUrl}
                    alt="Selected nameplate"
                    className="w-full object-contain max-h-48"
                    data-testid="image-preview"
                  />
                  <button
                    onClick={() => {
                      if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
                      setSelectedFile(null);
                      setPreviewUrl(null);
                    }}
                    className="absolute top-2 right-2 bg-black/50 rounded-full p-1"
                    aria-label="Remove selected image"
                  >
                    <X className="h-3.5 w-3.5 text-white" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex-1 h-20 rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1.5 text-slate-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
                    data-testid="button-take-photo"
                  >
                    <Camera className="h-5 w-5" />
                    <span className="text-xs font-medium">Take Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => libraryInputRef.current?.click()}
                    className="flex-1 h-20 rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1.5 text-slate-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
                    data-testid="button-choose-library"
                  >
                    <ImageIcon className="h-5 w-5" />
                    <span className="text-xs font-medium">Photo Library</span>
                  </button>
                </div>
              )}

              {/* Equipment context */}
              <p className="text-[11px] text-slate-400 text-center">
                {equipment.name ?? "Equipment"} · Point camera at the nameplate label
              </p>

              {scanError && (
                <div
                  className="flex items-start gap-2 rounded-md bg-red-50 border border-red-100 px-3 py-2.5"
                  data-testid="scan-error"
                >
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{scanError}</p>
                </div>
              )}
            </>
          )}

          {/* ── Scanning step ── */}
          {step === "scanning" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="scanning-state">
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Nameplate being scanned"
                  className="w-full rounded-lg object-contain max-h-36 mb-2 opacity-60"
                />
              )}
              <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
              <p className="text-sm text-slate-600">Reading nameplate…</p>
            </div>
          )}

          {/* ── Review step ── */}
          {step === "review" && scanResult && (
            <div className="space-y-3" data-testid="review-step">
              {Object.keys(scanResult.fields).length === 0 && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-100 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    No fields were detected automatically. You can enter values manually below.
                  </p>
                </div>
              )}

              <ReviewField
                label="Equipment Type"
                value={review.equipmentType}
                confidence={scanResult.fields.equipmentType?.confidence ?? null}
                existingValue={equipment.equipmentType}
                onChange={(v) => setReview((r) => ({ ...r, equipmentType: v }))}
                onClear={() => setReview((r) => ({ ...r, equipmentType: "" }))}
              />
              <ReviewField
                label="Manufacturer"
                value={review.manufacturer}
                confidence={scanResult.fields.manufacturer?.confidence ?? null}
                existingValue={equipment.manufacturer}
                onChange={(v) => setReview((r) => ({ ...r, manufacturer: v }))}
                onClear={() => setReview((r) => ({ ...r, manufacturer: "" }))}
              />
              <ReviewField
                label="Model Number"
                value={review.modelNumber}
                confidence={scanResult.fields.modelNumber?.confidence ?? null}
                existingValue={equipment.modelNumber}
                onChange={(v) => setReview((r) => ({ ...r, modelNumber: v }))}
                onClear={() => setReview((r) => ({ ...r, modelNumber: "" }))}
              />
              <ReviewField
                label="Serial Number"
                value={review.serialNumber}
                confidence={scanResult.fields.serialNumber?.confidence ?? null}
                existingValue={equipment.serialNumber}
                onChange={(v) => setReview((r) => ({ ...r, serialNumber: v }))}
                onClear={() => setReview((r) => ({ ...r, serialNumber: "" }))}
              />
              <ReviewField
                label="Tag Number"
                value={review.tagNumber}
                confidence={scanResult.fields.tagNumber?.confidence ?? null}
                existingValue={equipment.tagNumber}
                onChange={(v) => setReview((r) => ({ ...r, tagNumber: v }))}
                onClear={() => setReview((r) => ({ ...r, tagNumber: "" }))}
              />
              <ReviewField
                label="Notes"
                value={review.notes}
                confidence={null}
                existingValue={equipment.notes}
                onChange={(v) => setReview((r) => ({ ...r, notes: v }))}
                onClear={() => setReview((r) => ({ ...r, notes: "" }))}
              />

              {saveError && (
                <div
                  className="flex items-start gap-2 rounded-md bg-red-50 border border-red-100 px-3 py-2.5"
                  data-testid="save-error"
                >
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{saveError}</p>
                </div>
              )}

              {scanResult.overallConfidence > 0 && (
                <p className="text-[10px] text-slate-400 text-center" data-testid="overall-confidence">
                  Overall confidence: {Math.round(scanResult.overallConfidence * 100)}%
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 border-t border-slate-100 space-y-2 shrink-0"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {step === "capture" && (
            <>
              <button
                type="button"
                onClick={handleScan}
                disabled={!selectedFile || isUploading}
                className="w-full h-10 rounded-md bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                data-testid="button-scan"
              >
                {isUploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Scan
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="w-full h-10 rounded-md border border-slate-200 text-sm font-medium text-slate-600"
                data-testid="button-discard-capture"
              >
                Discard
              </button>
            </>
          )}

          {step === "scanning" && (
            <div className="h-10 flex items-center justify-center">
              <p className="text-xs text-slate-400">Please wait…</p>
            </div>
          )}

          {step === "review" && (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={saveInProgress}
                className="w-full h-10 rounded-md bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                data-testid="button-save"
              >
                {saveInProgress
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
                  : <><CheckCircle2 className="h-3.5 w-3.5" />Save</>
                }
              </button>
              <button
                type="button"
                onClick={resetToCapture}
                disabled={saveInProgress}
                className="w-full h-10 rounded-md border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50"
                data-testid="button-rescan"
              >
                Scan Again
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={saveInProgress}
                className="w-full h-10 text-xs text-slate-400 underline disabled:opacity-50"
                data-testid="button-discard-review"
              >
                Discard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
