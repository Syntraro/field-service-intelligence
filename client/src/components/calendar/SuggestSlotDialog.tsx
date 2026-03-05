/**
 * SuggestSlotDialog — Phase 6: Auto-gap scheduling UI.
 *
 * Shows ranked slot suggestions for an unscheduled visit, with travel time,
 * risk badges, and one-click apply to schedule.
 */

import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  MapPin,
  Clock,
  Truck,
  AlertTriangle,
  WifiOff,
  Zap,
  Check,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuggestedSlot {
  technicianId: string;
  technicianName: string;
  date: string;
  start: string;
  end: string;
  prevVisitId: string | null;
  nextVisitId: string | null;
  travelBeforeMinutes: number;
  travelAfterMinutes: number;
  addedDriveMinutes: number;
  downstreamLateMinutes: number;
  riskFlags: {
    offline?: boolean;
    runningLong?: boolean;
    hasAlerts?: boolean;
  };
  score: number;
  explanation: string;
}

interface SuggestSlotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The unscheduled visit/job item from the sidebar */
  item: {
    jobId: string;
    visitId?: string;
    version?: number;
    jobVersion?: number;
    durationMinutes?: number;
    estimatedDurationMinutes?: number;
    locationLat?: string | number;
    locationLng?: string | number;
    lat?: string | number;
    lng?: string | number;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

type DateRange = "today" | "3days" | "week";

function getDateRange(range: DateRange): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today);
  if (range === "today") {
    // same day
  } else if (range === "3days") {
    to.setDate(to.getDate() + 2);
  } else {
    to.setDate(to.getDate() + 6);
  }
  return { dateFrom: from, dateTo: to.toISOString().slice(0, 10) };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SuggestSlotDialog({ open, onOpenChange, item }: SuggestSlotDialogProps) {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState<DateRange>("today");
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  const { dateFrom, dateTo } = useMemo(() => getDateRange(dateRange), [dateRange]);

  // Build request body
  const requestBody = useMemo(() => {
    if (!item) return null;
    const body: Record<string, unknown> = { dateFrom, dateTo };
    if (item.visitId) {
      body.visitId = item.visitId;
    } else {
      // Try to get location from item
      const lat = item.locationLat ?? item.lat;
      const lng = item.locationLng ?? item.lng;
      if (lat && lng) {
        body.location = { lat: Number(lat), lng: Number(lng) };
      }
      body.durationMinutes = item.durationMinutes ?? item.estimatedDurationMinutes ?? 60;
    }
    return body;
  }, [item, dateFrom, dateTo]);

  // Fetch suggestions
  const {
    data: suggestData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<{ suggestions: SuggestedSlot[] }>({
    queryKey: ["intelligence", "suggest-slots", requestBody],
    queryFn: () =>
      apiRequest("/api/intelligence/suggest-slots", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      }),
    enabled: open && !!requestBody,
    staleTime: 0,
    retry: false,
  });

  const suggestions = suggestData?.suggestions || [];

  // Apply mutation: schedule the visit at the chosen slot
  const applyMutation = useMutation({
    mutationFn: async (slot: SuggestedSlot) => {
      if (!item) throw new Error("No item");
      const version = item.jobVersion ?? item.version ?? 0;
      return apiRequest("/api/calendar/schedule", {
        method: "POST",
        body: JSON.stringify({
          jobId: item.jobId,
          technicianUserId: slot.technicianId,
          startAt: slot.start,
          endAt: slot.end,
          version,
        }),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: () => {
      toast({ title: "Scheduled", description: "Visit placed in selected slot." });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/day-summary"] });
      queryClient.invalidateQueries({ queryKey: ["attention"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Scheduling failed",
        description: err?.message || "Could not schedule visit.",
      });
    },
    onSettled: () => setApplyingIdx(null),
  });

  const handleApply = (slot: SuggestedSlot, idx: number) => {
    setApplyingIdx(idx);
    applyMutation.mutate(slot);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Suggest Slot
          </DialogTitle>
        </DialogHeader>

        {/* Controls */}
        <div className="px-4 pb-2 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Range:</span>
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
              <SelectTrigger className="w-28 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="3days">3 days</SelectItem>
                <SelectItem value="week">This week</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {item && (
            <span className="text-xs text-muted-foreground">
              {item.durationMinutes ?? item.estimatedDurationMinutes ?? 60}min duration
            </span>
          )}
        </div>

        {/* Results */}
        <ScrollArea className="max-h-[400px] border-t">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Finding best slots...</span>
            </div>
          ) : isError ? (
            <div className="px-4 py-8 text-center">
              <AlertTriangle className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {(error as any)?.message || "Could not fetch suggestions"}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Clock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No available slots found</p>
              <p className="text-xs text-muted-foreground mt-1">Try expanding the date range</p>
            </div>
          ) : (
            <div className="divide-y">
              {suggestions.map((slot, idx) => (
                <div
                  key={`${slot.technicianId}-${slot.start}`}
                  className={`px-4 py-3 hover:bg-muted/30 transition-colors ${previewIdx === idx ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                >
                  {/* Row 1: Tech name + time + date */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">{slot.technicianName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatTime(slot.start)} – {formatTime(slot.end)}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                      {formatDate(slot.date)}
                    </span>
                  </div>

                  {/* Row 2: Travel + risk info */}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <Truck className="h-3 w-3" />
                      {slot.travelBeforeMinutes}m to site
                    </span>
                    {slot.travelAfterMinutes > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {slot.travelAfterMinutes}m to next
                      </span>
                    )}
                    {slot.addedDriveMinutes > 0 && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                        +{slot.addedDriveMinutes}m drive
                      </Badge>
                    )}
                    {slot.downstreamLateMinutes > 0 && (
                      <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">
                        {slot.downstreamLateMinutes}m late risk
                      </Badge>
                    )}
                    {slot.riskFlags.offline && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 gap-0.5">
                        <WifiOff className="h-2.5 w-2.5" /> offline
                      </Badge>
                    )}
                    {slot.riskFlags.runningLong && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 gap-0.5">
                        <Clock className="h-2.5 w-2.5" /> running long
                      </Badge>
                    )}
                  </div>

                  {/* Row 3: Actions */}
                  <div className="flex items-center gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      onClick={() => setPreviewIdx(previewIdx === idx ? null : idx)}
                    >
                      {previewIdx === idx ? "Hide preview" : "Preview"}
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 text-[11px] px-2 gap-1"
                      disabled={applyingIdx !== null}
                      onClick={() => handleApply(slot, idx)}
                    >
                      {applyingIdx === idx ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      Apply
                    </Button>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      score {slot.score}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
