/**
 * CreateLeadPage — Full-page lead creation flow at /leads/new.
 *
 * Reuses LeadSummaryCard + LeadDetailsRail in draft mode so the page
 * renders the same chrome the saved lead-detail page renders; the only
 * differences are editable affordances and saved-only metadata
 * placeholders. Visits / notes / actions / quote-conversion sections
 * are intentionally omitted — they have no meaning before first save.
 *
 * Submit:
 *   POST /api/leads { locationId, originTechnicianId, title, description,
 *                     priority, estimatedValue, sourceType: "office" }
 * On success: invalidates ["leads"], navigates to /leads/:id.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
// 2026-05-08 (create-page rail canonicalization): icons for the rail tab.
import { Briefcase, Loader2, Info } from "lucide-react";
// 2026-05-08 (create-page rail canonicalization): mount the same canonical
// `<DetailRightRail>` the saved Lead detail page uses. Create mode hosts
// only the Details tab — Notes / Actions / linked-quote affordances need
// a saved leadId and have no meaning before first save.
import {
  DetailRightRail,
  RAIL_WIDTH_TRANSITION,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { TechnicianSelector } from "@/components/TechnicianSelector";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import { useLocationSearch, type LocationResult } from "@/hooks/useLocationSearch";
import { LeadSummaryCard } from "@/components/leads/LeadSummaryCard";
import { LeadDetailsRail } from "@/components/leads/LeadDetailsRail";

const DEFAULT_PRIORITY = "medium";
const SOURCE_TYPE = "office"; // hardcoded — every lead created here is office-sourced

export default function CreateLeadPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Client / Location selection state ──
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<LocationResult | null>(null);
  const { data: searchResults = [], isLoading: searchLoading } = useLocationSearch(locationSearch);

  // ── Inline create-client state — preserves the search → "client not
  // found" → create-new self-service flow that ships across the app
  // anywhere a client/location selector exists. ──
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCity, setNewCity] = useState("");

  // ── Lead form state ──
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(DEFAULT_PRIORITY);
  const [estimatedValue, setEstimatedValue] = useState("");
  const [capturedByUserId, setCapturedByUserId] = useState(user?.id ?? "");

  // Discard-confirm dialog visibility for the dirty-form guard. Uses
  // the canonical AlertDialog primitive (modal taxonomy rule #1) so the
  // surface matches the rest of the app's destructive confirmations.
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // 2026-05-08 (create-page rail canonicalization): canonical right-rail
  // tab state. Mirrors the saved Lead Detail page contract — null = panel
  // closed (icon strip only). Default open: "details" (the only tab valid
  // before save).
  type CreateLeadRailTab = "details";
  const [leadRailTab, setLeadRailTab] = useState<CreateLeadRailTab | null>("details");

  // ── Create-client mutation — canonical full-create. ──
  const createClientMutation = useMutation({
    mutationFn: () =>
      apiRequest<any>("/api/clients/full-create", {
        method: "POST",
        body: JSON.stringify({
          company: {
            name: newCompanyName.trim(),
            phone: newPhone.trim() || null,
            email: newEmail.trim() || null,
          },
          primaryLocation: {
            serviceAddress: {
              street: newAddress.trim() || null,
              city: newCity.trim() || null,
            },
          },
        }),
      }),
    onSuccess: (data) => {
      const loc = data.client || data.locations?.[0];
      if (loc?.id) {
        setSelectedLocation({
          id: loc.id,
          companyName: loc.companyName ?? newCompanyName.trim(),
          address: loc.address ?? newAddress.trim(),
          city: loc.city ?? newCity.trim(),
        });
      }
      setShowCreateClient(false);
      setNewCompanyName(""); setNewPhone(""); setNewEmail(""); setNewAddress(""); setNewCity("");
      toast({ title: "Client created" });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create client", variant: "destructive" });
    },
  });

  // ── Create-lead mutation. ──
  const createLeadMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ id: string }>("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          locationId: selectedLocation?.id,
          originTechnicianId: capturedByUserId || null,
          title,
          description: description || null,
          priority,
          estimatedValue: estimatedValue || null,
          sourceType: SOURCE_TYPE,
        }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "Lead created" });
      // Navigate to the new lead's detail page; the detail-query fetch
      // there reads through to /api/leads/:id directly, so no need to
      // pre-warm the cache here.
      if (data?.id) {
        setLocation(`/leads/${data.id}`);
      } else {
        setLocation("/leads");
      }
    },
    // onError intentionally does NOT reset state — preserving the
    // user's input so they can retry after a server validation failure
    // (e.g., a duplicate, a missing field surfaced by the schema).
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create lead", variant: "destructive" });
    },
  });

  // ── Dirty-form detection — meaningful input only. Untouched defaults
  // (priority="medium", capturedBy=current user) are NOT counted. ──
  const isDirty =
    title.trim().length > 0 ||
    description.trim().length > 0 ||
    estimatedValue.trim().length > 0 ||
    !!selectedLocation ||
    priority !== DEFAULT_PRIORITY ||
    capturedByUserId !== (user?.id ?? "") ||
    showCreateClient;

  const canSubmit =
    !!selectedLocation?.id && title.trim().length > 0 && !createLeadMutation.isPending;
  const canCreateClient =
    newCompanyName.trim().length > 0 && !createClientMutation.isPending;

  // 2026-05-07: explain WHY Create Lead is disabled. The button used to
  // sit silently greyed-out which left first-time users unable to tell
  // whether they had missed a step or whether the page was broken. We
  // surface a single short hint listing the missing required field(s)
  // — never aggressive red, never fired before the user has interacted
  // with anything. Empty string suppresses the hint entirely (canSubmit
  // is true, or the user hasn't started yet).
  const missingFields: string[] = [];
  if (!selectedLocation?.id) missingFields.push("a client / location");
  if (title.trim().length === 0) missingFields.push("a title");
  // Only surface the hint once the user has touched anything — prevents
  // the hint from flashing on initial page load before the user has
  // even seen the form.
  const disabledReason =
    !canSubmit && !createLeadMutation.isPending && isDirty && missingFields.length > 0
      ? `Add ${missingFields.join(" and ")} to create the lead.`
      : null;

  // ── Cancel / back — clean form navigates immediately; dirty form
  // routes through the AlertDialog discard-confirm (modal taxonomy
  // rule #1: destructive confirmations use AlertDialog). ──
  const navigateBack = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    setLocation("/leads");
  };
  const confirmDiscard = () => {
    setShowDiscardConfirm(false);
    setLocation("/leads");
  };

  // ── Slot for the client/location selector. The selector or the
  // inline create-client form is rendered into LeadSummaryCard's
  // clientLocationSlot so the search → select → "create new" flow
  // sits exactly where the saved lead's client identity block sits. ──
  const clientLocationSlot = !showCreateClient ? (
    <CreateOrSelectField<LocationResult>
      label="Client / Location"
      value={selectedLocation}
      onChange={setSelectedLocation}
      searchResults={searchResults}
      searchLoading={searchLoading}
      searchText={locationSearch}
      onSearchTextChange={setLocationSearch}
      minSearchLength={2}
      getKey={(l) => l.id}
      getLabel={(l) => l.companyName}
      getDescription={(l) => [l.location, l.address, l.city].filter(Boolean).join(", ") || undefined}
      createLabel="Create new client"
      onCreateNew={(text) => {
        setShowCreateClient(true);
        setNewCompanyName(text);
        setLocationSearch("");
      }}
      placeholder="Search clients..."
    />
  ) : (
    <div className="space-y-1.5">
      <Label>New Client</Label>
      <div className="border border-slate-200 rounded-md p-3 space-y-2 bg-slate-50/50">
        <Input
          placeholder="Company name *"
          value={newCompanyName}
          onChange={(e) => setNewCompanyName(e.target.value)}
          data-testid="input-new-client-company"
        />
        <Input placeholder="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
        <Input placeholder="Email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        <Input placeholder="Address" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
        <Input placeholder="City" value={newCity} onChange={(e) => setNewCity(e.target.value)} />
        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowCreateClient(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={() => createClientMutation.mutate()}
            disabled={!canCreateClient}
            data-testid="button-create-client"
          >
            {createClientMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Create Client
          </Button>
        </div>
      </div>
    </div>
  );

  // 2026-05-08 (create-page rail canonicalization): rail tab registry —
  // ONLY Details is valid before first save. Notes (needs leadId), Actions
  // (saved-only — Convert / Mark Contacted / Archive / Delete moved into
  // <LeadSummaryCard>'s Section B in saved mode and have no draft meaning),
  // and the linked-quote affordance are intentionally omitted. Once the
  // user saves, the route flips to /leads/:id and the saved page mounts
  // its full Details + Notes registry.
  const leadRailTabs: DetailRailTab[] = [
    {
      id: "details",
      label: "Details",
      icon: Info,
      testId: "create-lead-rail-tab-details",
      content: (
        <LeadDetailsRail
          mode="draft"
          estimatedValue={estimatedValue}
          onEstimatedValueChange={setEstimatedValue}
          capturedBySlot={
            <TechnicianSelector
              mode="single"
              value={capturedByUserId || null}
              onChange={(id) => setCapturedByUserId(id ?? "")}
              placeholder="Select..."
            />
          }
        />
      ),
    },
  ];

  return (
    <div
      className="flex h-full flex-col lg:flex-row bg-[#f1f5f9]"
      data-testid="create-lead-page"
    >
      {/* ═════════ LEFT COLUMN: header + body ═════════ */}
      <div
        className="flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-hidden"
        data-testid="create-lead-left-column-shell"
      >
        {/* 2026-05-08 (single-scroll canonicalization): body wrapper has
            no inner `flex-1 min-h-0 overflow-y-auto` — App.tsx's
            `<main className="flex-1 overflow-auto">` is the SOLE
            canonical scroll surface. Mirrors the saved Lead detail page
            after the scroll-canonicalization fix. */}
        <div className="px-4 lg:px-6 py-4 space-y-3">
          <LeadSummaryCard
            mode="draft"
            onBack={navigateBack}
            title={title}
            onTitleChange={setTitle}
            priority={priority}
            onPriorityChange={setPriority}
            sourceType={SOURCE_TYPE}
            clientLocationSlot={clientLocationSlot}
          />

          {/* Description — same chrome as the saved detail page's
              Description card. Editable on the create flow. */}
          <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-[#f8fafc] border-b border-slate-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-[#64748b]" />Description
              </span>
            </div>
            <div className="px-5 py-3">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Details about the opportunity..."
                rows={4}
                maxLength={2000}
                className="min-h-[96px] text-sm resize-y"
                data-testid="input-description"
              />
            </div>
          </div>

          {/* 2026-05-08 (create-page rail canonicalization): Save / Cancel
              relocated from the prior right-rail Actions stacked-card to
              an inline action row at the bottom of the left column.
              Saved-only actions (Convert, Mark Contacted, Archive,
              Delete) have no draft meaning, so the rail no longer hosts
              an Actions tab — the action row stays in the page main
              flow. */}
          <div
            className="flex items-center justify-end gap-2 pt-2"
            data-testid="create-lead-action-row"
          >
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={navigateBack}
              disabled={createLeadMutation.isPending}
              data-testid="button-cancel-lead"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => createLeadMutation.mutate()}
              disabled={!canSubmit}
              aria-describedby={disabledReason ? "create-lead-disabled-reason" : undefined}
              data-testid="button-create-lead"
            >
              {createLeadMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create Lead
            </Button>
          </div>
          {disabledReason && (
            <p
              id="create-lead-disabled-reason"
              className="text-[11px] text-slate-500 leading-snug text-right px-0.5"
              data-testid="text-create-lead-disabled-reason"
            >
              {disabledReason}
            </p>
          )}
        </div>
      </div>
      {/* ═══ /LEFT COLUMN ═══ */}

      {/* ═════════ RIGHT RAIL ═════════
          Page-level sibling of the left column (mirrors Job Detail).
          Width driven by `--create-lead-rail-width`. Below `lg` the row
          collapses to a column and the rail stacks under the body. */}
      <aside
        className={cn(
          "relative lg:shrink-0 lg:h-full flex flex-col bg-white",
          "border-t lg:border-t-0 lg:border-l border-slate-200",
        )}
        style={{
          ["--create-lead-rail-width" as any]: `${leadRailTab === null ? 80 : 380}px`,
        }}
        data-testid="create-lead-detail-rail-column"
        data-panel-open={leadRailTab === null ? "false" : "true"}
      >
        <div className="lg:hidden">
          <DetailRightRail
            tabs={leadRailTabs}
            activeTabId={leadRailTab}
            onActiveTabChange={(id) => setLeadRailTab(id as CreateLeadRailTab | null)}
            testIdPrefix="create-lead-side"
            ariaLabel="New lead information rail"
          />
        </div>
        <div
          className={cn(
            "hidden lg:flex h-full w-[var(--create-lead-rail-width)] flex-col relative",
            RAIL_WIDTH_TRANSITION,
          )}
        >
          <DetailRightRail
            tabs={leadRailTabs}
            activeTabId={leadRailTab}
            onActiveTabChange={(id) => setLeadRailTab(id as CreateLeadRailTab | null)}
            testIdPrefix="create-lead-side"
            ariaLabel="New lead information rail"
          />
        </div>
      </aside>

      {/* Discard-confirm dialog — fires when Cancel/back is pressed
          on a dirty form. Uses AlertDialog per modal taxonomy rule #1
          (destructive confirmation). Action button is the destructive
          variant; Cancel keeps the user on /leads/new. */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes haven't been saved. If you leave now, the lead won't be created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-discard-cancel">
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDiscard}
              data-testid="button-discard-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
