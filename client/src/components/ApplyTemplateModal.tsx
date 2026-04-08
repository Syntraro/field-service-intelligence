/**
 * ApplyTemplateModal — Apply a job template to a job.
 * Thin wrapper around ApplyTemplateModalBase with job-specific config.
 */

import { apiRequest } from "@/lib/queryClient";
import { FileText } from "lucide-react";
import type { JobTemplate } from "@shared/schema";
import { ApplyTemplateModalBase } from "./shared/ApplyTemplateModalBase";

interface ApplyTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobNumber?: number;
}

export function ApplyTemplateModal({ open, onOpenChange, jobId, jobNumber }: ApplyTemplateModalProps) {
  return (
    <ApplyTemplateModalBase<JobTemplate>
      open={open}
      onOpenChange={onOpenChange}
      icon={FileText}
      description={jobNumber ? `Apply a template to Job #${jobNumber}` : "Apply a template to add line items to this job"}
      templatesQueryKey={["/api/job-templates"]}
      templatesUrl="/api/job-templates"
      applyFn={(templateId, mode) =>
        apiRequest("/api/job-templates/apply-to-job", {
          method: "POST",
          body: JSON.stringify({ jobId, templateId, mode }),
        })
      }
      invalidateKeys={[["jobs"], ["/api/jobs", jobId, "parts"]]}
      renderTemplateExtra={(t) => (
        <>
          {t.jobType && (
            <span className="ml-2 text-xs text-muted-foreground capitalize">({t.jobType})</span>
          )}
          {t.isDefaultForJobType && (
            <span className="ml-1 text-xs text-muted-foreground">(Default)</span>
          )}
        </>
      )}
      selectTestId="select-template"
      applyTestId="button-apply-template"
    />
  );
}
