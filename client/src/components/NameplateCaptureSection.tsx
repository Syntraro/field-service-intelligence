/**
 * NameplateCaptureSection — upload/capture a nameplate photo with OCR extraction.
 * (2026-03-06)
 *
 * Behavior:
 * - User takes/uploads a nameplate photo
 * - Photo is always saved to the equipment record
 * - OCR is attempted to prefill manufacturer/model/serial
 * - OCR failure never blocks the workflow
 * - User can review/edit extracted values, remove/replace photo
 */

import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface OcrResult {
  success: boolean;
  manufacturer?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
  rawText?: string | null;
  error?: string;
}

interface NameplateUploadResult {
  file: {
    fileId: string;
    originalName: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  };
  ocr: OcrResult;
}

interface NameplateCaptureProps {
  locationId: string;
  equipmentId: string | null; // null = creating new equipment (deferred upload)
  /** Current photo URL if already set */
  existingPhotoUrl?: string | null;
  /** Called when OCR extracts fields — parent can prefill form */
  onOcrResult?: (result: OcrResult) => void;
  /** Called when photo is uploaded successfully */
  onPhotoUploaded?: (fileId: string, downloadUrl: string) => void;
  /** Called when photo is removed */
  onPhotoRemoved?: () => void;
  /** Called with the pending file when equipmentId is null (deferred upload) */
  onPendingFile?: (file: File | null) => void;
}

type OcrStatus = "idle" | "uploading" | "success" | "partial" | "failed";

export default function NameplateCaptureSection({
  locationId,
  equipmentId,
  existingPhotoUrl,
  onOcrResult,
  onPhotoUploaded,
  onPhotoRemoved,
  onPendingFile,
}: NameplateCaptureProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingPhotoUrl || null);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>(existingPhotoUrl ? "idle" : "idle");
  const [ocrMessage, setOcrMessage] = useState<string>("");
  // Hold file for deferred upload (new equipment, no equipmentId yet)
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, eqId }: { file: File; eqId: string }) => {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch(`/api/clients/${locationId}/equipment/${eqId}/nameplate`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || "Upload failed");
      }
      return res.json() as Promise<NameplateUploadResult>;
    },
    onSuccess: (data) => {
      const { file: fileInfo, ocr } = data;
      onPhotoUploaded?.(fileInfo.fileId, fileInfo.downloadUrl);
      setPreviewUrl(fileInfo.downloadUrl);
      setPendingFile(null);

      if (ocr.success) {
        setOcrStatus("success");
        setOcrMessage("We found some equipment details. Please review.");
        onOcrResult?.(ocr);
      } else if (ocr.manufacturer || ocr.modelNumber || ocr.serialNumber) {
        setOcrStatus("partial");
        setOcrMessage("We found some details. Please review and complete.");
        onOcrResult?.(ocr);
      } else {
        setOcrStatus("failed");
        setOcrMessage("Couldn't read the nameplate clearly, but the photo was saved.");
      }

      queryClient.invalidateQueries({
        queryKey: ["/api/clients", locationId, "equipment"],
      });
    },
    onError: (err: Error) => {
      setOcrStatus("failed");
      setOcrMessage("Upload failed. Please try again.");
      toast({
        title: "Upload Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!equipmentId) return;
      const res = await fetch(
        `/api/clients/${locationId}/equipment/${equipmentId}/nameplate`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to remove photo");
    },
    onSuccess: () => {
      setPreviewUrl(null);
      setOcrStatus("idle");
      setOcrMessage("");
      setPendingFile(null);
      onPhotoRemoved?.();
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", locationId, "equipment"],
      });
    },
  });

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }

    // Show preview immediately
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    if (equipmentId) {
      // Equipment exists — upload immediately
      setOcrStatus("uploading");
      setOcrMessage("Reading nameplate…");
      uploadMutation.mutate({ file, eqId: equipmentId });
    } else {
      // New equipment — defer upload, notify parent
      setPendingFile(file);
      onPendingFile?.(file);
      setOcrStatus("idle");
      setOcrMessage("Photo will be uploaded when you save the equipment.");
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const handleRemove = () => {
    if (pendingFile) {
      // Just clear the pending file
      setPreviewUrl(null);
      setPendingFile(null);
      onPendingFile?.(null);
      setOcrStatus("idle");
      setOcrMessage("");
      onPhotoRemoved?.();
    } else if (equipmentId && previewUrl) {
      removeMutation.mutate();
    }
  };

  const isUploading = uploadMutation.isPending;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Nameplate Photo</label>

      {previewUrl ? (
        <div className="relative inline-block">
          <img
            src={previewUrl}
            alt="Nameplate"
            className="h-32 w-auto rounded border object-cover"
          />
          <Button
            variant="destructive"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
            onClick={handleRemove}
            disabled={isUploading || removeMutation.isPending}
            data-testid="button-remove-nameplate"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.setAttribute("capture", "environment");
                fileInputRef.current.click();
              }
            }}
            disabled={isUploading}
            data-testid="button-capture-nameplate"
          >
            <Camera className="h-4 w-4" />
            Take Photo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.removeAttribute("capture");
                fileInputRef.current.click();
              }
            }}
            disabled={isUploading}
            data-testid="button-upload-nameplate"
          >
            <Upload className="h-4 w-4" />
            Upload
          </Button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleInputChange}
        data-testid="input-nameplate-file"
      />

      {/* OCR status feedback */}
      {ocrStatus === "uploading" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {ocrMessage}
        </div>
      )}
      {ocrStatus === "success" && (
        <div className="flex items-center gap-2 text-xs text-green-600">
          <CheckCircle2 className="h-3 w-3" />
          {ocrMessage}
        </div>
      )}
      {ocrStatus === "partial" && (
        <div className="flex items-center gap-2 text-xs text-amber-600">
          <CheckCircle2 className="h-3 w-3" />
          {ocrMessage}
        </div>
      )}
      {ocrStatus === "failed" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-3 w-3" />
          {ocrMessage}
        </div>
      )}
    </div>
  );
}

