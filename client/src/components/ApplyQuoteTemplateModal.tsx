/**
 * ApplyQuoteTemplateModal — Apply a quote template to a quote.
 * Thin wrapper around ApplyTemplateModalBase with quote-specific config.
 */

import { apiRequest } from "@/lib/queryClient";
import { quoteKeys } from "@/lib/queryKeys/quotes";
import { FileCheck } from "lucide-react";
import type { QuoteTemplate } from "@shared/schema";
import { ApplyTemplateModalBase } from "./shared/ApplyTemplateModalBase";

interface ApplyQuoteTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  quoteNumber?: string;
}

export function ApplyQuoteTemplateModal({ open, onOpenChange, quoteId, quoteNumber }: ApplyQuoteTemplateModalProps) {
  return (
    <ApplyTemplateModalBase<QuoteTemplate>
      open={open}
      onOpenChange={onOpenChange}
      icon={FileCheck}
      description={quoteNumber ? `Apply a template to Quote ${quoteNumber}` : "Apply a template to add line items to this quote"}
      templatesQueryKey={["/api/quote-templates/list"]}
      templatesUrl="/api/quote-templates/list?activeOnly=true"
      applyFn={(templateId, mode) =>
        apiRequest(`/api/quote-templates/${templateId}/apply`, {
          method: "POST",
          body: JSON.stringify({ quoteId, mode }),
        })
      }
      invalidateKeys={[
        [...quoteKeys.root()],                    // ["quotes"] — busts all canonical
        [...quoteKeys.legacy.detailBroad(quoteId)], // ["quote", quoteId] — busts old detail
        [...quoteKeys.legacy.all()],              // ["/api/quotes"]
        [...quoteKeys.legacy.list()],             // ["/api/quotes/list"]
      ]}
      renderTemplateExtra={(t) => (
        <>
          {t.isDefault && (
            <span className="ml-1 text-helper text-muted-foreground">(Default)</span>
          )}
        </>
      )}
      selectTestId="select-quote-template"
      applyTestId="button-apply-quote-template"
    />
  );
}
