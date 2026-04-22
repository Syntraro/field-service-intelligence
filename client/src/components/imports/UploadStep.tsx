/**
 * UploadStep — canonical Upload-step surface.
 *
 * 2026-04-22 — refactored for explicit source selection. The step now
 * has two visible stages on the same page:
 *
 *   1. SourceSelector — user picks Jobber / Housecall Pro / Generic CSV.
 *      The file dropzone is hidden until a source is picked.
 *   2. File dropzone + template download — shown only after source is
 *      picked, with a compact "Source: X [Change]" chip above it.
 *
 * No automatic detection anywhere in this component. The parent
 * ImportWizard owns the selected-source state and passes it down.
 */

import { useRef, useState } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateDownloadLink } from "./TemplateDownloadLink";
import { SourceSelector, SourceChip } from "./SourceSelector";
import type { ImportWizardConfig } from "./types";
import type { SourceId } from "./presets/types";

interface UploadStepProps {
  config: ImportWizardConfig;
  /** User's explicit source choice — null until they pick one. */
  source: SourceId | null;
  onSelectSource: (source: SourceId) => void;
  /** Clears source so the user can pick again. Parent should also reset any state derived from the previous source. */
  onResetSource: () => void;
  onFile: (csvText: string, filename: string) => void;
}

export function UploadStep({ config, source, onSelectSource, onResetSource, onFile }: UploadStepProps) {
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
    onFile(text, file.name);
  };

  // Stage 1 — user hasn't picked a source yet. Show only the selector.
  if (source === null) {
    return (
      <div className="space-y-4">
        <SourceSelector value={source} onChange={onSelectSource} />
      </div>
    );
  }

  // Stage 2 — source picked. Show the chip + file dropzone.
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SourceChip source={source} onChange={onResetSource} />
        <TemplateDownloadLink template={config.template} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-[#111827]">Upload CSV</h2>
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
