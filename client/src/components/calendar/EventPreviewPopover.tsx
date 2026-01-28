/**
 * EventPreviewPopover - Hover preview for calendar events
 *
 * Shows job details on hover without opening full modal:
 * - Job # + title
 * - Client + location
 * - Time range (or "All day")
 * - Assigned technician(s)
 * - Status
 *
 * Features:
 * - 200ms delay to prevent flicker
 * - Disabled during drag/save operations
 * - Keyboard accessible (focus trigger)
 */

import * as React from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, User, CheckCircle2, Calendar as CalendarIcon, AlertCircle } from "lucide-react";
import { formatTimeFromMinutes } from "./calendarUtils";

interface EventPreviewPopoverProps {
  children: React.ReactNode;
  /** Assignment/event data */
  event: {
    jobNumber?: number | string | null;
    summary?: string;
    status?: string;
    completed?: boolean;
    isAllDay?: boolean;
    scheduledHour?: number | null;
    scheduledStartMinutes?: number | null;
    startMinutes?: number | null;
    durationMinutes?: number;
    assignedTechnicianIds?: string[] | null;
    primaryTechnicianId?: string | null;
    technicians?: Array<{ id: string; fullName?: string; displayName?: string }>;
  };
  /** Client data */
  client?: {
    companyName?: string;
    location?: string;
    address?: string;
  } | null;
  /** List of technicians for name lookup */
  technicians?: Array<{ id: string; fullName?: string; displayName?: string; email?: string }>;
  /** Whether the event is currently being dragged */
  isDragging?: boolean;
  /** Whether the event is currently being saved */
  isSaving?: boolean;
  /** Whether the event is overdue */
  isOverdue?: boolean;
  /** Open state control (for disabling during operations) */
  disabled?: boolean;
  /** Time format from regional settings (12h/24h) */
  timeFormat?: "12h" | "24h";
}

export function EventPreviewPopover({
  children,
  event,
  client,
  technicians = [],
  isDragging = false,
  isSaving = false,
  isOverdue = false,
  disabled = false,
  timeFormat = "12h",
}: EventPreviewPopoverProps) {
  // Disable popover during drag or save operations
  const isDisabled = disabled || isDragging || isSaving;

  // Get technician names
  const techNames = React.useMemo(() => {
    // First try event.technicians if available
    if (event.technicians && event.technicians.length > 0) {
      return event.technicians.map(t => t.displayName || t.fullName || "Unknown").join(", ");
    }

    // Otherwise look up from technicians list
    const techIds = event.assignedTechnicianIds ||
      (event.primaryTechnicianId ? [event.primaryTechnicianId] : []);

    if (techIds.length === 0) return null;

    const names = techIds
      .map(id => {
        const tech = technicians.find(t => t.id === id);
        return tech?.displayName || tech?.fullName || tech?.email || "Unknown";
      })
      .filter(Boolean);

    return names.length > 0 ? names.join(", ") : null;
  }, [event, technicians]);

  // Format time range
  const timeRange = React.useMemo(() => {
    if (event.isAllDay) return "All day";

    const startMinutes = event.startMinutes ??
      (event.scheduledHour != null
        ? event.scheduledHour * 60 + (event.scheduledStartMinutes ?? 0)
        : null);

    if (startMinutes == null) return null;

    const endMinutes = startMinutes + (event.durationMinutes || 60);
    return `${formatTimeFromMinutes(startMinutes, timeFormat)} – ${formatTimeFromMinutes(endMinutes, timeFormat)}`;
  }, [event]);

  // Status info
  const statusInfo = React.useMemo(() => {
    if (event.completed || event.status === "completed") {
      return { label: "Completed", variant: "default" as const, className: "bg-green-100 text-green-700" };
    }
    if (isOverdue) {
      return { label: "Overdue", variant: "destructive" as const, className: "" };
    }
    return { label: "Scheduled", variant: "secondary" as const, className: "" };
  }, [event, isOverdue]);

  if (isDisabled) {
    // When disabled, just render children without hover card
    return <>{children}</>;
  }

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        className="w-56 p-3"
        side="right"
        align="start"
        sideOffset={8}
      >
        <div className="space-y-2">
          {/* Header: Job # + Status */}
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono font-bold text-primary text-sm">
              {event.jobNumber ? `#${event.jobNumber}` : "Job"}
            </span>
            <Badge variant={statusInfo.variant} className={`text-[10px] h-5 ${statusInfo.className}`}>
              {statusInfo.label === "Completed" && <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />}
              {statusInfo.label === "Overdue" && <AlertCircle className="h-2.5 w-2.5 mr-0.5" />}
              {statusInfo.label}
            </Badge>
          </div>

          {/* Summary/Title */}
          {event.summary && (
            <p className="text-sm font-medium line-clamp-2">{event.summary}</p>
          )}

          {/* Client + Location */}
          {client && (
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium text-foreground">{client.companyName}</div>
                {client.location && <div>{client.location}</div>}
              </div>
            </div>
          )}

          {/* Time */}
          {timeRange && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 flex-shrink-0" />
              <span>{timeRange}</span>
            </div>
          )}

          {/* Technician(s) */}
          {techNames && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{techNames}</span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
