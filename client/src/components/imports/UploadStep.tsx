/**
 * UploadStep — canonical Upload-step surface.
 *
 * 2026-04-22: introduced source-selector gate (user picks Jobber / HCP /
 *   Generic before seeing the dropzone).
 * 2026-05-13: removed the gate. Source detection now runs automatically
 *   when the file is uploaded (see `presets/detectPreset.ts`). The dropzone
 *   is shown immediately. A detection notice appears on the Map step.
 */

import { useRef, useState } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateDownloadLink } from "./TemplateDownloadLink";
import type { ImportWizardConfig } from "./types";

interface UploadStepProps {
  config: ImportWizardConfig;
  onFile: (csvText: string) => void;
}

export function UploadStep({ config, onFile }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setError("Please select a .csv file");
      return;
    }
    setError(null);
    const text = await file.text();
    onFile(text);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <TemplateDownloadLink template={config.template} />
      </div>

      <div>
        <h2 className="text-modal-title text-[#111827]">Upload CSV</h2>
        <p className="text-sm text-[#4b5563] mt-1">{config.description}</p>
        {config.uploadBanner && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-3">
            {config.uploadBanner}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        className={`w-full flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-10 transition-colors ${
          dragging ? "border-[#76B054] bg-[#F0F5F0]" : "border-[#e2e8f0] hover:border-[#76B054]/60 hover:bg-slate-50"
        }`}
        data-testid="import-upload-dropzone"
      >
        <div className="p-3 rounded-full bg-[#F0F5F0]">
          <FileSpreadsheet className="h-6 w-6 text-[#76B054]" />
        </div>
        <p className="text-sm font-medium text-[#111827]">
          Drop your CSV here, or <span className="text-[#76B054] underline">click to browse</span>
        </p>
        <p className="text-xs text-[#4b5563]">
          One row per {config.rowNoun.slice(0, -1)}. Duplicates are detected automatically.
        </p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} className="gap-1.5">
          <Upload className="h-4 w-4" />
          Choose file
        </Button>
      </div>
    </div>
  );
}
