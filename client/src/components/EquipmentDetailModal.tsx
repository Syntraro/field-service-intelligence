/**
 * EquipmentDetailModal — Equipment info + service history with note edit/delete.
 * History source: GET /api/equipment/:equipmentId/history (canonical job_notes SSoT).
 * Note edit: PATCH /api/jobs/:jobId/notes/:noteId (canonical, requires MANAGER_ROLES).
 * Note delete: DELETE /api/jobs/:jobId/notes/:noteId (canonical, requires MANAGER_ROLES).
 * Per-note author attribution. Job number is a clickable link to /jobs/:jobId.
 * Shared by Job Detail and Location Detail equipment surfaces.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import type { LocationEquipment } from "@shared/schema";

import { MANAGER_ROLES } from "@/lib/roles";

interface HistoryNote {
  id: string;
  text: string;
  createdAt: string | null;
  author: string | null;
}

interface HistoryJobGroup {
  jobId: string;
  jobNumber: number;
  jobDate: string | null;
  notes: HistoryNote[];
}

interface EquipmentDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipment: LocationEquipment | null;
  jobId?: string;
}

function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function EquipmentDetailModal({ open, onOpenChange, equipment }: EquipmentDetailModalProps) {
  if (!equipment) return null;

  const eq = equipment;
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const canEditNotes = !!(user?.role && (MANAGER_ROLES as readonly string[]).includes(user.role));

  // Edit state: which note is being edited
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Delete confirmation state
  const [confirmDeleteNoteId, setConfirmDeleteNoteId] = useState<string | null>(null);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);

  const history = useQuery<HistoryJobGroup[]>({
    queryKey: ["equipment-history", eq.id],
    queryFn: () => apiRequest(`/api/equipment/${eq.id}/history`),
    enabled: open,
  });

  const invalidateHistory = (jobId?: string) => {
    queryClient.invalidateQueries({ queryKey: ["equipment-history", eq.id] });
    // Keep job notes section in sync when notes are edited/deleted here
    if (jobId) queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] });
  };

  // Edit mutation: PATCH /api/jobs/:jobId/notes/:noteId
  const editMutation = useMutation({
    mutationFn: ({ jobId, noteId, noteText }: { jobId: string; noteId: string; noteText: string }) =>
      apiRequest(`/api/jobs/${jobId}/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ noteText }),
      }),
    onSuccess: (_data, { jobId }) => {
      invalidateHistory(jobId);
      setEditingNoteId(null);
      setEditText("");
    },
  });

  // Delete mutation: DELETE /api/jobs/:jobId/notes/:noteId
  const deleteMutation = useMutation({
    mutationFn: ({ jobId, noteId }: { jobId: string; noteId: string }) =>
      apiRequest(`/api/jobs/${jobId}/notes/${noteId}`, { method: "DELETE" }),
    onSuccess: (_data, { jobId }) => {
      invalidateHistory(jobId);
      setConfirmDeleteNoteId(null);
      setDeleteJobId(null);
    },
  });

  const startEdit = (noteId: string, currentText: string) => {
    setEditingNoteId(noteId);
    setEditText(currentText);
    setConfirmDeleteNoteId(null);
  };
  const cancelEdit = () => { setEditingNoteId(null); setEditText(""); };

  const startDelete = (noteId: string, jobId: string) => {
    setConfirmDeleteNoteId(noteId);
    setDeleteJobId(jobId);
    setEditingNoteId(null);
  };

  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const toggleJob = (jId: string) => {
    setExpandedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jId)) next.delete(jId); else next.add(jId);
      return next;
    });
  };

  const infoItems = [
    ["Make", eq.manufacturer],
    ["Model", eq.modelNumber],
    ["Serial Number", eq.serialNumber],
  ].filter(([, v]) => v);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[85vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b bg-muted/30 shrink-0">
          <DialogTitle className="text-lg font-semibold leading-tight">
            {eq.name || "Equipment"}
          </DialogTitle>
          {eq.equipmentType && (
            <p className="text-sm text-muted-foreground mt-0.5">{eq.equipmentType}</p>
          )}
          <DialogDescription className="sr-only">Equipment details and service history</DialogDescription>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Equipment info */}
          {infoItems.length > 0 && (
            <div className="px-6 py-4 border-b">
              <div className="grid grid-cols-3 gap-4">
                {infoItems.map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                    <p className="text-sm font-medium text-foreground">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Service History */}
          <div className="px-6 py-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Service History</h3>

            {history.isLoading && (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {history.data?.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-10">
                No service history for this equipment
              </p>
            )}

            <div className="space-y-2">
              {history.data?.map((job, idx) => {
                const isExpanded = idx === 0 || expandedJobs.has(job.jobId);

                return (
                  <div key={job.jobId} className="rounded-md border bg-background overflow-hidden">
                    {/* Job header */}
                    <button
                      onClick={() => idx !== 0 ? toggleJob(job.jobId) : undefined}
                      className="w-full px-3 py-2.5 flex items-center justify-between bg-muted/50 hover:bg-muted/70 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {idx !== 0 && (
                          isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0 flex items-baseline gap-2">
                          <span
                            className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 hover:underline cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); onOpenChange(false); setLocation(`/jobs/${job.jobId}`); }}
                          >
                            Job #{job.jobNumber}
                          </span>
                          {job.jobDate && (
                            <span className="text-xs text-muted-foreground">{formatDate(job.jobDate)}</span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Notes with per-note author + edit/delete */}
                    {isExpanded && (
                      <div className="px-3 py-2.5 border-t border-border/50">
                        {job.notes.length > 0 ? (
                          <ul className="space-y-2">
                            {job.notes.map(n => {
                              const isEditing = editingNoteId === n.id;
                              const isDeleting = confirmDeleteNoteId === n.id;

                              if (isEditing) {
                                return (
                                  <li key={n.id} className="rounded-md border p-2 bg-muted/20 space-y-2">
                                    <Textarea
                                      value={editText}
                                      onChange={e => setEditText(e.target.value)}
                                      className="min-h-[50px] text-sm resize-none"
                                      autoFocus
                                    />
                                    {editMutation.isError && (
                                      <p className="text-xs text-destructive">Failed to save</p>
                                    )}
                                    <div className="flex gap-2 justify-end">
                                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={cancelEdit}>
                                        Cancel
                                      </Button>
                                      <Button size="sm" className="h-7 text-xs gap-1"
                                        onClick={() => editMutation.mutate({ jobId: job.jobId, noteId: n.id, noteText: editText.trim() })}
                                        disabled={!editText.trim() || editMutation.isPending}>
                                        {editMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                                        Save
                                      </Button>
                                    </div>
                                  </li>
                                );
                              }

                              if (isDeleting) {
                                return (
                                  <li key={n.id} className="rounded-md border border-destructive/30 bg-destructive/5 p-2 space-y-2">
                                    <p className="text-xs font-medium text-destructive">Delete this note?</p>
                                    <p className="text-xs text-muted-foreground">This will permanently remove this note from the equipment history.</p>
                                    <div className="flex gap-2 justify-end">
                                      <Button variant="outline" size="sm" className="h-7 text-xs"
                                        onClick={() => { setConfirmDeleteNoteId(null); setDeleteJobId(null); }}>
                                        Cancel
                                      </Button>
                                      <Button variant="destructive" size="sm" className="h-7 text-xs gap-1"
                                        onClick={() => deleteMutation.mutate({ jobId: deleteJobId!, noteId: n.id })}
                                        disabled={deleteMutation.isPending}>
                                        {deleteMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                                        Delete
                                      </Button>
                                    </div>
                                  </li>
                                );
                              }

                              return (
                                <li key={n.id} className="group flex items-start gap-2">
                                  <span className="text-muted-foreground mt-1.5 shrink-0">•</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm leading-relaxed">
                                      {n.text}
                                      <span className="text-xs text-muted-foreground ml-1.5">
                                        — {n.author || "Unknown technician"}
                                      </span>
                                    </p>
                                  </div>
                                  {/* Edit/Delete actions — visible on hover, managers only */}
                                  {canEditNotes && (
                                    <div className="shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={() => startEdit(n.id, n.text)}
                                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                        title="Edit note"
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={() => startDelete(n.id, job.jobId)}
                                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                        title="Delete note"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-xs text-muted-foreground">No notes</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
