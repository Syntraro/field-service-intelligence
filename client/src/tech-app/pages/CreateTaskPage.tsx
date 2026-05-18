/**
 * Technician PWA — Create Task Page.
 *
 * Creates a GENERAL task assigned to the caller.
 * Self-assignment enforced server-side.
 *
 * Calls POST /api/tech/tasks (requireSchedulable guard, self-assignment enforced).
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, CheckSquare, Clock } from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { Input } from "@/components/ui/input";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { apiRequest } from "@/lib/queryClient";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { TECH_TASKS_QUERY_KEY } from "../hooks/useTechTasks";

function nowDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function CreateTaskPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleToggleSchedule = () => {
    if (!scheduled) {
      setSchedDate(nowDate());
      setSchedTime(nowTime());
    } else {
      setSchedDate("");
      setSchedTime("");
    }
    setScheduled(!scheduled);
  };

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        type: "GENERAL",
        title: title.trim(),
      };
      if (notes.trim()) payload.notes = notes.trim();

      if (scheduled && schedDate && schedTime) {
        const start = new Date(`${schedDate}T${schedTime}:00`);
        const end = new Date(start.getTime() + 60 * 60_000);
        payload.scheduledStartAt = start.toISOString();
        payload.scheduledEndAt = end.toISOString();
      }

      await apiRequest("/api/tech/tasks", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: TECH_TASKS_QUERY_KEY });

      setSuccess("Task created!");
      setTimeout(() => setLocation("/tech/today"), 800);
    } catch (err: any) {
      setError(err?.message || "Failed to create task.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileShell>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white">
        <button
          onClick={() => setLocation("/tech/today")}
          aria-label="Back"
          className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <h1 className="text-base font-bold text-slate-900">Create Task</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!success && (
          <div className="space-y-4">
            <FormField>
              <FormLabel>Title *</FormLabel>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Follow up with client"
                className="w-full h-10 px-3 text-sm border border-slate-200 rounded-md"
                autoFocus
              />
            </FormField>

            <FormField>
              <FormLabel>Notes</FormLabel>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any details or reminders..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md resize-none"
              />
            </FormField>

            <div>
              <button
                type="button"
                onClick={handleToggleSchedule}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md border transition-colors ${
                  scheduled ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"
                }`}
              >
                <Clock className={`h-4 w-4 ${scheduled ? "text-emerald-600" : "text-slate-400"}`} />
                <span className={`text-sm font-medium ${scheduled ? "text-emerald-700" : "text-slate-600"}`}>
                  {scheduled ? "Scheduled" : "Unscheduled"}
                </span>
                <span className="text-xs text-slate-400 ml-auto">
                  {scheduled ? "tap to remove" : "tap to schedule"}
                </span>
              </button>
              {scheduled && (
                <div className="flex gap-2 mt-2">
                  <div className="flex-1">
                    <CanonicalDatePicker
                      value={schedDate}
                      onChange={(next) => setSchedDate(next ?? "")}
                      className="w-full h-10 text-sm"
                    />
                  </div>
                  {/* 2026-05-04 form-canonicalization: migrated to <Input>.
                      Layout (w-28 h-10) preserved via className override —
                      the surrounding date picker uses h-10 not the default
                      h-9, so we keep the height match. */}
                  <Input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)}
                    className="w-28 h-10" />
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400 italic">Task will be assigned to you.</p>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!title.trim() || submitting}
              className="w-full h-11 rounded-md bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 active:bg-emerald-700 transition-colors"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Creating..." : "Create Task"}
            </button>
          </div>
        )}

        {success && (
          <div className="text-center py-12">
            <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <CheckSquare className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="text-sm font-semibold text-emerald-700">{success}</p>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
