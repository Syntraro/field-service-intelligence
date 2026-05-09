/**
 * Technician PWA — Create Job Page.
 * Supports: location, summary, description,
 * technician assignment, schedule now / schedule later.
 * Calls POST /api/tech/jobs → canonical storage.createJob + schedulingRepository.
 *
 * Location picker: search existing locations or create new client inline.
 * Supports prefill via query param: ?locationId=X (data fetched from server).
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, MapPin, Clock, Calendar, Check, UserPlus } from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
// 2026-05-04 Phase 2 PR 3: tech-only sibling hooks. Search +
// resolve-by-id both go through the tech-safe location endpoints.
import {
  useTechLocationSearch,
  useTechLocationById,
  type LocationResult,
} from "../hooks/useTechLocationSearch";
// 2026-05-04 form-canonicalization: migrate raw <input>/<textarea>
// to canonical primitives. Compact schedule inputs (h-8 text-xs) keep
// their layout via className overrides. The native <select> at line
// ~217 is INTENTIONALLY left as raw HTML — Radix Select migration is
// a separate, more invasive concern (dropdown positioning + mobile
// portal integration on a tech-app surface).
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { getMemberDisplayName } from "@/lib/displayName";

type LocationItem = LocationResult;

export function CreateJobPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Read locationId from query params
  const prefillLocationId = new URLSearchParams(window.location.search).get("locationId") || "";

  // Resolve prefilled location from server
  const { data: resolvedLocation } = useTechLocationById(prefillLocationId || null);

  // Form state
  const [locationId, setLocationId] = useState(prefillLocationId);
  const [locationLabel, setLocationLabel] = useState<LocationItem | null>(null);
  const [locationSearch, setLocationSearch] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [techId, setTechId] = useState(user?.id ?? "");
  const [scheduleMode, setScheduleMode] = useState<"later" | "now">("later");
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [schedDuration, setSchedDuration] = useState("60");

  // Default date/time when switching to "Schedule Now"
  const handleScheduleMode = (mode: "later" | "now") => {
    setScheduleMode(mode);
    if (mode === "now") {
      if (!schedDate) {
        const now = new Date();
        setSchedDate(now.toISOString().split("T")[0]);
      }
      if (!schedTime) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        setSchedTime(`${hh}:${mm}`);
      }
    }
  };
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Location search — tech-safe hook (tech endpoint + assignment scoping).
  const { data: locations } = useTechLocationSearch(locationSearch);

  // Team members for assignment — canonical directory hook
  const { teamMembers: techMembers } = useTechniciansDirectory();

  // Resolve selected location display from search results or pre-fill
  const selectedLocation = locationLabel ?? resolvedLocation ?? (locations ?? []).find(l => l.id === locationId) ?? null;

  const handleSubmit = async () => {
    if (!locationId || !summary.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        locationId,
        summary: summary.trim(),
        description: description.trim() || null,
        assignedTechnicianIds: techId ? [techId] : undefined,
      };

      // Schedule Now: build ISO start/end from date + time
      if (scheduleMode === "now" && schedDate && schedTime) {
        const start = new Date(`${schedDate}T${schedTime}:00`);
        const dur = parseInt(schedDuration) || 60;
        const end = new Date(start.getTime() + dur * 60_000);
        payload.scheduledStart = start.toISOString();
        payload.scheduledEnd = end.toISOString();
        payload.durationMinutes = dur;
      }

      const result = await apiRequest<any>("/api/tech/jobs", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Local invalidation: ensure TodayPage / visit detail show fresh data
      // immediately on navigation, without waiting for the SSE round-trip.
      // The backend POST /api/tech/jobs already emits a dispatch event, so other
      // sessions will receive it via realtime; this is for the initiating user.
      queryClient.invalidateQueries({ queryKey: ["/api/tech/visits/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tech/visits"] });

      setSuccess("Job created");
      // 2026-04-10: Only navigate to visit detail if the visit is SCHEDULED
      // (has a time slot). Unscheduled placeholder visits are not actionable —
      // navigating there shows an unusable detail page. Go to Today instead.
      const targetVisitId = scheduleMode === "now" ? result?.visitId : undefined;
      setTimeout(() => {
        setLocation(targetVisitId ? `/tech/visit/${targetVisitId}` : "/tech/today");
      }, 600);
    } catch (err: any) {
      setError(err?.message || "Failed to create job");
    } finally {
      setSubmitting(false);
    }
  };

  const clearLocation = () => {
    setLocationId("");
    setLocationLabel(null);
    setLocationSearch("");
  };

  const selectLocation = (loc: LocationItem) => {
    setLocationId(loc.id);
    setLocationLabel(loc);
    setLocationSearch("");
  };

  const canSubmit = locationId && summary.trim() && !submitting;

  return (
    <MobileShell showNav>
      <div className="bg-[#0f1a2e] px-3 pt-2 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLocation("/tech/today")}
            aria-label="Back"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/20"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <h1 className="text-base font-bold text-white">Create Job</h1>
        </div>
      </div>

      <div className="px-3 py-3 pb-28 space-y-3">
        {success && (
          <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <p className="text-xs font-medium text-emerald-700">{success}</p>
          </div>
        )}
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Location */}
        <FormField>
          <FormLabel>Location *</FormLabel>
          {selectedLocation && locationId ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">{selectedLocation.companyName}</p>
                <p className="text-xs text-slate-400">{[selectedLocation.address, selectedLocation.city].filter(Boolean).join(", ")}</p>
              </div>
              <button onClick={clearLocation}
                className="text-xs text-slate-400 hover:text-red-500">Change</button>
            </div>
          ) : (
            <>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input value={locationSearch} onChange={e => setLocationSearch(e.target.value)}
                  placeholder="Search locations..." className="pl-9" />
              </div>
              {locationSearch.length >= 2 && (
                <div className="mt-1 border border-slate-200 rounded-md overflow-hidden max-h-48 overflow-y-auto">
                  {(locations ?? []).map(loc => (
                    <button key={loc.id} onClick={() => selectLocation(loc)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                      <p className="text-sm font-medium text-slate-800">{loc.companyName}</p>
                      <p className="text-xs text-slate-400">{[loc.address, loc.city].filter(Boolean).join(", ")}</p>
                    </button>
                  ))}
                  {/* Create new client option */}
                  <button onClick={() => setLocation("/tech/create-client?from=create-job")}
                    className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-t border-slate-200 flex items-center gap-2">
                    <UserPlus className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span className="text-sm font-medium text-blue-600">Create new client</span>
                  </button>
                </div>
              )}
            </>
          )}
        </FormField>

        {/* Summary */}
        <FormField>
          <FormLabel>Summary *</FormLabel>
          <Input value={summary} onChange={e => setSummary(e.target.value)}
            placeholder="Brief job summary..." />
        </FormField>

        {/* Assigned Technician */}
        <FormField>
          <FormLabel>Assigned To</FormLabel>
          <select value={techId} onChange={e => setTechId(e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md bg-white">
            {techMembers.map(t => (
              <option key={t.id} value={t.id}>{getMemberDisplayName(t)}{t.id === user?.id ? " (me)" : ""}</option>
            ))}
          </select>
        </FormField>

        {/* Scheduling Mode */}
        <FormField>
          <FormLabel>Scheduling</FormLabel>
          <div className="flex gap-1.5">
            <button onClick={() => handleScheduleMode("later")}
              className={`flex-1 h-9 rounded-md text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors ${
                scheduleMode === "later" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"
              }`}>
              <Clock className="h-3 w-3" />Schedule Later
            </button>
            <button onClick={() => handleScheduleMode("now")}
              className={`flex-1 h-9 rounded-md text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors ${
                scheduleMode === "now" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"
              }`}>
              <Calendar className="h-3 w-3" />Schedule Now
            </button>
          </div>
        </FormField>

        {/* Schedule Now inputs */}
        {scheduleMode === "now" && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3 bg-slate-50/50">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-slate-400 mb-0.5 block">Date</label>
                <CanonicalDatePicker
                  value={schedDate}
                  onChange={(next) => setSchedDate(next ?? "")}
                  className="w-full h-8 text-xs"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-slate-400 mb-0.5 block">Start Time</label>
                <Input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                  className="h-8 px-2 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-400 mb-0.5 block">Duration (minutes)</label>
              <Input type="number" value={schedDuration} onChange={e => setSchedDuration(e.target.value)}
                min="15" step="15" className="h-8 px-2 text-xs" />
            </div>
          </div>
        )}

        {/* Description */}
        <FormField>
          <FormLabel>Description</FormLabel>
          <Textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Additional details..." className="resize-none h-20" />
        </FormField>

        {/* Submit */}
        <button onClick={handleSubmit} disabled={!canSubmit}
          className="w-full h-11 rounded-md bg-emerald-600 text-white text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98]">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {scheduleMode === "now" ? "Create & Schedule" : "Create Job"}
        </button>
      </div>
    </MobileShell>
  );
}
