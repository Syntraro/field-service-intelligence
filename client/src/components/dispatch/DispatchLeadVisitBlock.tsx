/**
 * DispatchLeadVisitBlock — read-only positioned timeline block for
 * pre-sales lead visits. No drag, no resize, no job fields.
 *
 * Rendered by DispatchLaneRow beside DispatchVisitBlock/DispatchTaskBlock.
 * Click navigates to /leads/:leadId via the onSelect callback.
 * Uses amber styling consistent with LeadVisitsStrip and week/month
 * lead visit pills.
 */
import { memo } from "react";
import { format } from "date-fns";
import { MapPin } from "lucide-react";
import type { DispatchLeadVisit } from "./dispatchPreviewTypes";

type Props = {
  lead: DispatchLeadVisit;
  left: number;
  width: number;
  hasConflict?: boolean;
  onSelect?: (lead: DispatchLeadVisit) => void;
};

function DispatchLeadVisitBlockImpl({ lead, left, width, hasConflict, onSelect }: Props) {
  const effectiveWidth = Math.max(width - 2, 38);

  const timeLabel = lead.scheduledStart
    ? format(new Date(lead.scheduledStart), "h:mm a")
    : "";

  const place = [lead.locationName, lead.locationCity].filter(Boolean).join(" · ");

  return (
    <div
      onClick={() => onSelect?.(lead)}
      data-dispatch-block="lead"
      data-lead-visit-id={lead.id}
      className={`absolute top-1 bottom-1 rounded border overflow-hidden cursor-pointer
        border-amber-400 bg-amber-50/90 text-amber-900
        hover:bg-amber-100 hover:shadow-sm hover:z-10 transition-shadow
        ${hasConflict ? "ring-2 ring-red-500 ring-offset-1 shadow-md shadow-red-200/50 border-red-400" : ""}
      `}
      style={{ left, width: effectiveWidth }}
      title={`Lead: ${lead.leadTitle}${timeLabel ? ` · ${timeLabel}` : ""}`}
    >
      <div className="flex h-full flex-col justify-center px-2 py-0.5 overflow-hidden">
        {effectiveWidth > 90 ? (
          <>
            <div className="flex items-center gap-1 truncate">
              <span className="inline-flex items-center px-1 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-200 text-amber-800 flex-shrink-0">
                Lead
              </span>
              {timeLabel && (
                <span className="text-[10px] font-semibold tabular-nums truncate">
                  {timeLabel}
                </span>
              )}
            </div>
            <p className="text-[11px] font-semibold truncate leading-tight mt-0.5">
              {lead.leadTitle}
            </p>
            {place && (
              <p className="flex items-center gap-0.5 text-[10px] text-amber-700/80 truncate">
                <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                {place}
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center gap-0.5 truncate">
            <span className="inline-flex items-center px-0.5 rounded text-[8px] font-bold uppercase bg-amber-200 text-amber-800 flex-shrink-0">
              L
            </span>
            <span className="truncate text-[10px] font-semibold">{lead.leadTitle}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const DispatchLeadVisitBlock = memo(DispatchLeadVisitBlockImpl);
export default DispatchLeadVisitBlock;
