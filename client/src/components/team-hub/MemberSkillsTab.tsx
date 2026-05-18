import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
import {
  FormField,
  FormLabel,
  FormHelperText,
  FormErrorText,
  FormRow,
} from "@/components/ui/form-field";
import {
  Wrench,
  Plus,
  BookOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { TeamSkillLibraryItem, TeamMemberSkill } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

function ExpiryBadge({
  status,
  date,
}: {
  status: TeamMemberSkill["expiryStatus"];
  date: string | null;
}) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const d = fmtDate(date);
  if (status === "expired") {
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <XCircle className="h-3.5 w-3.5" />
        <span>{d}</span>
        <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">Expired</Badge>
      </span>
    );
  }
  if (status === "expiring_soon") {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>{d}</span>
        <Badge className="ml-1 text-[10px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-200">Expiring</Badge>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <CheckCircle className="h-3.5 w-3.5 text-success" />
      <span>{d}</span>
    </span>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────────────

function SkillKpiStrip({ skills }: { skills: TeamMemberSkill[] }) {
  const total = skills.length;
  const active = skills.filter((s) => s.isActive).length;
  const withCert = skills.filter((s) => s.isActive && s.certificationName).length;
  const attention = skills.filter(
    (s) => s.isActive && (s.expiryStatus === "expiring_soon" || s.expiryStatus === "expired"),
  ).length;
  const inactive = skills.filter((s) => !s.isActive).length;

  const stats = [
    { label: "Total", value: total },
    { label: "Active", value: active },
    { label: "With certification", value: withCert },
    { label: "Attention needed", value: attention },
    { label: "Inactive", value: inactive },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {stats.map((s) => (
        <Card key={s.label} className="shadow-none">
          <CardContent className="py-3 px-4 flex flex-col gap-1">
            <span className="text-helper text-muted-foreground">{s.label}</span>
            <span className="text-xl font-semibold text-foreground">{s.value}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Create Skill / License modal (global library creation only) ───────────

interface CreateSkillModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function CreateSkillModal({ open, onOpenChange }: CreateSkillModalProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [requiresCertification, setRequiresCertification] = useState(false);
  const [hasExpiryTracking, setHasExpiryTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<TeamSkillLibraryItem>("/api/team/skills", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          category: category.trim() || null,
          description: description.trim() || null,
          requiresCertification,
          hasExpiryTracking,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/skills"] });
      onOpenChange(false);
      resetForm();
    },
    onError: (e: Error) => setError(e.message),
  });

  function resetForm() {
    setName(""); setCategory(""); setDescription("");
    setRequiresCertification(false); setHasExpiryTracking(false);
    setError(null);
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}
      className="sm:max-w-md"
    >
      <ModalHeader>
        <ModalTitle>Create Skill / License</ModalTitle>
        <ModalDescription>
          Add a new entry to the company Skills & Licenses library.
        </ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-4">
        <FormField>
          <FormLabel>Skill / License name</FormLabel>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. G2 Gas Licence, Refrigerant Handling"
            autoFocus
          />
        </FormField>
        <FormField>
          <FormLabel srOnly>Category</FormLabel>
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category (optional)"
          />
        </FormField>
        <FormField>
          <FormLabel srOnly>Description</FormLabel>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
          />
        </FormField>
        <div className="space-y-3 pt-1 border-t">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="toggle-requires-cert" className="text-sm font-medium">
                Requires certification
              </Label>
              <p className="text-helper text-muted-foreground">
                Members must hold a certification to qualify.
              </p>
            </div>
            <Switch
              id="toggle-requires-cert"
              checked={requiresCertification}
              onCheckedChange={setRequiresCertification}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="toggle-expiry" className="text-sm font-medium">
                Has expiry tracking
              </Label>
              <p className="text-helper text-muted-foreground">
                Certifications for this skill have expiry dates.
              </p>
            </div>
            <Switch
              id="toggle-expiry"
              checked={hasExpiryTracking}
              onCheckedChange={setHasExpiryTracking}
            />
          </div>
        </div>
        {error && <FormErrorText>{error}</FormErrorText>}
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)}>Cancel</ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={() => createMutation.mutate()}
          disabled={!name.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? "Creating…" : "Create Skill"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}

// ── Assign Existing modal ─────────────────────────────────────────────────

interface AssignExistingModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  library: TeamSkillLibraryItem[];
  assignedSkillIds: string[];
}

function AssignExistingModal({
  open, onOpenChange, userId, library, assignedSkillIds,
}: AssignExistingModalProps) {
  const [skillId, setSkillId] = useState("");
  const [certName, setCertName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const available = library.filter((s) => s.isActive && !assignedSkillIds.includes(s.id));

  const assignMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/team/${userId}/skills`, {
        method: "POST",
        body: JSON.stringify({
          skillId,
          certificationName: certName.trim() || null,
          certificationExpiresAt: expiresAt || null,
          notes: notes.trim() || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}/skills`] });
      onOpenChange(false);
      resetForm();
    },
    onError: (e: Error) => setError(e.message),
  });

  function resetForm() {
    setSkillId(""); setCertName(""); setExpiresAt(""); setNotes("");
    setError(null);
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}
      className="sm:max-w-md"
    >
      <ModalHeader>
        <ModalTitle>Assign Existing Skill / License</ModalTitle>
        <ModalDescription>Select from the company library to assign to this member.</ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-3">
        <FormField>
          <FormLabel>Skill / License</FormLabel>
          <Select value={skillId} onValueChange={setSkillId}>
            <SelectTrigger>
              <SelectValue placeholder={available.length === 0 ? "No available skills" : "Select a skill or license"} />
            </SelectTrigger>
            <SelectContent>
              {available.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.category && <span className="text-muted-foreground ml-1">· {s.category}</span>}
                </SelectItem>
              ))}
              {available.length === 0 && (
                <div className="px-3 py-2 text-helper text-muted-foreground">
                  All active library entries are already assigned.
                </div>
              )}
            </SelectContent>
          </Select>
          <FormHelperText>Only active, unassigned entries are shown.</FormHelperText>
        </FormField>
        <FormRow className="grid-cols-2">
          <FormField>
            <FormLabel srOnly>Certification name / number</FormLabel>
            <Input
              value={certName}
              onChange={(e) => setCertName(e.target.value)}
              placeholder="Certification name / number"
            />
          </FormField>
          <FormField>
            <FormLabel srOnly>Expiry date</FormLabel>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </FormField>
        </FormRow>
        <FormField>
          <FormLabel srOnly>Notes</FormLabel>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
          />
        </FormField>
        {error && <FormErrorText>{error}</FormErrorText>}
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)}>Cancel</ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={() => assignMutation.mutate()}
          disabled={!skillId || assignMutation.isPending}
        >
          {assignMutation.isPending ? "Assigning…" : "Assign"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}

