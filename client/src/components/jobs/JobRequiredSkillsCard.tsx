/**
 * JobRequiredSkillsCard — displays and manages skill requirements for a job.
 *
 * Used in the job right rail (JobActionsRail). Managers can add, edit, and
 * remove skill requirements. Skill requirements guide dispatchers but never
 * block manual assignment.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { jobKeys } from "@/lib/queryKeys";
import { invalidateJobRequiredSkills } from "@/lib/queryInvalidation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FormField, FormLabel, FormErrorText } from "@/components/ui/form-field";
import { Label } from "@/components/ui/label";
import { Wrench, Plus, MoreHorizontal, Trash2, Pencil, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamSkillLibraryItem } from "@/components/team-hub/types";
import type { SkillLevel } from "@shared/schema";
import { SKILL_LEVELS } from "@shared/schema";

const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  basic: "Basic",
  intermediate: "Intermediate",
  advanced: "Advanced",
  certified: "Certified",
};

// ── Server-facing shapes ──────────────────────────────────────────────────

interface JobRequiredSkillRow {
  id: string;
  jobId: string;
  skillId: string;
  skillName: string;
  skillCategory: string | null;
  minimumLevel: SkillLevel | null;
  required: boolean;
  createdAt: string;
}

// ── Min level badge ───────────────────────────────────────────────────────

const LEVEL_TONE: Record<SkillLevel, string> = {
  basic: "bg-slate-100 text-slate-700",
  intermediate: "bg-blue-50 text-blue-700",
  advanced: "bg-purple-50 text-purple-700",
  certified: "bg-green-50 text-green-700",
};

// ── Add/Edit requirement modal ─────────────────────────────────────────────

interface EditRequirementModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  existing: JobRequiredSkillRow | null;
  library: TeamSkillLibraryItem[];
  assignedSkillIds: string[];
}

function EditRequirementModal({
  open, onOpenChange, jobId, existing, library, assignedSkillIds,
}: EditRequirementModalProps) {
  const isNew = existing === null;
  const [skillId, setSkillId] = useState(existing?.skillId ?? "");
  const [minimumLevel, setMinimumLevel] = useState<SkillLevel | "any">(existing?.minimumLevel ?? "any");
  const [required, setRequired] = useState(existing?.required ?? true);
  const [error, setError] = useState<string | null>(null);

  const available = library.filter(
    (s) => s.isActive && (isNew ? !assignedSkillIds.includes(s.id) : s.id === existing?.skillId),
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        skillId: isNew ? skillId : undefined,
        minimumLevel: minimumLevel === "any" ? null : minimumLevel,
        required,
      };
      if (isNew) {
        return apiRequest(`/api/jobs/${jobId}/required-skills`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      return apiRequest(`/api/jobs/${jobId}/required-skills/${existing!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ minimumLevel: payload.minimumLevel, required }),
      });
    },
    onSuccess: () => {
      invalidateJobRequiredSkills(queryClient, jobId);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  function reset() {
    setSkillId(existing?.skillId ?? "");
    setMinimumLevel(existing?.minimumLevel ?? "any");
    setRequired(existing?.required ?? true);
    setError(null);
  }

  return (
    <ModalShell open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }} className="sm:max-w-sm">
      <ModalHeader>
        <ModalTitle>{isNew ? "Add Required Skill" : "Edit Requirement"}</ModalTitle>
        <ModalDescription>
          Skill requirements guide dispatchers but never block manual assignment.
        </ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-3">
        {isNew && (
          <FormField>
            <FormLabel>Skill</FormLabel>
            <Select value={skillId} onValueChange={setSkillId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a skill" />
              </SelectTrigger>
              <SelectContent>
                {available.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
                {available.length === 0 && (
                  <div className="px-3 py-2 text-helper text-muted-foreground">
                    All active skills are already required.
                  </div>
                )}
              </SelectContent>
            </Select>
          </FormField>
        )}
        {!isNew && (
          <div className="text-sm font-medium text-foreground">{existing?.skillName}</div>
        )}
        <FormField>
          <FormLabel>Minimum level</FormLabel>
          <Select value={minimumLevel} onValueChange={(v) => setMinimumLevel(v as SkillLevel | "any")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any level</SelectItem>
              {SKILL_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>{SKILL_LEVEL_LABELS[l]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="req-required"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <Label htmlFor="req-required">Hard requirement (warn if unmet)</Label>
        </div>
        {error && <FormErrorText>{error}</FormErrorText>}
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)}>Cancel</ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={() => saveMutation.mutate()}
          disabled={(isNew && !skillId) || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving…" : isNew ? "Add Requirement" : "Save"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────

interface JobRequiredSkillsCardProps {
  jobId: string;
}

export function JobRequiredSkillsCard({ jobId }: JobRequiredSkillsCardProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<JobRequiredSkillRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<JobRequiredSkillRow | null>(null);

  const { data: requirements = [], isLoading } = useQuery<JobRequiredSkillRow[]>({
    queryKey: jobKeys.requiredSkills(jobId),
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/required-skills`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: library = [] } = useQuery<TeamSkillLibraryItem[]>({
    queryKey: ["/api/team/skills"],
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/jobs/${jobId}/required-skills/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateJobRequiredSkills(queryClient, jobId);
      setRemoveTarget(null);
    },
  });

  const assignedSkillIds = requirements.map((r) => r.skillId);

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 mt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <Wrench className="h-3 w-3" /> Required Skills
          </span>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>

        {isLoading ? (
          <span className="text-xs text-slate-400">Loading…</span>
        ) : requirements.length === 0 ? (
          <span className="text-xs text-slate-400 italic">No skill requirements set</span>
        ) : (
          <div className="space-y-1.5">
            {requirements.map((req) => (
              <div key={req.id} className="flex items-center gap-1.5 justify-between group">
                <div className="flex items-center gap-1.5 min-w-0">
                  {req.required && (
                    <ShieldAlert className="h-3 w-3 text-amber-500 shrink-0" aria-label="Hard requirement" />
                  )}
                  <span className="text-xs text-slate-700 truncate">{req.skillName}</span>
                  {req.minimumLevel && (
                    <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 shrink-0", LEVEL_TONE[req.minimumLevel])}>
                      {SKILL_LEVEL_LABELS[req.minimumLevel]}+
                    </span>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100">
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditTarget(req)}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => setRemoveTarget(req)}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add modal */}
      <EditRequirementModal
        open={showAdd}
        onOpenChange={setShowAdd}
        jobId={jobId}
        existing={null}
        library={library}
        assignedSkillIds={assignedSkillIds}
      />

      {/* Edit modal */}
      {editTarget && (
        <EditRequirementModal
          open={!!editTarget}
          onOpenChange={(v) => { if (!v) setEditTarget(null); }}
          jobId={jobId}
          existing={editTarget}
          library={library}
          assignedSkillIds={assignedSkillIds}
        />
      )}

      {/* Remove confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(v) => { if (!v) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{removeTarget?.skillName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the skill requirement from this job. Existing assignments are not affected.
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
    </>
  );
}
