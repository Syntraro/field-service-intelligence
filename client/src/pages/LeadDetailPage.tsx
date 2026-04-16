/**
 * LeadDetailPage — Canonical lead detail page.
 * Two-column layout matching Job/Invoice detail family.
 * Left: description, related quote, notes. Right: actions, metadata.
 */
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getClientDisplayName } from "@shared/clientDisplayName";
import {
  ArrowLeft, Loader2, MapPin, User, Calendar, DollarSign, Phone, Mail,
  StickyNote, Trash2, FileText, Send, ChevronRight, Briefcase, Star,
  Pencil, Check, X, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { MetaRow } from "@/components/ui/meta-row";
import { EmptyState } from "@/components/ui/empty-state";

// ── Types ──

interface LeadDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  estimatedValue: string | null;
  sourceType: string;
  locationId: string;
  customerCompanyId: string | null;
  createdByUserId: string;
  originTechnicianId: string | null;
  assignedToUserId: string | null;
  convertedQuoteId: string | null;
  convertedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
  location?: { companyName: string | null; address: string | null; city: string | null; province: string | null; postalCode: string | null; contactName: string | null; email: string | null; phone: string | null } | null;
  customerCompanyName?: string | null; // backward compat
  customerCompany?: { id: string; name: string | null; firstName: string | null; lastName: string | null; useCompanyAsPrimary: boolean } | null;
  createdByName?: string | null;
  originTechnicianName?: string | null;
  assignedToName?: string | null;
}

interface LeadNote {
  id: string;
  userId: string;
  text: string;
  author: string;
  createdAt: string | null;
  updatedAt: string | null;
}

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  new: { bg: "bg-blue-100", text: "text-blue-700" },
  contacted: { bg: "bg-amber-100", text: "text-amber-700" },
  quoted: { bg: "bg-purple-100", text: "text-purple-700" },
  won: { bg: "bg-emerald-100", text: "text-emerald-700" },
  lost: { bg: "bg-slate-100", text: "text-slate-500" },
};

