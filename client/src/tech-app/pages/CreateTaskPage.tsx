/**
 * Technician PWA — Create Task Page.
 *
 * Two-step flow:
 *   Step 1 → Choose task type: General Task / Supplier Visit
 *   Step 2 → Fill in title, supplier (if SV), notes, optional schedule → submit
 *
 * UX rules:
 *   - Default is UNSCHEDULED. Toggle to enable scheduling.
 *   - For SUPPLIER_VISIT: canonical supplier picker (GET /api/suppliers) +
 *     location picker (GET /api/suppliers/:id/locations) + freehand fallback.
 *   - Self-assignment: always. No assignee picker. Backend enforces.
 *
 * Calls POST /api/tech/tasks (requireSchedulable guard, self-assignment enforced).
 *
 * 2026-04-10: Created. Supplier picker replaces freeform name field.
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, CheckSquare, Truck, Clock, Search, ChevronDown } from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { Input } from "@/components/ui/input";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { apiRequest } from "@/lib/queryClient";
import type { TaskType, Supplier, SupplierLocation } from "@shared/schema";
import { TECH_ALLOWED_TASK_TYPES } from "@shared/taskConstants";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { TECH_TASKS_QUERY_KEY } from "../hooks/useTechTasks";

// ── Display config for the type chooser ──
const TASK_TYPE_DISPLAY: Record<typeof TECH_ALLOWED_TASK_TYPES[number], {
  label: string; desc: string; icon: typeof CheckSquare; color: string; bg: string;
}> = {
  GENERAL: {
    label: "General Task",
    desc: "Reminder, follow-up, or to-do",
    icon: CheckSquare,
    color: "text-indigo-600",
    bg: "bg-indigo-50",
  },
  SUPPLIER_VISIT: {
    label: "Supplier Visit",
    desc: "Parts pickup or supplier errand",
    icon: Truck,
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
};

const TECH_TASK_TYPES = TECH_ALLOWED_TASK_TYPES.map((value) => ({
  value,
  ...TASK_TYPE_DISPLAY[value],
}));

function nowDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── Supplier response shape ──
interface SuppliersResponse { items: Supplier[]; total: number; }

export function CreateTaskPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Step management
  const [selectedType, setSelectedType] = useState<TaskType | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");

  // Supplier visit state
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierLocationId, setSupplierLocationId] = useState<string | null>(null);
  const [freehandLocation, setFreehandLocation] = useState("");
  const [poNumber, setPoNumber] = useState("");

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Supplier data (canonical endpoints) ──
  const { data: suppliersData } = useQuery<SuppliersResponse>({
    queryKey: ["/api/suppliers"],
    enabled: selectedType === "SUPPLIER_VISIT",
    staleTime: 5 * 60 * 1000,
  });
  const suppliers = useMemo(
    () => (suppliersData?.items ?? []).filter((s) => s.isActive),
    [suppliersData],
  );
  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return suppliers.slice(0, 20);
    return suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20);
  }, [suppliers, supplierSearch]);

  const selectedSupplier = supplierId ? suppliers.find((s) => s.id === supplierId) : null;

  const { data: locationsRaw } = useQuery<SupplierLocation[]>({
    queryKey: ["supplier-locations", supplierId],
    queryFn: async () => {
      if (!supplierId) return [];
      const res = await fetch(`/api/suppliers/${supplierId}/locations`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : json?.items ?? json?.data ?? [];
    },
    enabled: !!supplierId && selectedType === "SUPPLIER_VISIT",
    staleTime: 5 * 60 * 1000,
  });
  const locations = useMemo(
    () => (locationsRaw ?? []).filter((l) => l.isActive !== false),
    [locationsRaw],
  );

  const handleBack = () => {
    if (selectedType && !success) {
      setSelectedType(null);
      setTitle("");
      setNotes("");
      setScheduled(false);
      setSchedDate("");
      setSchedTime("");
      setSupplierId(null);
      setSupplierSearch("");
      setSupplierLocationId(null);
      setFreehandLocation("");
      setPoNumber("");
      setError(null);
    } else {
      setLocation("/tech/today");
    }
  };

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
    if (!selectedType || !title.trim() || submitting) return;
    if (selectedType === "SUPPLIER_VISIT" && !supplierId) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        type: selectedType,
        title: title.trim(),
      };
      if (notes.trim()) payload.notes = notes.trim();

      if (scheduled && schedDate && schedTime) {
        const start = new Date(`${schedDate}T${schedTime}:00`);
        const end = new Date(start.getTime() + 60 * 60_000);
        payload.scheduledStartAt = start.toISOString();
        payload.scheduledEndAt = end.toISOString();
      }

      if (selectedType === "SUPPLIER_VISIT") {
        if (supplierId) payload.supplierId = supplierId;
        if (supplierLocationId) payload.supplierLocationId = supplierLocationId;
        // If location was entered freehand (no canonical location selected),
        // store it in supplierNameOther as "SupplierName — FreehandLocation"
        if (!supplierLocationId && freehandLocation.trim()) {
          const prefix = selectedSupplier?.name ?? "";
          payload.supplierNameOther = prefix
            ? `${prefix} — ${freehandLocation.trim()}`
            : freehandLocation.trim();
        }
        if (poNumber.trim()) payload.poNumber = poNumber.trim();
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

  const typeConfig = selectedType
    ? TECH_TASK_TYPES.find((t) => t.value === selectedType)
    : null;

  const canSubmit = title.trim() && (selectedType !== "SUPPLIER_VISIT" || supplierId);

  return (
    <MobileShell>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white">
        <button
          onClick={handleBack}
          aria-label="Back"
          className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <h1 className="text-base font-bold text-slate-900">
          {selectedType ? (typeConfig?.label ?? "Create Task") : "Create Task"}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* ── Step 1: Type chooser ── */}
        {!selectedType && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">What kind of task?</p>
            {TECH_TASK_TYPES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.value}
                  onClick={() => setSelectedType(t.value)}
                  className="w-full flex items-center gap-3 px-3 py-3.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
                >
                  <div className={`h-9 w-9 rounded-md ${t.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={t.color} style={{ width: 18, height: 18 }} />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-slate-800">{t.label}</p>
                    <p className="text-xs text-slate-400">{t.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Step 2: Form ── */}
        {selectedType && !success && (
          <div className="space-y-4">
            {/* Title */}
            <FormField>
              <FormLabel>Title *</FormLabel>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={selectedType === "SUPPLIER_VISIT" ? "e.g. Pick up filters" : "e.g. Follow up with tenant"}
                className="w-full h-10 px-3 text-sm border border-slate-200 rounded-md"
                autoFocus
              />
            </FormField>

            {/* ── Supplier Visit fields ── */}
            {selectedType === "SUPPLIER_VISIT" && (
              <>
                {/* Supplier picker */}
                <FormField>
                  <FormLabel>Supplier *</FormLabel>
                  {selectedSupplier ? (
                    <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md">
                      <span className="text-sm font-medium text-slate-800">{selectedSupplier.name}</span>
                      <button
                        onClick={() => { setSupplierId(null); setSupplierLocationId(null); setSupplierSearch(""); setFreehandLocation(""); }}
                        className="text-xs text-slate-500 hover:text-red-500"
                      >Change</button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <input
                          value={supplierSearch}
                          onChange={(e) => setSupplierSearch(e.target.value)}
                          placeholder="Search suppliers..."
                          className="w-full h-10 pl-9 pr-3 text-sm border border-slate-200 rounded-md"
                        />
                      </div>
                      {supplierSearch.length >= 1 && (
                        <div className="border border-slate-200 rounded-md max-h-40 overflow-y-auto">
                          {filteredSuppliers.length === 0 && (
                            <div className="px-3 py-2 text-xs text-slate-400">No suppliers found</div>
                          )}
                          {filteredSuppliers.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => { setSupplierId(s.id); setSupplierSearch(""); setSupplierLocationId(null); setFreehandLocation(""); }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                            >
                              <span className="font-medium text-slate-800">{s.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </FormField>

                {/* Supplier location picker / freehand fallback */}
                {supplierId && (
                  <FormField>
                    <FormLabel>Location</FormLabel>
                    {locations.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        <select
                          value={supplierLocationId ?? ""}
                          onChange={(e) => {
                            setSupplierLocationId(e.target.value || null);
                            setFreehandLocation("");
                          }}
                          className="w-full h-10 px-3 text-sm border border-slate-200 rounded-md bg-white"
                        >
                          <option value="">Select location...</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}{loc.address ? ` — ${loc.address}` : ""}{loc.city ? `, ${loc.city}` : ""}
                            </option>
                          ))}
                          <option value="__freehand__">Other (type below)</option>
                        </select>
                        {supplierLocationId === "__freehand__" && (
                          <input
                            value={freehandLocation}
                            onChange={(e) => { setFreehandLocation(e.target.value); setSupplierLocationId(null); }}
                            placeholder="e.g. 123 Industrial Blvd"
                            className="w-full h-10 px-3 text-sm border border-slate-200 rounded-md"
                          />
                        )}
                      </div>
                    ) : (
                      <input
                        value={freehandLocation}
                        onChange={(e) => setFreehandLocation(e.target.value)}
                        placeholder="Enter location or address (optional)"
                        className="w-full h-10 px-3 text-sm border border-slate-200 rounded-md"
                      />
                    )}
                  </FormField>
                )}

                {/* PO Number */}
                {supplierId && (
                  <FormField>
                    <FormLabel>PO Number</FormLabel>
                    <input
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                      placeholder="Optional"
                      className="w-full h-10 px-3 text-sm border border-slate-200 rounded-md"
                    />
                  </FormField>
                )}
              </>
            )}

            {/* Notes */}
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

            {/* Schedule toggle */}
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
              disabled={!canSubmit || submitting}
              className="w-full h-11 rounded-md bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 active:bg-emerald-700 transition-colors"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Creating..." : "Create Task"}
            </button>
          </div>
        )}

        {/* ── Success ── */}
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
