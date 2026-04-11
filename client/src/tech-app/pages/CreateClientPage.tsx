/**
 * Technician PWA — Create Client Page.
 * Creates a canonical customer company + primary location via POST /api/tech/clients.
 * Supports two entry paths:
 *   1. Standalone (from action chooser) → navigates to /tech/today on success
 *   2. From Create Job (from=create-job) → navigates to /tech/create-job?locationId=X
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { apiRequest } from "@/lib/queryClient";

// Navigation uses query params (no sessionStorage)

export function CreateClientPage() {
  const [location, setLocation] = useLocation();
  const fromCreateJob = location.includes("from=create-job");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasName = companyName.trim() || (firstName.trim() && lastName.trim());
  const canSubmit = hasName && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiRequest<any>("/api/tech/clients", {
        method: "POST",
        body: JSON.stringify({
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          companyName: companyName.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          province: province.trim() || undefined,
          postalCode: postalCode.trim() || undefined,
        }),
      });

      setSuccess("Client created");

      setTimeout(() => {
        if (fromCreateJob && result?.locationId) {
          setLocation(`/tech/create-job?locationId=${result.locationId}`);
        } else {
          setLocation("/tech/today");
        }
      }, 600);
    } catch (err: any) {
      setError(err?.message || "Failed to create client");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileShell showNav>
      <div className="bg-[#0f1a2e] px-3 pt-2 pb-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setLocation(fromCreateJob ? "/tech/create-job" : "/tech/today")}
            className="p-1 -ml-1 rounded-md hover:bg-white/10">
            <ArrowLeft className="h-4 w-4 text-white" />
          </button>
          <h1 className="text-base font-bold text-white">Create Client</h1>
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

        {/* Company Name */}
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Company Name</label>
          <input value={companyName} onChange={e => setCompanyName(e.target.value)}
            placeholder="Business name (or leave blank for personal)"
            className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
        </div>

        {/* Name */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">First Name</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)}
              placeholder="First"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
          </div>
          <div className="flex-1">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Last Name</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)}
              placeholder="Last"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
          </div>
        </div>

        {/* Contact */}
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Phone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)}
            type="tel" placeholder="(555) 123-4567"
            className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)}
            type="email" placeholder="contact@example.com"
            className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
        </div>

        {/* Address */}
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Address</label>
          <input value={address} onChange={e => setAddress(e.target.value)}
            placeholder="Street address"
            className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">City</label>
            <input value={city} onChange={e => setCity(e.target.value)}
              placeholder="City"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
          </div>
          <div className="w-24">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Province</label>
            <input value={province} onChange={e => setProvince(e.target.value)}
              placeholder="ON"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
          </div>
        </div>
        <div className="w-32">
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Postal Code</label>
          <input value={postalCode} onChange={e => setPostalCode(e.target.value)}
            placeholder="A1A 1A1"
            className="w-full h-9 px-3 text-sm border border-slate-200 rounded-md" />
        </div>

        {/* Submit */}
        <button onClick={handleSubmit} disabled={!canSubmit}
          className="w-full h-11 rounded-md bg-emerald-600 text-white text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98]">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create Client
        </button>
      </div>
    </MobileShell>
  );
}
