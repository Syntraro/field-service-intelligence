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
// 2026-05-04 form-canonicalization Phase 1: tech-app pages migrate
// raw <input> elements to the canonical <Input> primitive so every
// form-control surface in the app reads from the same primitive.
// Layout (h-9 px-3) is preserved by the primitive's defaults; the
// raw `text-sm border-slate-200` styling is replaced by the
// primitive's canonical `text-input` typography + border.
import { Input } from "@/components/ui/input";

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
          <button
            onClick={() => setLocation(fromCreateJob ? "/tech/create-job" : "/tech/today")}
            aria-label="Back"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-white/10 active:bg-white/20"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <h1 className="text-base font-bold text-white">Create Client</h1>
        </div>
      </div>

      <div className="px-3 py-3 pb-28 space-y-3">
        {success && (
          <div
            className="rounded-md bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2"
            role="status"
            aria-live="polite"
          >
            <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
            <p className="text-xs font-medium text-emerald-700">{success}</p>
          </div>
        )}
        {error && (
          <div
            className="rounded-md bg-red-50 border border-red-200 p-3"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Company Name */}
        <div>
          <label htmlFor="tech-cc-company" className="text-xs font-semibold text-slate-500 mb-1 block">Company Name</label>
          <Input id="tech-cc-company" value={companyName} onChange={e => setCompanyName(e.target.value)}
            placeholder="Business name (or leave blank for personal)"
            autoComplete="organization" />
        </div>

        {/* Name */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="tech-cc-first" className="text-xs font-semibold text-slate-500 mb-1 block">First Name</label>
            <Input id="tech-cc-first" value={firstName} onChange={e => setFirstName(e.target.value)}
              placeholder="First"
              autoComplete="given-name" />
          </div>
          <div className="flex-1">
            <label htmlFor="tech-cc-last" className="text-xs font-semibold text-slate-500 mb-1 block">Last Name</label>
            <Input id="tech-cc-last" value={lastName} onChange={e => setLastName(e.target.value)}
              placeholder="Last"
              autoComplete="family-name" />
          </div>
        </div>

        {/* Contact */}
        <div>
          <label htmlFor="tech-cc-phone" className="text-xs font-semibold text-slate-500 mb-1 block">Phone</label>
          <Input id="tech-cc-phone" value={phone} onChange={e => setPhone(e.target.value)}
            type="tel" placeholder="(555) 123-4567"
            inputMode="tel" autoComplete="tel" />
        </div>
        <div>
          <label htmlFor="tech-cc-email" className="text-xs font-semibold text-slate-500 mb-1 block">Email</label>
          <Input id="tech-cc-email" value={email} onChange={e => setEmail(e.target.value)}
            type="email" placeholder="contact@example.com"
            inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} />
        </div>

        {/* Address */}
        <div>
          <label htmlFor="tech-cc-address" className="text-xs font-semibold text-slate-500 mb-1 block">Address</label>
          <Input id="tech-cc-address" value={address} onChange={e => setAddress(e.target.value)}
            placeholder="Street address"
            autoComplete="street-address" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="tech-cc-city" className="text-xs font-semibold text-slate-500 mb-1 block">City</label>
            <Input id="tech-cc-city" value={city} onChange={e => setCity(e.target.value)}
              placeholder="City"
              autoComplete="address-level2" />
          </div>
          <div className="w-24">
            <label htmlFor="tech-cc-province" className="text-xs font-semibold text-slate-500 mb-1 block">Province</label>
            <Input id="tech-cc-province" value={province} onChange={e => setProvince(e.target.value)}
              placeholder="ON"
              autoComplete="address-level1" />
          </div>
        </div>
        <div className="w-32">
          <label htmlFor="tech-cc-postal" className="text-xs font-semibold text-slate-500 mb-1 block">Postal Code</label>
          <Input id="tech-cc-postal" value={postalCode} onChange={e => setPostalCode(e.target.value)}
            placeholder="A1A 1A1"
            autoComplete="postal-code" autoCapitalize="characters" />
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
