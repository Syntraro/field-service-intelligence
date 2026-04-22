/**
 * TemplateDownloadLink — offers a one-click CSV template download for
 * the active import entity. The template is inlined in the wizard
 * config so there's no extra round-trip.
 */

import { Download } from "lucide-react";

interface TemplateDownloadLinkProps {
  template: { filename: string; csv: string };
}

export function TemplateDownloadLink({ template }: TemplateDownloadLinkProps) {
  const handleDownload = () => {
    const blob = new Blob([template.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = template.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#76B054] hover:text-[#5d8d42] whitespace-nowrap"
      data-testid="import-template-download"
    >
      <Download className="h-3.5 w-3.5" />
      Download template
    </button>
  );
}
