import { Pencil, Trash2, RefreshCw } from "lucide-react";
import type { DispatchShiftEntry } from "@/components/dispatch/dispatchPreviewTypes";
import { SUBTYPE_LABELS } from "./UnavailableSubtypeSelect";

const TYPE_STYLES: Record<string, string> = {
  normal:
    "bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100",
  on_call:
    "bg-purple-50 border-purple-200 text-purple-800 hover:bg-purple-100",
  unavailable:
    "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100",
};

const TYPE_ICON_CLASS: Record<string, string> = {
  normal: "text-blue-500 hover:text-blue-700",
  on_call: "text-purple-500 hover:text-purple-700",
  unavailable: "text-amber-500 hover:text-amber-700",
};

const TYPE_LABEL: Record<string, string> = {
  normal: "Work",
  on_call: "On Call",
  unavailable: "Unavailable",
};

interface Props {
  shift: DispatchShiftEntry;
  onEdit: (shift: DispatchShiftEntry) => void;
  onDelete: (shift: DispatchShiftEntry) => void;
  /** Company IANA timezone for correct local-time display. */
  timezone?: string;
}

function formatShiftTime(iso: string, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export default function ShiftBlock({ shift, onEdit, onDelete, timezone }: Props) {
  const styleClass = TYPE_STYLES[shift.shiftType] ?? TYPE_STYLES.normal;
  const iconClass = TYPE_ICON_CLASS[shift.shiftType] ?? TYPE_ICON_CLASS.normal;
  const isRecurring = !!shift.occurrenceDate;

  const timeLabel = shift.allDay
    ? "All day"
    : `${formatShiftTime(shift.startsAt, timezone)}–${formatShiftTime(shift.endsAt, timezone)}`;

  const typeLabel =
    shift.shiftType === "unavailable" && shift.shiftSubtype
      ? SUBTYPE_LABELS[shift.shiftSubtype] ?? TYPE_LABEL.unavailable
      : TYPE_LABEL[shift.shiftType] ?? shift.shiftType;

  return (
    <div
      className={`flex items-start justify-between gap-1 rounded border px-2 py-1 text-[11px] leading-tight ${styleClass}`}
      data-testid={`shift-block-${shift.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="font-medium truncate">{typeLabel}</span>
          {isRecurring && (
            <RefreshCw className="h-2.5 w-2.5 shrink-0 opacity-50" aria-label="Recurring" />
          )}
        </div>
        <div className="opacity-70">{timeLabel}</div>
        {shift.note && (
          <div className="truncate opacity-60 mt-0.5">{shift.note}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => onEdit(shift)}
          className={`rounded p-0.5 ${iconClass}`}
          aria-label="Edit shift"
          data-testid={`shift-edit-${shift.id}`}
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(shift)}
          className="rounded p-0.5 text-slate-400 hover:text-rose-600"
          aria-label="Delete shift"
          data-testid={`shift-delete-${shift.id}`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
