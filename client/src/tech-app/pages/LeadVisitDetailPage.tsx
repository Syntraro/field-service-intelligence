/**
 * Tech App — Lead Visit Detail (2026-05-05).
 *
 * Stripped-down sibling of VisitDetailPage. Lead visits don't have:
 *   - equipment selection
 *   - parts / time entries / time clock
 *   - dispatch state machine (en_route, on_site, etc.)
 *
 * What they DO have:
 *   - location + contact info (allowlist DTO)
 *   - a notes thread (lead-scoped, attachments via lead_note pipeline)
 *   - a single "Mark complete" action that runs the canonical
 *     completion path server-side (atomic visit-complete + optional
 *     lead → needs_review).
 *
 * Endpoint: GET /api/tech/lead-visits/:visitId — strict allowlist DTO.
 */

import { useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Phone,
  PlusCircle,
  User,
  X,
} from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { toTelHref, toMapsHref } from "../utils/externalLinks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Chip, StatusChip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/typography";
import { AddEquipmentDialog } from "@/components/AddEquipmentDialog";
// 2026-05-05 Phase 3: canonical R2 upload pipeline. lead_note maps to
// the lead_note adapter in fileUploadService — same R2 lifecycle as
// every other entity's notes. Do NOT bypass.
import {
  useFileUpload,
  validateFileClientSide,
  resolveFileAccessUrl,
} from "@/hooks/useFileUpload";
import { useEffect } from "react";
import { ScanNameplateSheet } from "../components/ScanNameplateSheet";
import type { EquipmentSnapshot } from "../components/ScanNameplateSheet";

interface LocationEquipmentItem {
  id: string;
  name: string | null;
  type: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  tagNumber: string | null;
  installedAt: string | null;
  notes: string | null;
  nameplatePhotoId: string | null;
}

interface StagedPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

interface TechLeadVisitDetail {
  id: string;
  leadId: string;
  leadTitle: string;
  location: {
    companyName: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    contactName: string | null;
    phone: string | null;
  };
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: string;
  visitNotes: string | null;
  durationMinutes: number | null;
  type: "lead_visit";
  // Salesperson-enriched fields — only present for MANAGER_ROLES users.
  canConvert?: boolean;
  leadDescription?: string | null;
  estimatedValue?: string | null;
  priority?: string | null;
  leadStatus?: string;
  customerCompanyName?: string | null;
  convertedQuoteId?: string | null;
  locationId?: string | null;
}

interface LeadNoteRow {
  id: string;
  noteText: string;
  createdAt: string | null;
  userName: string;
  attachments?: Array<{
    id: string;
    fileId: string;
    originalName: string | null;
    mimeType: string | null;
    size: number | null;
    storageProvider?: string | null;
    status?: string | null;
  }>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "Unscheduled";
  try {
    return format(new Date(iso), "EEE MMM d, h:mm a");
  } catch {
    return iso;
  }
}

