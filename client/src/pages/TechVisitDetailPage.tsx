/**
 * TechVisitDetailPage — Full visit detail with state-driven action buttons.
 *
 * Action flow:
 *   scheduled/dispatched → EN ROUTE → START VISIT → COMPLETE VISIT
 *
 * Complete Visit shows an outcome modal:
 *   - Completed
 *   - Needs Parts (requires note)
 *   - Needs Follow-up (requires note)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { format } from "date-fns";
import {
  ArrowLeft,
  MapPin,
  Clock,
  FileText,
  Navigation,
  Play,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// -- Types --

interface VisitJob {
  id: string;
  jobNumber: number;
  summary: string;
  jobType: string;
  description?: string;
  priority?: string;
}

interface VisitLocation {
  id: string;
  companyName: string;
  location?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  phone?: string;
}

interface VisitNote {
  id: string;
  noteText: string;
  createdAt: string;
  userName?: string;
  userFirstName?: string;
}

interface VisitDetail {
  id: string;
  visitNumber: number;
  status: string;
  scheduledStart: string;
  scheduledEnd?: string;
  estimatedDurationMinutes?: number;
  checkedInAt?: string;
  checkedOutAt?: string;
  actualDurationMinutes?: number;
  visitNotes?: string;
}

interface VisitDetailResponse {
  visit: VisitDetail;
  job: VisitJob | null;
  location: VisitLocation | null;
  notes: VisitNote[];
}

type Outcome = "completed" | "needs_parts" | "needs_followup";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  dispatched: "bg-indigo-100 text-indigo-800",
  en_route: "bg-amber-100 text-amber-800",
  on_site: "bg-green-100 text-green-800",
  in_progress: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-600",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  en_route: "En Route",
  on_site: "On Site",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function TechVisitDetailPage() {
  const { visitId } = useParams<{ visitId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // -- State --
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<Outcome>("completed");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [newNoteText, setNewNoteText] = useState("");

  // -- Queries --
  const { data, isLoading } = useQuery<VisitDetailResponse>({
    queryKey: [`/api/tech/visits/${visitId}`],
    enabled: !!visitId,
  });

  const visit = data?.visit;
  const job = data?.job;
  const location = data?.location;
  const notes = data?.notes ?? [];

  // -- Mutations --
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/tech/visits/${visitId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/tech/visits/today"] });
    // Refresh calendar + job views that reflect visit status changes
    queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
    queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
    queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  };

  const enRouteMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/tech/visits/${visitId}/en-route`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      toast({ title: "En route", description: "Status updated" });
      invalidate();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });

  const startMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/tech/visits/${visitId}/start`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      toast({ title: "Visit started", description: "You are now on site" });
      invalidate();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (params: { outcome: Outcome; outcomeNote?: string }) =>
      apiRequest(`/api/tech/visits/${visitId}/complete`, {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      toast({ title: "Visit completed" });
      setShowCompleteModal(false);
      setOutcomeNote("");
      invalidate();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: (text: string) =>
      apiRequest(`/api/tech/visits/${visitId}/notes`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      setNewNoteText("");
      invalidate();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    },
  });

  // -- Handlers --
  const handleComplete = () => {
    if (selectedOutcome !== "completed" && !outcomeNote.trim()) {
      toast({
        variant: "destructive",
        title: "Note required",
        description: "Please describe what's needed before completing.",
      });
      return;
    }
    completeMutation.mutate({
      outcome: selectedOutcome,
      outcomeNote: outcomeNote.trim() || undefined,
    });
  };

  const handleAddNote = () => {
    if (!newNoteText.trim()) return;
    addNoteMutation.mutate(newNoteText.trim());
  };

  // -- Loading --
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!visit || !job) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-muted-foreground">Visit not found</p>
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => setLocation("/tech")}>
          Back to Home
        </Button>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[visit.status] || "";
  const statusLabel = STATUS_LABELS[visit.status] || visit.status;
  const isTerminal = visit.status === "completed" || visit.status === "cancelled";

  return (
    <div className="p-4 space-y-4 pb-32">
      {/* Back button */}
      <button
        onClick={() => setLocation("/tech")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground">#{job.jobNumber}</span>
          <Badge variant="secondary" className={`text-xs ${statusColor}`}>
            {statusLabel}
          </Badge>
          {job.priority && job.priority !== "normal" && (
            <Badge variant={job.priority === "urgent" ? "destructive" : "outline"} className="text-xs">
              {job.priority}
            </Badge>
          )}
        </div>
        <h1 className="text-lg font-semibold">{job.summary}</h1>
        <p className="text-xs text-muted-foreground capitalize">{job.jobType} &middot; Visit #{visit.visitNumber}</p>
      </div>

      {/* Location card */}
      {location && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{location.companyName}</p>
                {location.address && (
                  <p className="text-xs text-muted-foreground">
                    {location.address}
                    {location.city && `, ${location.city}`}
                    {location.province && ` ${location.province}`}
                    {location.postalCode && ` ${location.postalCode}`}
                  </p>
                )}
                {location.phone && (
                  <a
                    href={`tel:${location.phone}`}
                    className="text-xs text-primary hover:underline mt-1 inline-block"
                  >
                    {location.phone}
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Schedule info */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{format(new Date(visit.scheduledStart), "EEEE, MMM d 'at' h:mm a")}</span>
          </div>
          {visit.estimatedDurationMinutes && (
            <p className="text-xs text-muted-foreground ml-6 mt-0.5">
              Est. {visit.estimatedDurationMinutes} min
            </p>
          )}
          {visit.checkedInAt && (
            <p className="text-xs text-muted-foreground ml-6 mt-0.5">
              Checked in: {format(new Date(visit.checkedInAt), "h:mm a")}
            </p>
          )}
          {visit.actualDurationMinutes != null && (
            <p className="text-xs text-muted-foreground ml-6 mt-0.5">
              Actual: {visit.actualDurationMinutes} min
            </p>
          )}
        </CardContent>
      </Card>

      {/* Job description */}
      {job.description && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Description
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{job.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Notes ({notes.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {notes.length === 0 && (
            <p className="text-xs text-muted-foreground">No notes yet</p>
          )}
          {notes.map((note) => (
            <div key={note.id} className="border-b border-border/50 pb-2 last:border-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium">
                  {note.userFirstName || note.userName || "Unknown"}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(note.createdAt), "MMM d, h:mm a")}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{note.noteText}</p>
            </div>
          ))}

          {/* Add note form */}
          {!isTerminal && (
            <div className="flex gap-2 pt-2">
              <Textarea
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder="Add a note..."
                className="min-h-[40px] text-sm resize-none"
                rows={2}
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={handleAddNote}
                disabled={!newNoteText.trim() || addNoteMutation.isPending}
                className="flex-shrink-0 self-end"
              >
                {addNoteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action buttons — fixed at bottom */}
      {!isTerminal && (
        <div className="fixed bottom-16 inset-x-0 p-4 bg-background/95 backdrop-blur border-t safe-area-pb">
          <ActionButton
            status={visit.status}
            onEnRoute={() => enRouteMutation.mutate()}
            onStart={() => startMutation.mutate()}
            onComplete={() => setShowCompleteModal(true)}
            isLoading={
              enRouteMutation.isPending ||
              startMutation.isPending
            }
          />
        </div>
      )}

      {/* Complete visit outcome modal */}
      <Dialog open={showCompleteModal} onOpenChange={setShowCompleteModal}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>Complete Visit</DialogTitle>
            <DialogDescription>How did the visit go?</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Outcome selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Outcome</Label>
              {OUTCOME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedOutcome(opt.value)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedOutcome === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </button>
              ))}
            </div>

            {/* Note field */}
            <div>
              <Label className="text-sm font-medium">
                Note {selectedOutcome !== "completed" && <span className="text-destructive">*</span>}
              </Label>
              <Textarea
                value={outcomeNote}
                onChange={(e) => setOutcomeNote(e.target.value)}
                placeholder={
                  selectedOutcome === "needs_parts"
                    ? "What parts are needed?"
                    : selectedOutcome === "needs_followup"
                      ? "What follow-up is required?"
                      : "Optional completion note..."
                }
                className="mt-1 text-sm"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full"
              onClick={handleComplete}
              disabled={completeMutation.isPending}
            >
              {completeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Complete Visit
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setShowCompleteModal(false)}
              disabled={completeMutation.isPending}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -- Sub-components --

const OUTCOME_OPTIONS: Array<{ value: Outcome; label: string; description: string }> = [
  { value: "completed", label: "Completed", description: "Work finished successfully" },
  { value: "needs_parts", label: "Needs Parts", description: "Parts required to complete" },
  { value: "needs_followup", label: "Needs Follow-up", description: "Return visit required" },
];

function ActionButton({
  status,
  onEnRoute,
  onStart,
  onComplete,
  isLoading,
}: {
  status: string;
  onEnRoute: () => void;
  onStart: () => void;
  onComplete: () => void;
  isLoading: boolean;
}) {
  // Determine which action to show based on current status
  if (status === "scheduled" || status === "dispatched") {
    return (
      <Button className="w-full h-12 text-base gap-2" onClick={onEnRoute} disabled={isLoading}>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Navigation className="h-5 w-5" />}
        En Route
      </Button>
    );
  }

  if (status === "en_route") {
    return (
      <Button className="w-full h-12 text-base gap-2 bg-green-600 hover:bg-green-700" onClick={onStart} disabled={isLoading}>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
        Start Visit
      </Button>
    );
  }

  if (status === "in_progress" || status === "on_site" || status === "on_hold") {
    return (
      <Button className="w-full h-12 text-base gap-2" variant="default" onClick={onComplete} disabled={isLoading}>
        <CheckCircle2 className="h-5 w-5" />
        Complete Visit
      </Button>
    );
  }

  return null;
}
