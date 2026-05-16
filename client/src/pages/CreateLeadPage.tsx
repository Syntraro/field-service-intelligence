/**
 * CreateLeadPage — Full-page lead creation flow at /leads/new.
 *
 * Uses CanonicalCreateHeader + LeadDetailsRail in draft mode so the page
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
import { Info } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CanonicalCreateHeader } from "@/components/create/CanonicalCreateHeader";
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
import { useLocationSearch, type LocationResult } from "@/hooks/useLocationSearch";
import { LeadDetailsRail } from "@/components/leads/LeadDetailsRail";
import { CreateClientModal } from "@/components/CreateClientModal";

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

  // ── CreateClientModal state ──
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [createClientInitialName, setCreateClientInitialName] = useState("");

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

  // After CreateClientModal commits, auto-select the new location.
  const handleClientCreated = (
    _customerCompanyId: string,
    primaryLocationId: string,
  ) => {
    setSelectedLocation({
      id: primaryLocationId,
      companyName: "New client (just created)",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    toast({ title: "Client created", description: "Selected for this lead." });
  };

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
    capturedByUserId !== (user?.id ?? "");

  const canSubmit =
    !!selectedLocation?.id && title.trim().length > 0 && !createLeadMutation.isPending;

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
        className="flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-y-auto"
        data-testid="create-lead-left-column-shell"
      >
        {/* Sole scroll surface for the left column. Right rail is a
            pinned shrink-0 sibling with its own internal scroll. */}
        <div className="px-4 lg:px-6 pt-4 pb-4 space-y-3">
          <CanonicalCreateHeader
            testId="create-lead-header"
            entityLabel="New Lead"
            status={{ label: "New", tone: "neutral" }}
            onBack={navigateBack}
            clientSearchText={locationSearch}
            onClientSearchTextChange={setLocationSearch}
            clientSearchResults={searchResults}
            clientSearchLoading={searchLoading}
            selectedLocation={selectedLocation}
            onLocationChange={setSelectedLocation}
            onCreateNewClient={(text) => {
              setCreateClientInitialName(text);
              setCreateClientOpen(true);
            }}
            clientCreateLabel="Create new client"
            clientPlaceholder="Search clients..."
            titleValue={title}
            onTitleChange={setTitle}
            titlePlaceholder="What's this lead about? e.g., AC tune-up at Basil Box"
            titleMaxLength={500}
            metaItems={[
              {
                key: "priority",
                label: "Priority",
                node: (
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger
                      className="h-6 px-2 text-xs capitalize w-auto gap-1 border-slate-200"
                      data-testid="select-priority"
                      aria-label="Priority"
                    >
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                ),
              },
            ]}
            descriptionValue={description}
            onDescriptionChange={setDescription}
            descriptionMaxLength={2000}
            descriptionLabel="Description"
            primaryAction={{
              label: "Create Lead",
              onClick: () => createLeadMutation.mutate(),
              disabled: !canSubmit,
              isPending: createLeadMutation.isPending,
              testId: "button-create-lead",
              ariaDescribedBy: disabledReason ? "create-lead-disabled-reason" : undefined,
            }}
            onCancel={navigateBack}
            cancelDisabled={createLeadMutation.isPending}
            cancelTestId="button-cancel-lead"
          />
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
          ["--create-lead-rail-width" as any]: `${leadRailTab === null ? 48 : 380}px`,
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

      {/* Canonical create-client modal — opened when the client/location
          search yields no match and the user clicks "Create new client".
          Mirrors the wiring used by CreateQuotePage and NewInvoicePage. */}
      <CreateClientModal
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        onCreated={handleClientCreated}
        initialValues={{ companyName: createClientInitialName }}
      />

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