// ── Edit assignment modal ─────────────────────────────────────────────────

interface EditAssignmentModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  skill: TeamMemberSkill | null;
  userId: string;
}

function EditAssignmentModal({ open, onOpenChange, skill, userId }: EditAssignmentModalProps) {
  const [certName, setCertName] = useState(skill?.certificationName ?? "");
  const [expiresAt, setExpiresAt] = useState(
    skill?.certificationExpiresAt ? skill.certificationExpiresAt.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(skill?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/team/${userId}/skills/${skill!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          certificationName: certName.trim() || null,
          certificationExpiresAt: expiresAt || null,
          notes: notes.trim() || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/team/${userId}/skills`] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!skill) return null;

  return (
    <ModalShell open={open} onOpenChange={onOpenChange} className="sm:max-w-md">
      <ModalHeader>
        <ModalTitle>Edit Assignment</ModalTitle>
        <ModalDescription>{skill.name}</ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-3">
        <FormRow className="grid-cols-2">
          <FormField>
            <FormLabel srOnly>Certification name / number</FormLabel>
            <Input
              value={certName}
              onChange={(e) => setCertName(e.target.value)}
              placeholder="Certification name / number"
            />
          </FormField>
          <FormField>
            <FormLabel srOnly>Expiry date</FormLabel>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </FormField>
        </FormRow>
        <FormField>
          <FormLabel srOnly>Notes</FormLabel>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            rows={2}
          />
        </FormField>
        {error && <FormErrorText>{error}</FormErrorText>}
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)}>Cancel</ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? "Saving…" : "Save Changes"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}

// ── Skills & Licenses Library modal ──────────────────────────────────────

interface LibraryEditState {
  id: string;
  name: string;
  category: string;
  description: string;
  requiresCertification: boolean;
  hasExpiryTracking: boolean;
  isActive: boolean;
}

interface LibraryModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function LibraryModal({ open, onOpenChange }: LibraryModalProps) {
  const [editItem, setEditItem] = useState<LibraryEditState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamSkillLibraryItem | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: skills = [], isLoading } = useQuery<TeamSkillLibraryItem[]>({
    queryKey: ["/api/team/skills"],
    enabled: open,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<TeamSkillLibraryItem> & { id: string }) =>
      apiRequest(`/api/team/skills/${data.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name,
          category: data.category,
          description: data.description,
          requiresCertification: data.requiresCertification,
          hasExpiryTracking: data.hasExpiryTracking,
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/skills"] });
      setEditItem(null);
      setEditError(null);
    },
    onError: (e: Error) => setEditError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/team/skills/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/skills"] });
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  return (
    <>
      <ModalShell open={open} onOpenChange={onOpenChange} className="sm:max-w-2xl">
        <ModalHeader>
          <ModalTitle>Skills & Licenses Library</ModalTitle>
          <ModalDescription>
            Company-wide library. Items here can be assigned to any team member.
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="p-0">
          {isLoading ? (
            <div className="px-5 py-8 text-center text-helper text-muted-foreground">Loading…</div>
          ) : skills.length === 0 ? (
            <div className="px-5 py-8 text-center text-helper text-muted-foreground">
              No entries in the library yet. Use "Create Skill" to add the first one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Skill / License</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Assigned</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="flex gap-1 mt-0.5">
                        {s.requiresCertification && (
                          <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1">
                            Cert required
                          </span>
                        )}
                        {s.hasExpiryTracking && (
                          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1">
                            Expiry tracked
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.category ?? "—"}</TableCell>
                    <TableCell className="text-right">{s.memberCount}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(s.isActive ? "text-success border-success/30 bg-success/10" : "text-muted-foreground")}
                      >
                        {s.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() =>
                            setEditItem({
                              id: s.id,
                              name: s.name,
                              category: s.category ?? "",
                              description: s.description ?? "",
                              requiresCertification: s.requiresCertification,
                              hasExpiryTracking: s.hasExpiryTracking,
                              isActive: s.isActive,
                            })
                          }>
                            <Pencil className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              updateMutation.mutate({
                                id: s.id,
                                name: s.name,
                                category: s.category,
                                description: s.description,
                                requiresCertification: s.requiresCertification,
                                hasExpiryTracking: s.hasExpiryTracking,
                                isActive: !s.isActive,
                              })
                            }
                          >
                            {s.isActive
                              ? <><EyeOff className="h-4 w-4 mr-2" /> Deactivate</>
                              : <><Eye className="h-4 w-4 mr-2" /> Activate</>}
                          </DropdownMenuItem>
                          {s.memberCount === 0 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setDeleteTarget(s)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryAction onClick={() => onOpenChange(false)}>Close</ModalSecondaryAction>
        </ModalFooter>
      </ModalShell>

      {/* Edit library item */}
      {editItem && (
        <ModalShell
          open={!!editItem}
          onOpenChange={(v) => { if (!v) { setEditItem(null); setEditError(null); } }}
          className="sm:max-w-md"
        >
          <ModalHeader>
            <ModalTitle>Edit Skill / License</ModalTitle>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <FormField>
              <FormLabel>Skill / License name</FormLabel>
              <Input
                value={editItem.name}
                onChange={(e) => setEditItem({ ...editItem, name: e.target.value })}
              />
            </FormField>
            <FormField>
              <FormLabel srOnly>Category</FormLabel>
              <Input
                value={editItem.category}
                onChange={(e) => setEditItem({ ...editItem, category: e.target.value })}
                placeholder="Category (optional)"
              />
            </FormField>
            <FormField>
              <FormLabel srOnly>Description</FormLabel>
              <Textarea
                value={editItem.description}
                onChange={(e) => setEditItem({ ...editItem, description: e.target.value })}
                placeholder="Description (optional)"
                rows={2}
              />
            </FormField>
            <div className="space-y-3 pt-1 border-t">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="edit-requires-cert" className="text-sm font-medium">
                    Requires certification
                  </Label>
                </div>
                <Switch
                  id="edit-requires-cert"
                  checked={editItem.requiresCertification}
                  onCheckedChange={(v) => setEditItem({ ...editItem, requiresCertification: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="edit-expiry" className="text-sm font-medium">
                    Has expiry tracking
                  </Label>
                </div>
                <Switch
                  id="edit-expiry"
                  checked={editItem.hasExpiryTracking}
                  onCheckedChange={(v) => setEditItem({ ...editItem, hasExpiryTracking: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="edit-active" className="text-sm font-medium">
                    Active
                  </Label>
                  <p className="text-helper text-muted-foreground">
                    Inactive entries cannot be assigned to new members.
                  </p>
                </div>
                <Switch
                  id="edit-active"
                  checked={editItem.isActive}
                  onCheckedChange={(v) => setEditItem({ ...editItem, isActive: v })}
                />
              </div>
            </div>
            {editError && <FormErrorText>{editError}</FormErrorText>}
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryAction onClick={() => { setEditItem(null); setEditError(null); }}>
              Cancel
            </ModalSecondaryAction>
            <ModalPrimaryAction
              onClick={() =>
                updateMutation.mutate({
                  id: editItem.id,
                  name: editItem.name.trim(),
                  category: editItem.category.trim() || null,
                  description: editItem.description.trim() || null,
                  requiresCertification: editItem.requiresCertification,
                  hasExpiryTracking: editItem.hasExpiryTracking,
                  isActive: editItem.isActive,
                })
              }
              disabled={!editItem.name.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </ModalPrimaryAction>
          </ModalFooter>
        </ModalShell>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) { setDeleteTarget(null); setDeleteError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the entry from the library. This action cannot be undone.
              {deleteError && <span className="block mt-2 text-destructive">{deleteError}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────

interface Props {
  selectedMemberId: string;
}

export function MemberSkillsTab({ selectedMemberId }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [editTarget, setEditTarget] = useState<TeamMemberSkill | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberSkill | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const { data: memberSkills = [], isLoading: skillsLoading } = useQuery<TeamMemberSkill[]>({
    queryKey: [`/api/team/${selectedMemberId}/skills`],
  });

  const { data: library = [] } = useQuery<TeamSkillLibraryItem[]>({
    queryKey: ["/api/team/skills"],
  });

  const deactivateMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest(`/api/team/${selectedMemberId}/skills/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [`/api/team/${selectedMemberId}/skills`] }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/team/${selectedMemberId}/skills/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/team/${selectedMemberId}/skills`] });
      setRemoveTarget(null);
      setRemoveError(null);
    },
    onError: (e: Error) => setRemoveError(e.message),
  });

  const assignedSkillIds = memberSkills.map((s) => s.skillId);
  const isEmpty = !skillsLoading && memberSkills.length === 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Skills & Licenses</h3>
          <p className="text-helper text-muted-foreground mt-0.5">
            Manage skills and licenses for this team member. Used for job assignment, compliance tracking, and workforce planning.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setShowLibrary(true)}>
            <BookOpen className="h-4 w-4 mr-1.5" /> Manage Library
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAssign(true)}>
            Assign Existing
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Create Skill
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      {!isEmpty && <SkillKpiStrip skills={memberSkills} />}

      {/* Table */}
      {skillsLoading ? (
        <Card className="shadow-none">
          <CardContent className="py-8 text-center text-helper text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      ) : isEmpty ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <Wrench className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">No skills or licenses assigned</p>
              <p className="text-helper text-muted-foreground mt-1 max-w-xs">
                Track trade skills, licences, and certifications. Create a new entry or assign one from the company library.
              </p>
            </div>
            <div className="flex gap-2 mt-1">
              <Button variant="outline" size="sm" onClick={() => setShowAssign(true)}>
                Assign Existing
              </Button>
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Create Skill
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-none overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill / License</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Certification</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberSkills.map((s) => (
                <TableRow key={s.id} className={cn(!s.isActive && "opacity-60")}>
                  <TableCell>
                    <div className="font-medium text-foreground">{s.name}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.category ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.certificationName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <ExpiryBadge status={s.expiryStatus} date={s.certificationExpiresAt} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fmtDate(s.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        s.isActive
                          ? "text-success border-success/30 bg-success/10"
                          : "text-muted-foreground",
                      )}
                    >
                      {s.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditTarget(s)}>
                          <Pencil className="h-4 w-4 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            deactivateMutation.mutate({ id: s.id, isActive: !s.isActive })
                          }
                        >
                          {s.isActive
                            ? <><EyeOff className="h-4 w-4 mr-2" /> Deactivate</>
                            : <><Eye className="h-4 w-4 mr-2" /> Activate</>}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setRemoveTarget(s)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Remove from member
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Modals */}
      <CreateSkillModal open={showCreate} onOpenChange={setShowCreate} />
      <AssignExistingModal
        open={showAssign}
        onOpenChange={setShowAssign}
        userId={selectedMemberId}
        library={library}
        assignedSkillIds={assignedSkillIds}
      />
      <EditAssignmentModal
        open={!!editTarget}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        skill={editTarget}
        userId={selectedMemberId}
      />
      <LibraryModal open={showLibrary} onOpenChange={setShowLibrary} />

      {/* Remove confirmation */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(v) => { if (!v) { setRemoveTarget(null); setRemoveError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{removeTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the assignment from this member. The entry remains in the company library.
              {removeError && <span className="block mt-2 text-destructive">{removeError}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
