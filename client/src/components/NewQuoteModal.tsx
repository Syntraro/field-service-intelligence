/**
 * NewQuoteModal — unified one-modal quote creation (2026-04-15).
 *
 * Previously the global create flow was two modals:
 *   QuoteTemplateChooserModal (pick template OR "Create Blank")
 *     → NewQuoteModal (location, title, description)
 *
 * That intermediate chooser was redundant — both branches ended up
 * here anyway. The chooser has been collapsed into this single modal:
 * an inline, optional template selector sits above the blank-quote
 * fields. Submitting with no template selected creates a blank
 * quote; submitting with a template selected creates the quote and
 * applies the template via the same canonical `/api/quote-templates/
 * :id/apply` call the prior flow used. No duplicate creation logic —
 * the POST + optional apply-template path is unchanged from the
 * earlier implementation.
 *
 * `templateId` prop is retained as an optional *initial* selection so
 * callers that still route through an external chooser (historically
 * the Quotes list page) can pre-seed the selection. New callers
 * should simply open the modal without a prop and let the user pick
 * inline.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useSurfaceController } from "@/hooks/useSurfaceController";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Loader2, FileText, FileCheck, Star, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useLocationSearch, getLocationKey, getLocationLabel, getLocationDescription,
  type LocationOption,
} from "@/lib/entities/locationEntity";
import type { Quote, QuoteTemplate } from "@shared/schema";

interface NewQuoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional initial template selection (legacy prop for callers that
   *  pre-pick a template externally). New callers should omit this. */
  templateId?: string | null;
}

