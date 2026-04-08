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
import { useLocationSearch, useLocationById, type LocationResult } from "@/hooks/useLocationSearch";

type LocationItem = LocationResult;
interface TechMember { id: string; fullName: string; }

export function CreateJobPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Read locationId from query params
  const prefillLocationId = new URLSearchParams(window.location.search).get("locationId") || "";

  // Resolve prefilled location from server
  const { data: resolvedLocation } = useLocationById(prefillLocationId || null);

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Location search — shared hook with canonical endpoint + snake_case mapping
  const { data: locations } = useLocationSearch(locationSearch);

  // Team members for assignment
  const { data: techMembers } = useQuery<TechMember[]>({
    queryKey: ["/api/team/technicians"],
    queryFn: async () => {
      const resp = await apiRequest<any>("/api/team/technicians");
      const list = Array.isArray(resp) ? resp : (resp?.data ?? resp?.schedulable ?? []);
      return list.map((t: any) => ({ id: t.id, fullName: t.fullName || t.displayName || t.email || "Tech" }));
    },
  });

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
        assignedTechnicianId: techId || null,
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
      // Navigate to visit detail if visitId returned, otherwise today view
      const targetVisitId = result?.visitId;
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
          <button onClick={() => setLocation("/tech/today")} className="p-1 -ml-1 rounded-lg hover:bg-white/10">
            <ArrowLeft className="h-4 w-4 text-white" />
          </button>
          <h1 className="text-base font-bold text-white">Create Job</h1>
        </div>
      </div>

      <div className="px-3 py-3 pb-28 space-y-3">
        {success && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <p className="text-xs font-medium text-emerald-700">{success}</p>
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Location */}
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Location *</label>
          {selectedLocation && locationId ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 flex items-center justify-between">
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
                <input value={locationSearch} onChange={e => setLocationSearch(e.target.value)}
                  placeholder="Search locations..." className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg" />
              </div>
              {locationSearch.length >= 2 && (
                <div className="mt-1 border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
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
        </div>

        {/* Summary */}
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Summary *</label>
          <input value={summary} onChange={e => setSummary(e.target.value)}
            placeholder="Brief job summary..." className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg" />
        </div>

        {/* Assigned Technician */}
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Assigned To</label>
          <select value={techId} onChange={e => setTechId(e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white">
            {(techMembers ?? []).map(t => (
              <option key={t.id} value={t.id}>{t.fullName}{t.id === user?.id ? " (me)" : ""}</option>
            ))}
          </select>
        </div>

        {/* Scheduling Mode */}
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Scheduling</label>
          <div className="flex gap-1.5">
            <button onClick={() => setScheduleMode("later")}
              className={`flex-1 h-9 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors ${
                scheduleMode === "later" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"
              }`}>
              <Clock className="h-3 w-3" />Schedule Later
            </button>
            <button onClick={() => setScheduleMode("now")}
              className={`flex-1 h-9 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors ${
                scheduleMode === "now" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"
              }`}>
              <Calendar className="h-3 w-3" />Schedule Now
            </button>
          </div>
        </div>

        {/* Schedule Now inputs */}
        {scheduleMode === "now" && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 bg-slate-50/50">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-slate-400 mb-0.5 block">Date</label>
                <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)}
                  className="w-full h-8 px-2 text-xs border border-slate-200 rounded-lg" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-slate-400 mb-0.5 block">Start Time</label>
                <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                  className="w-full h-8 px-2 text-xs border border-slate-200 rounded-lg" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-400 mb-0.5 block">Duration (minutes)</label>
              <input type="number" value={schedDuration} onChange={e => setSchedDuration(e.target.value)}
                min="15" step="15" className="w-full h-8 px-2 text-xs border border-slate-200 rounded-lg" />
            </div>
          </div>
        )}

        {/* Description */}
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Additional details..." className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none h-20" />
        </div>

        {/* Submit */}
        <button onClick={handleSubmit} disabled={!canSubmit}
          className="w-full h-11 rounded-xl bg-emerald-600 text-white text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98]">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {scheduleMode === "now" ? "Create & Schedule" : "Create Job"}
        </button>
      </div>
    </MobileShell>
  );
}
