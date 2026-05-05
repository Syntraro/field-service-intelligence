/**
 * Tech App — Create Lead Page.
 * Uses canonical POST /api/leads.
 * Prefill via query params: ?locationId=X&visitId=Y (IDs only — data fetched from server).
 */
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Check, MapPin, Briefcase } from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
// 2026-05-04 Phase 2 PR 3: tech-only sibling hook so the picker no
// longer reads from the office client-search surface.
import { useTechLocationSearch, type LocationResult } from "../hooks/useTechLocationSearch";
// 2026-05-04 form-canonicalization: tech-app raw <input>/<textarea>
// migrated to canonical primitives. Layout (h-9 px-3) preserved by
// the primitive defaults; raw `text-sm border-slate-200` styling
// replaced by canonical `text-input` typography.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function getQueryParam(key: string): string {
  return new URLSearchParams(window.location.search).get(key) || "";
}

export function CreateLeadPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Parse IDs only from query params
  const prefillLocationId = getQueryParam("locationId");
  const prefillVisitId = getQueryParam("visitId");
  const hasPrefill = !!prefillLocationId;

  // 2026-05-04 Phase 2 PR 2: prefill via the tech-safe location read.
  // Same shape (companyName / address / city) as the office endpoint
  // for the fields this page renders; access is gated by the new
  // assertCanAccessTechLocation helper.
  const { data: prefillLocation } = useQuery<{ companyName?: string; address?: string; city?: string }>({
    queryKey: ["/api/tech/locations", prefillLocationId],
    queryFn: () => apiRequest(`/api/tech/locations/${prefillLocationId}`),
    enabled: !!prefillLocationId,
  });

  // Fetch visit data if prefilled (for job context display)
  const { data: prefillVisit } = useQuery<{ job?: { summary?: string; jobNumber?: number }; visit?: { scheduledStart?: string } }>({
    queryKey: ["/api/tech/visits", prefillVisitId],
    queryFn: () => apiRequest(`/api/tech/visits/${prefillVisitId}`),
    enabled: !!prefillVisitId,
  });

  const prefillName = prefillLocation?.companyName || "";
  const prefillJobSummary = prefillVisit?.job?.summary || "";
  const prefillJobId = prefillVisit?.visit ? (prefillVisit as any).visit?.jobId : "";

  // Source ref — deterministic from IDs
  const sourceRefType = prefillVisitId ? "visit" : null;
  const sourceRefId = prefillVisitId || null;

  // Form state
  const [locationId, setLocationId] = useState(prefillLocationId);
  const [locationSearch, setLocationSearch] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Auto-focus description when prefilled
  useEffect(() => {
    if (hasPrefill && descRef.current) {
      setTimeout(() => descRef.current?.focus(), 200);
    }
  }, [hasPrefill]);

  const { data: locations } = useTechLocationSearch(locationSearch);

  // Derive display label
  const locationLabel = locationId === prefillLocationId ? prefillName : "";

  const handleSubmit = async () => {
    if (!locationId || !title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          locationId,
          title: title.trim(),
          description: description.trim() || null,
          sourceType: "tech",
          sourceRefType,
          sourceRefId,
          originTechnicianId: user?.id || null,
          priority: "medium",
        }),
      });
      setSuccess("Lead submitted");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setTimeout(() => setLocation("/tech/today"), 800);
    } catch (err: any) {
      setError(err?.message || "Failed to create lead");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = locationId && title.trim() && !submitting;

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
          <h1 className="text-base font-bold text-white">Create Lead</h1>
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

        {/* Context indicator when prefilled */}
        {hasPrefill && prefillName && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1">
              <MapPin className="h-3 w-3" />Creating lead for {prefillName}
            </p>
            {prefillJobSummary && (
              <p className="text-[10px] text-amber-600 flex items-center gap-1">
                <Briefcase className="h-2.5 w-2.5" />{prefillJobSummary}
              </p>
            )}
          </div>
        )}

        {/* Location — locked if prefilled */}
        <div>
          <Label className="block mb-1">Client / Location *</Label>
          {locationId ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">{locationLabel || "Loading..."}</p>
              {!hasPrefill && (
                <button onClick={() => { setLocationId(""); setLocationSearch(""); }}
                  className="text-xs text-slate-400 hover:text-red-500">Change</button>
              )}
            </div>
          ) : (
            <>
              <Input value={locationSearch} onChange={e => setLocationSearch(e.target.value)}
                placeholder="Search locations..." />
              {(locationSearch?.length ?? 0) >= 2 && (locations ?? []).length > 0 && (
                <div className="mt-1 border border-slate-200 rounded-md overflow-hidden max-h-40 overflow-y-auto">
                  {(locations ?? []).map(loc => (
                    <button key={loc.id} onClick={() => { setLocationId(loc.id); setLocationSearch(""); }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                      <p className="text-sm font-medium text-slate-800">{loc.companyName}</p>
                      <p className="text-xs text-slate-400">{[loc.address, loc.city].filter(Boolean).join(", ")}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Title */}
        <div>
          <Label className="block mb-1">What did you find? *</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Compressor needs replacement, water heater leaking..." />
        </div>

        {/* Description */}
        <div>
          <Label className="block mb-1">Details</Label>
          <Textarea ref={descRef} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Additional details for the office..."
            className="resize-none h-24" />
        </div>

        {/* Submit */}
        <button onClick={handleSubmit} disabled={!canSubmit}
          className="w-full h-11 rounded-md bg-emerald-600 text-white text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98]">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Submit Lead
        </button>
      </div>
    </MobileShell>
  );
}