export function LeadVisitDetailPage() {
  const params = useParams<{ id: string }>();
  const visitId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false);
  const [outcomeDraft, setOutcomeDraft] = useState("");
  const [addEquipmentOpen, setAddEquipmentOpen] = useState(false);
  const [scanEquipment, setScanEquipment] = useState<EquipmentSnapshot | null>(null);
  // 2026-05-05 Phase 3: photo attachment state. Files are staged
  // locally, then uploaded after the note is created (mirrors the
  // canonical EntityNoteDialog pattern — note exists first, photos
  // bind to it via the lead_note adapter).
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload, isUploading } = useFileUpload();

  const { data: visit, isLoading, isError } = useQuery<TechLeadVisitDetail>({
    queryKey: ["/api/tech/lead-visits", visitId],
    queryFn: async () => {
      const res = await fetch(`/api/tech/lead-visits/${visitId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error("Not assigned to this visit");
        if (res.status === 404) throw new Error("Visit not found");
        throw new Error("Failed to load visit");
      }
      return res.json();
    },
    enabled: !!visitId,
  });

  // Lead notes feed — uses the canonical lead-notes endpoint via the
  // tech-side write helper. The list is read-only here; tech can
  // add notes through the tech-side POST endpoint below.
  const { data: notes = [], refetch: refetchNotes } = useQuery<LeadNoteRow[]>({
    queryKey: ["/api/leads", visit?.leadId, "notes", "tech"],
    enabled: !!visit?.leadId,
    queryFn: async () => {
      // Tech endpoint reads from the canonical lead-notes feed.
      const res = await fetch(`/api/leads/${visit!.leadId}/notes`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Equipment at the service location — only fetched in enriched (MANAGER_ROLES) mode
  // when locationId is present in the DTO. Authorization delegated to the existing
  // assertCanAccessTechLocation gate on the endpoint.
  const {
    data: equipment = [],
    isLoading: equipmentLoading,
    isError: equipmentError,
  } = useQuery<LocationEquipmentItem[]>({
    queryKey: ["/api/tech/locations", visit?.locationId, "equipment"],
    enabled: !!visit?.locationId,
    queryFn: async () => {
      const res = await fetch(
        `/api/tech/locations/${visit!.locationId}/equipment`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load equipment");
      return res.json();
    },
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const text = noteDraft.trim();
      // Allow note submission with photos but no text (the photo IS
      // the content). Backend requires noteText min(1), so when
      // photos exist with no text, we send a single space as the
      // note body — same compromise the canonical office dialog uses.
      const noteText =
        text || (stagedPhotos.length > 0 ? "(photo)" : "");
      if (!noteText) return null;

      // 1) Create the note first to get a noteId.
      const res = await fetch(`/api/tech/lead-visits/${visitId}/notes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText }),
      });
      if (!res.ok) throw new Error("Failed to add note");
      const note = await res.json();

      // 2) Upload each staged photo using the canonical R2 pipeline
      //    bound to the new noteId via the lead_note adapter.
      for (const photo of stagedPhotos) {
        await upload(photo.file, {
          entityType: "lead_note",
          entityId: note.id,
        });
      }

      return note;
    },
    onSuccess: () => {
      setNoteDraft("");
      // Revoke object URLs before clearing the staged-photo state.
      stagedPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setStagedPhotos([]);
      refetchNotes();
      toast({ title: "Note added" });
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Note failed",
        description: err?.message,
      }),
  });

  function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    const validated: StagedPhoto[] = [];
    for (const file of files) {
      const errMsg = validateFileClientSide(file);
      if (errMsg) {
        toast({
          variant: "destructive",
          title: "Photo not added",
          description: errMsg,
        });
        continue;
      }
      validated.push({
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (validated.length > 0) {
      setStagedPhotos((prev) => [...prev, ...validated]);
    }
  }

  function handleRemoveStaged(id: string) {
    setStagedPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  const completeVisit = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tech/lead-visits/${visitId}/complete`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcomeNote: outcomeDraft.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to complete visit");
      return res.json();
    },
    onSuccess: (result: { leadTransitioned?: boolean } | null) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tech/lead-visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tech/lead-visits/today"] });
      setConfirmCompleteOpen(false);
      toast({
        title: "Visit completed",
        description: result?.leadTransitioned
          ? "Lead marked as Needs Review."
          : undefined,
      });
      setLocation("/tech/today");
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Completion failed",
        description: err?.message,
      }),
  });

  if (isLoading) {
    return (
      <MobileShell showNav>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </MobileShell>
    );
  }

  if (isError || !visit) {
    return (
      <MobileShell showNav>
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">Lead visit not found</p>
          <button
            onClick={() => setLocation("/tech/today")}
            className="mt-2 min-h-[44px] px-4 text-xs text-emerald-600"
          >
            Back to Today
          </button>
        </div>
      </MobileShell>
    );
  }

  const addressLine = [
    visit.location.address,
    visit.location.city,
    visit.location.province,
    visit.location.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const isTerminal = visit.status === "completed" || visit.status === "cancelled";

  return (
    <MobileShell showNav>
      <div className="bg-[#0f1a2e] px-3 pt-2 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                window.history.back();
              } else {
                setLocation("/tech/today");
              }
            }}
            aria-label="Back"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/20"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <Chip tone="warning" size="compact">Lead visit</Chip>
            <h1 className="text-sm font-bold text-white truncate mt-0.5">
              {visit.leadTitle}
            </h1>
          </div>
        </div>
        <p className="text-xs text-slate-400 pl-7 mt-0.5 flex items-center gap-1">
          <Clock className="h-3 w-3 shrink-0" />
          {fmtDate(visit.scheduledStart)}
          {visit.durationMinutes && (
            <span className="text-slate-500">· {visit.durationMinutes} min</span>
          )}
        </p>
      </div>

      <div className="px-3 py-2 space-y-3 pb-28">
        {/* Location card */}
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <SectionLabel className="mb-1">Location</SectionLabel>
          {visit.location.companyName && (
            <p className="text-sm font-semibold text-slate-800">
              {visit.location.companyName}
            </p>
          )}
          {visit.location.contactName && (
            <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
              <User className="h-3 w-3 text-slate-400" />
              {visit.location.contactName}
            </p>
          )}
          {addressLine && (
            <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
              <MapPin className="h-3 w-3 shrink-0" />
              {addressLine}
            </p>
          )}
          <div className="flex gap-2 mt-2">
            {toTelHref(visit.location.phone) && (
              <a
                href={toTelHref(visit.location.phone)!}
                className="flex-1 h-9 rounded-md border border-emerald-200 text-xs font-semibold text-emerald-700 flex items-center justify-center gap-1.5 hover:bg-emerald-50 active:bg-emerald-100"
              >
                <Phone className="h-3 w-3" />
                Call
              </a>
            )}
            {toMapsHref(addressLine) && (
              <a
                href={toMapsHref(addressLine)!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-9 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50 active:bg-slate-100"
              >
                <MapPin className="h-3 w-3" />
                Directions
              </a>
            )}
          </div>
        </div>

        {/* Visit notes (from office) */}
        {visit.visitNotes && (
          <div className="rounded-md border border-slate-200 bg-white p-3">
            <SectionLabel className="mb-1">Office notes</SectionLabel>
            <p className="text-xs text-slate-700 whitespace-pre-wrap">
              {visit.visitNotes}
            </p>
          </div>
        )}

        {/* Salesperson-enriched info — only rendered for MANAGER_ROLES users */}
        {(visit.customerCompanyName != null ||
          visit.leadDescription != null ||
          visit.estimatedValue != null ||
          visit.leadStatus != null) && (
          <div
            className="rounded-md border border-slate-200 bg-white p-3 space-y-2"
            data-testid="lead-visit-sales-info"
          >
            <SectionLabel>Lead details</SectionLabel>
            {visit.customerCompanyName && (
              <div>
                <p className="text-xs text-slate-500">Company</p>
                <p className="text-sm font-semibold text-slate-800">
                  {visit.customerCompanyName}
                </p>
              </div>
            )}
            {visit.leadStatus && (
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Lead status</p>
                <StatusChip status={visit.leadStatus} />
              </div>
            )}
            {visit.priority && (
              <div>
                <p className="text-xs text-slate-500">Priority</p>
                <p className="text-sm text-slate-700 capitalize">{visit.priority}</p>
              </div>
            )}
            {visit.estimatedValue && (
              <div>
                <p className="text-xs text-slate-500">Estimated value</p>
                <p className="text-sm font-semibold text-slate-800">
                  ${visit.estimatedValue}
                </p>
              </div>
            )}
            {visit.leadDescription && (
              <div>
                <p className="text-xs text-slate-500">Scope notes</p>
                <p className="text-xs text-slate-700 whitespace-pre-wrap mt-0.5">
                  {visit.leadDescription}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Equipment at this location — enriched mode only (locationId present) */}
        {visit.locationId && (
          <div
            className="rounded-md border border-slate-200 bg-white p-3"
            data-testid="lead-visit-equipment-section"
          >
            <div className="flex items-center justify-between mb-2">
              <SectionLabel>Equipment at this location</SectionLabel>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setAddEquipmentOpen(true)}
                data-testid="button-lead-visit-add-equipment"
              >
                <PlusCircle className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            {equipmentLoading && (
              <div
                className="flex items-center gap-1.5 py-2"
                data-testid="lead-visit-equipment-loading"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                <span className="text-xs text-slate-400">Loading…</span>
              </div>
            )}
            {!equipmentLoading && equipmentError && (
              <p
                className="text-xs text-slate-400 italic py-2"
                data-testid="lead-visit-equipment-error"
              >
                Could not load equipment.
              </p>
            )}
            {!equipmentLoading && !equipmentError && equipment.length === 0 && (
              <p
                className="text-xs text-slate-400 italic py-2"
                data-testid="lead-visit-equipment-empty"
              >
                No equipment recorded for this location.
              </p>
            )}
            {!equipmentLoading && !equipmentError && equipment.length > 0 && (
              <ul
                className="divide-y divide-slate-100"
                data-testid="lead-visit-equipment-list"
              >
                {equipment.map((eq) => (
                  <li key={eq.id} className="py-2 first:pt-0 last:pb-0 flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800">
                        {eq.name ?? "—"}
                        {eq.type && (
                          <span className="font-normal text-slate-500 ml-1">
                            ({eq.type})
                          </span>
                        )}
                      </p>
                      {eq.manufacturer && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {eq.manufacturer}
                        </p>
                      )}
                      {eq.model && (
                        <p className="text-[11px] text-slate-500">
                          Model: {eq.model}
                        </p>
                      )}
                      {eq.serialNumber && (
                        <p className="text-[11px] text-slate-500">
                          S/N: {eq.serialNumber}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Scan nameplate"
                      data-testid="button-scan-nameplate"
                      onClick={() =>
                        setScanEquipment({
                          id: eq.id,
                          name: eq.name,
                          equipmentType: eq.type,
                          manufacturer: eq.manufacturer,
                          modelNumber: eq.model,
                          serialNumber: eq.serialNumber,
                          tagNumber: eq.tagNumber,
                          notes: eq.notes,
                          nameplatePhotoId: eq.nameplatePhotoId,
                        })
                      }
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors shrink-0"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Notes thread */}
        <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
          <SectionLabel>Notes</SectionLabel>
          {!isTerminal && (
            <div className="space-y-2">
              <Textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="What did you find onsite?"
                className="text-sm min-h-[64px] resize-none"
              />
              {/* Staged-photos strip — thumbnails of files queued for
                  upload. Tap × to remove before submitting. */}
              {stagedPhotos.length > 0 && (
                <div
                  className="flex gap-1.5 overflow-x-auto pb-1"
                  data-testid="tech-lead-note-staged-photos"
                >
                  {stagedPhotos.map((p) => (
                    <div
                      key={p.id}
                      className="relative shrink-0 w-14 h-14 rounded border border-slate-200 overflow-hidden bg-slate-100"
                    >
                      <img
                        src={p.previewUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveStaged(p.id)}
                        aria-label="Remove photo"
                        className="absolute top-0 right-0 p-0.5 bg-black/50 rounded-bl text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* 2026-05-05 Phase 3: photo attachment via canonical
                  R2 pipeline. FileEntityType="lead_note" — adapter
                  binds the file to the new note's id once it lands. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={handlePhotoPick}
                data-testid="tech-lead-note-photo-input"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={addNote.isPending || isUploading}
                  data-testid="button-tech-attach-photo"
                >
                  <Camera className="h-3.5 w-3.5 mr-1.5" />
                  Attach photo
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={
                    (!noteDraft.trim() && stagedPhotos.length === 0) ||
                    addNote.isPending ||
                    isUploading
                  }
                  onClick={() => addNote.mutate()}
                  data-testid="button-tech-add-lead-note"
                >
                  {addNote.isPending || isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : stagedPhotos.length > 0 ? (
                    `Add note · ${stagedPhotos.length} photo${stagedPhotos.length === 1 ? "" : "s"}`
                  ) : (
                    "Add note"
                  )}
                </Button>
              </div>
            </div>
          )}
          {notes.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-2">
              No notes yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="border border-slate-100 rounded-md px-3 py-2"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-slate-500">
                      {n.userName}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {n.createdAt
                        ? format(new Date(n.createdAt), "MMM d, h:mm a")
                        : ""}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">
                    {n.noteText}
                  </p>
                  {n.attachments && n.attachments.length > 0 && (
                    <div
                      className="mt-1.5 flex gap-1 flex-wrap"
                      data-testid={`tech-lead-note-attachments-${n.id}`}
                    >
                      {n.attachments.map((a) => (
                        <NoteThumb key={a.id} attachment={a} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Create Quote CTA — salesperson mode only */}
        {visit.canConvert && (
          <Button
            variant="outline"
            size="lg"
            className="w-full h-12 text-base font-semibold"
            onClick={() => setLocation(`/quotes/new?leadId=${visit.leadId}`)}
            data-testid="button-tech-create-quote"
          >
            <FileText className="h-4 w-4 mr-2" />
            Create Quote
          </Button>
        )}

        {/* Complete action */}
        {!isTerminal && (
          <Button
            size="lg"
            className="w-full h-12 text-base font-bold bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setConfirmCompleteOpen(true)}
            data-testid="button-tech-complete-lead-visit"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Mark complete
          </Button>
        )}
        {isTerminal && (
          <p className="text-xs text-center text-slate-400 italic">
            Visit {visit.status}.
          </p>
        )}
      </div>

      {visit.locationId && (
        <AddEquipmentDialog
          locationId={visit.locationId}
          open={addEquipmentOpen}
          onOpenChange={setAddEquipmentOpen}
          createUrl={`/api/tech/lead-visits/${visitId}/location-equipment`}
          onCreated={() => {
            queryClient.invalidateQueries({
              queryKey: ["/api/tech/locations", visit.locationId, "equipment"],
            });
          }}
          data-testid="lead-visit-add-equipment-dialog"
        />
      )}

      {scanEquipment && visit.locationId && (
        <ScanNameplateSheet
          open={!!scanEquipment}
          onOpenChange={(open) => { if (!open) setScanEquipment(null); }}
          equipment={scanEquipment}
          locationId={visit.locationId}
          onSaved={() => {
            setScanEquipment(null);
            queryClient.invalidateQueries({
              queryKey: ["/api/tech/locations", visit.locationId, "equipment"],
            });
          }}
        />
      )}

      <AlertDialog open={confirmCompleteOpen} onOpenChange={setConfirmCompleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this lead visit?</AlertDialogTitle>
            <AlertDialogDescription>
              The office will see this lead as ready for review and decide
              whether to send a quote.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Textarea
              value={outcomeDraft}
              onChange={(e) => setOutcomeDraft(e.target.value)}
              placeholder="Quick summary for the office (optional)"
              rows={3}
            />
            {notes.length === 0 && !outcomeDraft.trim() ? (
              <p
                className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1.5"
                data-testid="tech-lead-complete-empty-warning"
              >
                <span aria-hidden="true">⚠</span>
                <span>
                  No notes yet. The office may need to call you for
                  context. Consider adding a quick summary above.
                </span>
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Adding a note before completing helps the office decide
                on a quote without calling you.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completeVisit.isPending}>
              Cancel
            </AlertDialogCancel>
            {/* Regular Button (not AlertDialogAction) so the dialog stays
                open during the async mutation — onSuccess closes it. */}
            <Button
              onClick={() => completeVisit.mutate()}
              disabled={completeVisit.isPending}
              data-testid="button-tech-confirm-complete-lead-visit"
            >
              {completeVisit.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Mark complete"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

export default LeadVisitDetailPage;

// ─── NoteThumb (2026-05-05 Phase 3) ──────────────────────────────────
//
// Inline thumbnail for an attachment on a tech-side lead-note feed
// row. Mobile-targeted and intentionally lighter than the full
// NoteAttachmentStrip — single tap opens the resolved access URL in
// a new tab. PDFs render as a generic file chip.
function NoteThumb({
  attachment,
}: {
  attachment: {
    id: string;
    fileId: string;
    originalName: string | null;
    mimeType: string | null;
  };
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveFileAccessUrl(attachment.fileId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.fileId]);

  const isImage = (attachment.mimeType ?? "").startsWith("image/");
  if (!isImage) {
    return (
      <a
        href={url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-slate-100 rounded border border-slate-200 hover:bg-slate-200"
      >
        <ImageIcon className="h-3 w-3" />
        {attachment.originalName ?? "file"}
      </a>
    );
  }
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-12 h-12 rounded border border-slate-200 overflow-hidden bg-slate-100"
    >
      {url ? (
        <img
          src={url}
          alt={attachment.originalName ?? ""}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full animate-pulse bg-slate-200" />
      )}
    </a>
  );
}