export function NewQuoteModal({ open, onOpenChange, templateId }: NewQuoteModalProps) {
  const surface = useSurfaceController(open, {
    queryKeys: ["/api/clients/search-locations"],
  });
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  const [, setLocation] = useLocation();

  // Location selector state
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<LocationOption | null>(null);
  const { data: searchResults = [], isLoading: searchLoading } = useLocationSearch(locationSearch, { enabled: open });

  // Template selector state (inline Popover+Command combobox —
  // empty state simply means "no template", represented by a
  // placeholder in the trigger rather than a visible "Blank" row).
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templateId ?? null);

  // Sync initial prop into internal state when the modal opens / prop changes
  useEffect(() => {
    if (open) setSelectedTemplateId(templateId ?? null);
  }, [open, templateId]);

  const { data: templates = [], isLoading: templatesLoading } = useQuery<QuoteTemplate[]>({
    queryKey: ["/api/quote-templates/list", "active"],
    queryFn: async () => {
      const res = await fetch("/api/quote-templates/list?activeOnly=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quote templates");
      return res.json();
    },
    enabled: open,
  });

  const sortedTemplates = useMemo(() => {
    return [...templates].sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }, [templates]);

  const selectedTemplate = useMemo(
    () => (selectedTemplateId ? templates.find((t) => t.id === selectedTemplateId) ?? null : null),
    [templates, selectedTemplateId],
  );

  // Form state
  const [title, setTitle] = useState("");
  // notesCustomer on the server — same column invoices/quote detail render
  // as customer-visible notes.
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      // Title / description only ride along when no template is
      // selected. With a template, those fields are hidden in the UI
      // and the template's own scaffolding takes over.
      const includeBlankFields = !selectedTemplateId;
      return apiRequest<Quote>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          locationId: selectedLocation?.id,
          title: includeBlankFields ? (title || undefined) : undefined,
          issueDate: today,
          expiryDate: expiryDate.toISOString().split("T")[0],
          notesCustomer: includeBlankFields ? (description || undefined) : undefined,
          lines: [],
        }),
        signal: surface.signal,
      });
    },
    onSuccess: async (quote) => {
      if (surface.isStale()) return;

      if (selectedTemplateId) {
        try {
          await apiRequest(`/api/quote-templates/${selectedTemplateId}/apply`, {
            method: "POST",
            body: JSON.stringify({ quoteId: quote.id, mode: "replace" }),
            signal: surface.signal,
          });
        } catch (err) {
          if (surface.isStale()) return;
          console.error("Failed to apply quote template:", err);
        }
      }

      if (surface.isStale()) return;
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      logActivity({
        type: "created",
        entityType: "quote",
        entityId: quote.id,
        label: `Created Quote #${quote.quoteNumber}`,
        meta: title || undefined,
      });
      const templateMsg = selectedTemplateId ? " with template" : "";
      toast({ title: "Quote created", description: `Quote ${quote.quoteNumber} has been created${templateMsg}` });
      onOpenChange(false);
      resetForm();
      setLocation(`/quotes/${quote.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create quote", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSelectedLocation(null);
    setLocationSearch("");
    setTemplatePopoverOpen(false);
    setSelectedTemplateId(templateId ?? null);
    setTitle("");
    setDescription("");
  };

  const handleClose = () => {
    if (!createMutation.isPending) {
      onOpenChange(false);
      resetForm();
    }
  };

  const hasTemplates = templates.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />Create Quote
          </DialogTitle>
          <DialogDescription>Create a new quote for a client location</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Section 1 — required location */}
          <CreateOrSelectField<LocationOption>
            label="Client Location *"
            value={selectedLocation}
            onChange={setSelectedLocation}
            searchResults={searchResults}
            searchLoading={searchLoading}
            searchText={locationSearch}
            onSearchTextChange={setLocationSearch}
            getKey={getLocationKey}
            getLabel={getLocationLabel}
            getDescription={getLocationDescription}
            placeholder="Search locations..."
            disabled={createMutation.isPending}
          />

          {/* Section 2 — optional template (searchable combobox; empty
              state = no template selected, shown only as placeholder
              text in the trigger — no visible "Blank" option row) */}
          {(hasTemplates || templatesLoading) && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Template <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>

              <Popover open={templatePopoverOpen} onOpenChange={setTemplatePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={templatePopoverOpen}
                    disabled={createMutation.isPending || templatesLoading}
                    className="w-full justify-between font-normal"
                    data-testid="select-quote-template"
                  >
                    <span className={cn("flex items-center gap-2 min-w-0", !selectedTemplate && "text-muted-foreground")}>
                      {selectedTemplate ? (
                        <>
                          <FileCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{selectedTemplate.name}</span>
                          {selectedTemplate.isDefault && (
                            <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                          )}
                        </>
                      ) : templatesLoading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          <span>Loading templates...</span>
                        </>
                      ) : (
                        <span>Search templates...</span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {selectedTemplate && (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Clear template"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTemplateId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedTemplateId(null);
                            }
                          }}
                          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                          data-testid="clear-quote-template"
                        >
                          <X className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search templates..." />
                    <CommandList>
                      <CommandEmpty>No matching templates</CommandEmpty>
                      <CommandGroup>
                        {sortedTemplates.map((t) => (
                          <CommandItem
                            key={t.id}
                            value={`${t.name ?? ""} ${t.description ?? ""}`}
                            onSelect={() => {
                              setSelectedTemplateId(t.id);
                              setTemplatePopoverOpen(false);
                            }}
                            data-testid={`template-option-${t.id}`}
                            className="gap-2"
                          >
                            <FileCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="truncate flex items-center gap-1.5">
                                <span className="truncate">{t.name}</span>
                                {t.isDefault && (
                                  <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                                )}
                              </div>
                              {t.description && (
                                <div className="text-xs text-muted-foreground truncate">{t.description}</div>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Section 3 — blank-quote fields. Hidden when a template is
              selected (template supplies the scaffolding, so the extra
              entry-time fields are unnecessary). */}
          {!selectedTemplate && (
            <>
              <div className="space-y-2">
                <Label>Title (optional)</Label>
                <Input
                  placeholder="e.g., HVAC Repair Proposal"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={createMutation.isPending}
                />
              </div>

              <div className="space-y-2">
                <Label>Quote Description (optional)</Label>
                <Textarea
                  placeholder="Describe the scope of work for this quote..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={createMutation.isPending}
                  rows={3}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={createMutation.isPending}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!selectedLocation?.id || createMutation.isPending}
            data-testid="button-create-quote"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
