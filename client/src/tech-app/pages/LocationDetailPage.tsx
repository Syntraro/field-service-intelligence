/**
 * Tech App — Location Detail Page.
 * Lightweight client/location reference for technicians.
 * Uses canonical endpoints. Navigation via query params (no sessionStorage).
 */
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Phone, Mail, Wrench, Briefcase, FileText, ChevronRight, Loader2, User, Calendar, Navigation } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { MobileShell } from "../components/MobileShell";
import { apiRequest } from "@/lib/queryClient";
import { toTelHref, toMapsHref } from "../utils/externalLinks";

interface LocationData {
  id: string;
  companyName: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

interface EquipmentItem {
  id: string;
  name: string;
  equipmentType?: string | null;
  manufacturer?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
}

interface RecentJob {
  id: string;
  jobNumber: number;
  summary: string;
  status: string;
  scheduledStart?: string | null;
  jobType?: string | null;
}

const TABS = ["Overview", "Equipment", "History"] as const;
type Tab = typeof TABS[number];

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString([], { month: "short", day: "numeric" });
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  invoiced: "bg-purple-100 text-purple-700",
};

export function LocationDetailPage() {
  const params = useParams<{ id: string }>();
  const locationId = params.id;
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  // Back navigation: prefer referrer history so the tech returns to the page
  // they came from (Search, Today, Create Job picker, etc.). Falls back to
  // /tech/today when the page was opened from a cold URL, matching the
  // app's canonical landing destination.
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/tech/today");
    }
  };

  const { data: loc, isLoading, isError } = useQuery<LocationData>({
    queryKey: ["/api/clients", locationId],
    queryFn: () => apiRequest(`/api/clients/${locationId}`),
    enabled: !!locationId,
  });

  const { data: equipment = [] } = useQuery<EquipmentItem[]>({
    queryKey: ["/api/clients", locationId, "equipment"],
    queryFn: () => apiRequest(`/api/clients/${locationId}/equipment`),
    enabled: !!locationId && activeTab === "Equipment",
  });

  // Recent jobs for this location
  const { data: recentJobsRaw } = useQuery<{ data: RecentJob[] }>({
    queryKey: ["/api/jobs", "location", locationId],
    queryFn: () => apiRequest(`/api/jobs?locationId=${locationId}&limit=10&sortBy=createdAt&sortOrder=desc`),
    enabled: !!locationId && activeTab === "History",
  });
  const recentJobs = recentJobsRaw?.data ?? [];

  if (isLoading) return (
    <MobileShell showNav>
      <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
    </MobileShell>
  );

  if (isError || !loc) return (
    <MobileShell showNav>
      <div className="text-center py-16 text-slate-400">
        <p className="text-sm">Location not found</p>
        <button onClick={handleBack} className="mt-2 min-h-[44px] px-4 text-xs text-emerald-600">Back</button>
      </div>
    </MobileShell>
  );

  const addressLine = [loc.address, loc.city, loc.province, loc.postalCode].filter(Boolean).join(", ");

  const handleCreateLead = () => {
    setLocation(`/tech/create-lead?locationId=${loc.id}`);
  };

  const handleCreateJob = () => {
    setLocation(`/tech/create-job?locationId=${loc.id}`);
  };

  return (
    <MobileShell showNav>
      {/* Header */}
      <div className="bg-[#0f1a2e] px-3 pt-2 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={handleBack}
            aria-label="Back"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/20"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-white truncate">{loc.companyName}</h1>
            {loc.location && loc.location !== loc.companyName && (
              <p className="text-xs text-slate-400 truncate">{loc.location}</p>
            )}
          </div>
        </div>
        {addressLine && (
          <p className="text-xs text-slate-400 pl-7 mt-0.5 flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{addressLine}</p>
        )}
        <div className="pl-7 mt-0.5 flex items-center gap-3">
          {loc.phone && toTelHref(loc.phone) && (
            <a
              href={toTelHref(loc.phone)!}
              aria-label={`Call ${loc.phone}`}
              className="text-xs text-slate-400 flex items-center gap-1 min-h-[32px] hover:text-emerald-400"
            >
              <Phone className="h-3 w-3" />{loc.phone}
            </a>
          )}
          {loc.email && (
            <a
              href={`mailto:${loc.email}`}
              aria-label={`Email ${loc.email}`}
              className="text-xs text-slate-400 flex items-center gap-1 min-h-[32px] hover:text-emerald-400"
            >
              <Mail className="h-3 w-3" />{loc.email}
            </a>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-3 py-2 flex gap-2 border-b border-slate-100">
        {/* Primary quick actions — one tap to dial / navigate / create. The
            Call and Directions buttons are the top reasons a tech opens a
            location, so they sit at the widest thumb zone on top. */}
        {toTelHref(loc.phone) && (
          <a
            href={toTelHref(loc.phone)!}
            aria-label={`Call ${loc.companyName}`}
            className="flex-1 h-9 rounded-md border border-emerald-200 text-xs font-semibold text-emerald-700 flex items-center justify-center gap-1.5 hover:bg-emerald-50 active:bg-emerald-100"
          >
            <Phone className="h-3 w-3" />Call
          </a>
        )}
        {toMapsHref(addressLine) && (
          <a
            href={toMapsHref(addressLine)!}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in maps"
            className="flex-1 h-9 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50 active:bg-slate-100"
          >
            <Navigation className="h-3 w-3" />Directions
          </a>
        )}
        <button onClick={handleCreateJob}
          className="flex-1 h-9 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50 active:bg-slate-100">
          <Briefcase className="h-3 w-3" />Create Job
        </button>
        <button onClick={handleCreateLead}
          className="flex-1 h-9 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 hover:bg-slate-50 active:bg-slate-100">
          <FileText className="h-3 w-3" />Create Lead
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 px-1">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 px-2 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab ? "text-[#22c55e] border-[#22c55e]" : "text-slate-400 border-transparent hover:text-slate-600"
            }`}>{tab}</button>
        ))}
      </div>

      {/* Content */}
      <div className="px-3 py-2.5 pb-28">
        {activeTab === "Overview" && (
          <div className="space-y-3">
            {loc.contactName && (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-semibold text-slate-400 uppercase">Contact</p>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1"><User className="h-3 w-3 text-slate-400" />{loc.contactName}</p>
                {loc.phone && toTelHref(loc.phone) && (
                  <a href={toTelHref(loc.phone)!} className="text-xs text-emerald-600 mt-0.5 inline-block">{loc.phone}</a>
                )}
                {loc.email && (
                  <a href={`mailto:${loc.email}`} className="text-xs text-emerald-600 block">{loc.email}</a>
                )}
              </div>
            )}
            {loc.notes && (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Notes</p>
                <p className="text-xs text-slate-700 whitespace-pre-wrap">{loc.notes}</p>
              </div>
            )}
            {!loc.contactName && !loc.notes && (
              <EmptyState icon={MapPin} message="No additional details" className="py-8" />
            )}
          </div>
        )}

        {activeTab === "Equipment" && (
          <div className="space-y-2">
            {equipment.length === 0 ? (
              <EmptyState icon={Wrench} message="No equipment registered" className="py-8" />
            ) : (
              equipment.map(eq => (
                <div key={eq.id} className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-800">{eq.name}</p>
                  <p className="text-xs text-slate-400">
                    {[eq.equipmentType, eq.manufacturer, eq.modelNumber].filter(Boolean).join(" · ") || "Equipment"}
                  </p>
                  {eq.serialNumber && <p className="text-[10px] text-slate-400 mt-0.5">S/N: {eq.serialNumber}</p>}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "History" && (
          <div className="space-y-2">
            {recentJobs.length === 0 ? (
              <EmptyState icon={Briefcase} message="No recent jobs" className="py-8" />
            ) : (
              recentJobs.map(job => (
                <div key={job.id} className="rounded-md border border-slate-200 bg-white p-3 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500 tabular-nums">#{job.jobNumber}</span>
                      <span className="text-sm font-medium text-slate-800 truncate">{job.summary}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] font-semibold px-1.5 py-0 rounded-full ${STATUS_COLORS[job.status] || "bg-slate-100 text-slate-500"}`}>
                        {job.status}
                      </span>
                      {job.scheduledStart && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <Calendar className="h-2.5 w-2.5" />{fmtDate(job.scheduledStart)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </MobileShell>
  );
}