// ── Component ──

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const leadId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const [noteText, setNoteText] = useState("");
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showHardDeleteConfirm, setShowHardDeleteConfirm] = useState(false);
  const [showConvertConfirm, setShowConvertConfirm] = useState(false);
  // Description edit state
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  // Note edit state — only one note edit open at a time
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteEditDraft, setNoteEditDraft] = useState("");
  const [noteDeleteConfirmId, setNoteDeleteConfirmId] = useState<string | null>(null);

  // ── Queries ──
  const { data: lead, isLoading, isError } = useQuery<LeadDetail>({
    queryKey: ["leads", "detail", leadId],
    queryFn: () => apiRequest(`/api/leads/${leadId}`),
    enabled: !!leadId,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: notes = [], refetch: refetchNotes } = useQuery<LeadNote[]>({
    queryKey: ["leads", "detail", leadId, "notes"],
    queryFn: () => apiRequest(`/api/leads/${leadId}/notes`),
    enabled: !!leadId,
    staleTime: 2 * 60_000,
  });

  // ── Mutations ──
  const statusMutation = useMutation({
    mutationFn: (status: string) => apiRequest(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leads"] }); toast({ title: "Lead updated" }); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addNoteMutation = useMutation({
    mutationFn: (text: string) => apiRequest(`/api/leads/${leadId}/notes`, { method: "POST", body: JSON.stringify({ noteText: text }) }),
    onSuccess: () => { refetchNotes(); setNoteText(""); toast({ title: "Note added" }); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ noteId, text }: { noteId: string; text: string }) =>
      apiRequest(`/api/leads/${leadId}/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ noteText: text }) }),
    onSuccess: () => {
      refetchNotes();
      setEditingNoteId(null);
      setNoteEditDraft("");
      toast({ title: "Note updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) =>
      apiRequest(`/api/leads/${leadId}/notes/${noteId}`, { method: "DELETE" }),
    onSuccess: () => {
      refetchNotes();
      setNoteDeleteConfirmId(null);
      toast({ title: "Note deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateDescriptionMutation = useMutation({
    mutationFn: (description: string | null) =>
      apiRequest(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ description }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setEditingDescription(false);
      toast({ title: "Description updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest(`/api/leads/${leadId}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leads"] }); toast({ title: "Lead archived" }); setLocation("/leads"); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const hardDeleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/leads/${leadId}/hard`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leads"] }); toast({ title: "Lead permanently deleted" }); setLocation("/leads"); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: () => {
      // Match the canonical quote creation pattern from NewQuoteModal:
      // issueDate is required by createQuoteSchema; default to today + 30-day expiry.
      const today = new Date().toISOString().split("T")[0];
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      return apiRequest("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          locationId: lead?.locationId,
          leadId: lead?.id,
          title: lead?.title || undefined,
          issueDate: today,
          expiryDate: expiry.toISOString().split("T")[0],
          lines: [],
        }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: "Quote created", description: `Quote #${data.quoteNumber} created from lead.` });
      setShowConvertConfirm(false);
      setLocation(`/quotes/${data.id}`);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Loading / Error ──
  if (isLoading) return <div className="bg-[#f1f5f9] h-full flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (isError || !lead) return (
    <div className="bg-[#f1f5f9] h-full flex items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-slate-500">Lead not found</p>
        <Button variant="outline" className="mt-3" size="sm" onClick={() => setLocation("/leads")}><ArrowLeft className="h-3.5 w-3.5 mr-1" />Back to Leads</Button>
      </div>
    </div>
  );

  const fmtDate = (d: string | null) => d ? format(new Date(d), "MMM d, yyyy") : "—";
  const fmtDateTime = (d: string | null) => d ? format(new Date(d), "MMM d, yyyy h:mm a") : "";
  const fmtValue = (v: string | null) => v ? `$${parseFloat(v).toLocaleString()}` : "—";
  const canContact = lead.status === "new";
  const canMarkLost = lead.status === "new" || lead.status === "contacted";
  const canConvert = (lead.status === "new" || lead.status === "contacted") && !lead.convertedQuoteId;
  const isTerminal = lead.status === "won" || lead.status === "lost";
  const statusColor = STATUS_BADGE[lead.status] || STATUS_BADGE.new;
  const addressLine = [lead.location?.address, lead.location?.city, lead.location?.province, lead.location?.postalCode].filter(Boolean).join(", ");
  const contactLine = [lead.location?.phone, lead.location?.email].filter(Boolean).join(" • ");

  return (
    <div className="bg-[#f1f5f9] h-full flex flex-col">
      <div className="px-4 lg:px-6 py-4 flex-1 min-h-0">

        {/* ── SINGLE TWO-COLUMN GRID for entire page ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 h-full">

          {/* ── LEFT COLUMN ── */}
          <div className="space-y-3 min-w-0 min-h-0 overflow-y-auto lg:pr-1">

            {/* Lead Summary Card (compact) */}
            <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <button onClick={() => setLocation("/leads")} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                    <ArrowLeft className="h-3 w-3" />
                  </button>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Lead</span>
                </div>
                <h1 className="text-lg font-bold text-slate-900 leading-tight truncate">{lead.title}</h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${statusColor.bg} ${statusColor.text}`}>
                    {lead.status}
                  </span>
                  {lead.priority && <Badge variant="outline" className="text-xs px-1.5 py-0 capitalize">{lead.priority}</Badge>}
                  <span className="text-xs text-slate-400 uppercase tracking-wide">{lead.sourceType}</span>
                </div>
                {/* Client / Location */}
                <div className="mt-2 pt-1.5 border-t border-slate-100">
                  {(lead.customerCompany || lead.customerCompanyName || lead.location?.companyName) && (
                    <p className="text-sm font-semibold text-slate-800">
                      {lead.customerCompany ? getClientDisplayName(lead.customerCompany) : (lead.customerCompanyName || lead.location?.companyName)}
                    </p>
                  )}
                  {lead.location?.contactName && (
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><User className="h-3 w-3 text-slate-400" />{lead.location.contactName}</p>
                  )}
                  {addressLine && (
                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><MapPin className="h-3 w-3 shrink-0" />{addressLine}</p>
                  )}
                  {contactLine && <p className="text-xs text-slate-400 mt-0.5">{contactLine}</p>}
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-[#f8fafc] border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-[#64748b]" />Description
                </span>
                {!editingDescription && !isTerminal && (
                  <button
                    onClick={() => { setDescriptionDraft(lead.description ?? ""); setEditingDescription(true); }}
                    className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                    aria-label="Edit description"
                  >
                    <Pencil className="h-3 w-3" />Edit
                  </button>
                )}
              </div>
              <div className="px-5 py-3">
                {editingDescription ? (
                  <div className="space-y-2">
                    <Textarea
                      value={descriptionDraft}
                      onChange={(e) => setDescriptionDraft(e.target.value)}
                      placeholder="Add a description..."
                      className="min-h-[96px] text-sm resize-y"
                      rows={4}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setEditingDescription(false); setDescriptionDraft(""); }}
                        disabled={updateDescriptionMutation.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => updateDescriptionMutation.mutate(descriptionDraft.trim() || null)}
                        disabled={updateDescriptionMutation.isPending}
                      >
                        {updateDescriptionMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : lead.description ? (
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{lead.description}</p>
                ) : (
                  <p className="text-xs text-slate-400 italic">No description</p>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-[#f8fafc] border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
                  <StickyNote className="h-4 w-4 text-[#64748b]" />Notes
                  {notes.length > 0 && <span className="text-xs text-slate-400 font-normal">({notes.length})</span>}
                </span>
              </div>
              <div className="px-5 py-3 space-y-3">
                {/* Add note */}
                {!isTerminal && (
                  <div className="flex gap-2">
                    <Textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add a note..."
                      className="min-h-[56px] text-sm resize-none flex-1"
                      rows={2}
                    />
                    <Button
                      size="sm"
                      className="self-end h-9 px-3"
                      onClick={() => addNoteMutation.mutate(noteText.trim())}
                      disabled={!noteText.trim() || addNoteMutation.isPending}
                    >
                      {addNoteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                )}
                {/* Notes list */}
                {notes.length === 0 ? (
                  <EmptyState message="No notes yet" className="py-4" />
                ) : (
                  <div className="space-y-2">
                    {notes.map(n => {
                      const isEditing = editingNoteId === n.id;
                      const isConfirmingDelete = noteDeleteConfirmId === n.id;
                      const canEdit = !isTerminal && currentUserId === n.userId;
                      return (
                        <div key={n.id} className="border border-slate-100 rounded-md px-3 py-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-slate-500">
                              {n.author}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400">{n.createdAt ? fmtDateTime(n.createdAt) : ""}</span>
                              {canEdit && !isEditing && !isConfirmingDelete && (
                                <div className="flex gap-0.5">
                                  <button
                                    onClick={() => { setEditingNoteId(n.id); setNoteEditDraft(n.text); }}
                                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                                    title="Edit note"
                                    aria-label="Edit note"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => setNoteDeleteConfirmId(n.id)}
                                    className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"
                                    title="Delete note"
                                    aria-label="Delete note"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          {isEditing ? (
                            <div className="space-y-2">
                              <Textarea
                                value={noteEditDraft}
                                onChange={(e) => setNoteEditDraft(e.target.value)}
                                className="min-h-[64px] text-sm resize-y"
                                rows={3}
                                autoFocus
                              />
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => { setEditingNoteId(null); setNoteEditDraft(""); }}
                                  disabled={updateNoteMutation.isPending}
                                >
                                  <X className="h-3 w-3 mr-1" />Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => updateNoteMutation.mutate({ noteId: n.id, text: noteEditDraft.trim() })}
                                  disabled={!noteEditDraft.trim() || updateNoteMutation.isPending}
                                >
                                  {updateNoteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                                  Save
                                </Button>
                              </div>
                            </div>
                          ) : isConfirmingDelete ? (
                            <div className="space-y-2">
                              <p className="text-xs text-red-600 font-medium">Delete this note? This cannot be undone.</p>
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setNoteDeleteConfirmId(null)}
                                  disabled={deleteNoteMutation.isPending}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => deleteNoteMutation.mutate(n.id)}
                                  disabled={deleteNoteMutation.isPending}
                                >
                                  {deleteNoteMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                                  Delete
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{n.text}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT RAIL ── */}
          <aside className="space-y-3 min-h-0 overflow-y-auto">

            {/* Details / Metadata — top of rail for immediate context */}
            <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-2 bg-[#f8fafc] border-b border-slate-100">
                <span className="text-sm font-semibold text-[#0f172a]">Details</span>
              </div>
              <div className="px-4 py-2.5 space-y-2 text-xs">
                <MetaRow label="Estimated Value" value={fmtValue(lead.estimatedValue)} />
                <MetaRow label="Captured By" value={lead.originTechnicianName || "—"} />
                <MetaRow label="Created By" value={lead.createdByName || "—"} />
                <MetaRow label="Assigned To" value={lead.assignedToName || "Unassigned"} />
                <div className="border-t border-slate-100 pt-1.5">
                  <MetaRow label="Created" value={fmtDate(lead.createdAt)} />
                  {lead.updatedAt && <MetaRow label="Updated" value={fmtDate(lead.updatedAt)} />}
                  {lead.convertedAt && <MetaRow label="Converted" value={fmtDate(lead.convertedAt)} />}
                </div>
              </div>
            </div>

            {/* Actions + Quote — single card */}
            <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-2 bg-[#f8fafc] border-b border-slate-100">
                <span className="text-sm font-semibold text-[#0f172a]">Actions</span>
              </div>
              <div className="px-4 py-2.5 space-y-1.5">
                {canConvert && !lead.convertedQuoteId && (
                  <Button className="w-full justify-start gap-2 h-8 text-xs" size="sm" onClick={() => setShowConvertConfirm(true)} disabled={convertMutation.isPending}>
                    <FileText className="h-3.5 w-3.5" />Convert to Quote
                  </Button>
                )}
                {canContact && (
                  <Button variant="outline" className="w-full justify-start gap-2 h-8 text-xs" size="sm" onClick={() => statusMutation.mutate("contacted")} disabled={statusMutation.isPending}>
                    <Send className="h-3.5 w-3.5" />Mark Contacted
                  </Button>
                )}
                {canMarkLost && (
                  <Button variant="outline" className="w-full justify-start gap-2 h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50" size="sm" onClick={() => statusMutation.mutate("lost")} disabled={statusMutation.isPending}>
                    Mark Lost
                  </Button>
                )}
                <Button variant="ghost" className="w-full justify-start gap-2 h-8 text-xs text-slate-500 hover:text-amber-700 hover:bg-amber-50" size="sm" onClick={() => setShowArchiveConfirm(true)}>
                  <Trash2 className="h-3.5 w-3.5" />Archive Lead
                </Button>
                <Button variant="ghost" className="w-full justify-start gap-2 h-8 text-xs text-slate-500 hover:text-red-700 hover:bg-red-50" size="sm" onClick={() => setShowHardDeleteConfirm(true)}>
                  <AlertTriangle className="h-3.5 w-3.5" />Delete Permanently
                </Button>

                {/* Quote section */}
                <div className="border-t border-slate-100 pt-2 mt-1">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Quote</p>
                  {lead.convertedQuoteId ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-emerald-700">Converted {lead.convertedAt ? fmtDate(lead.convertedAt) : ""}</p>
                      <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-8 text-xs" onClick={() => setLocation(`/quotes/${lead.convertedQuoteId}`)}>
                        <ChevronRight className="h-3 w-3" />View Quote
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">No linked quote</p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ── DIALOGS ── */}
      <Dialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Archive this lead?</DialogTitle>
            <DialogDescription>This will remove the lead from the active list. It can be restored later.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchiveConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending}>
              {archiveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHardDeleteConfirm} onOpenChange={setShowHardDeleteConfirm}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              Permanently delete this lead?
            </DialogTitle>
            <DialogDescription>
              This will permanently destroy the lead and all of its notes. <strong>This cannot be undone.</strong> Use Archive instead if you may need to restore it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHardDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => hardDeleteMutation.mutate()} disabled={hardDeleteMutation.isPending}>
              {hardDeleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showConvertConfirm} onOpenChange={setShowConvertConfirm}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Convert to Quote?</DialogTitle>
            <DialogDescription>This will create a new quote from this lead with the same client and location. The lead status will be updated to "quoted".</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConvertConfirm(false)}>Cancel</Button>
            <Button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}>
              {convertMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Create Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// MetaRow imported from shared component
