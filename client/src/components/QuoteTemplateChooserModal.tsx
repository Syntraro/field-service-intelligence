/**
 * QuoteTemplateChooserModal — Template picker for new quote creation.
 *
 * Shows a searchable list of active quote templates with quick-select
 * for the top 5 (default template first, then by creation date).
 * Includes a "Create Blank Quote" action at the bottom.
 *
 * Opened from the command palette "Create Quote" action.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, FileCheck, Search, Plus, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuoteTemplate } from "@shared/schema";

interface QuoteTemplateChooserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when user selects a template — templateId is null for blank quote */
  onSelect: (templateId: string | null) => void;
}

export function QuoteTemplateChooserModal({
  open,
  onOpenChange,
  onSelect,
}: QuoteTemplateChooserModalProps) {
  const [search, setSearch] = useState("");

  // Fetch active quote templates
  const { data: templates = [], isLoading } = useQuery<QuoteTemplate[]>({
    queryKey: ["/api/quote-templates/list", "active"],
    queryFn: async () => {
      const res = await fetch("/api/quote-templates/list?activeOnly=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quote templates");
      return res.json();
    },
    enabled: open,
  });

  // Sort: default template first, then by name alphabetically
  const sortedTemplates = useMemo(() => {
    return [...templates].sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }, [templates]);

  // Filter by search query
  const filtered = useMemo(() => {
    if (!search.trim()) return sortedTemplates;
    const q = search.toLowerCase();
    return sortedTemplates.filter(
      (t) =>
        t.name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
    );
  }, [sortedTemplates, search]);

  // Quick-select: first 5 when no search active
  const quickSelectTemplates = search.trim() ? filtered : filtered.slice(0, 5);
  const hasMore = !search.trim() && filtered.length > 5;

  const handleSelect = (templateId: string) => {
    onSelect(templateId);
    onOpenChange(false);
    setSearch("");
  };

  const handleBlank = () => {
    onSelect(null);
    onOpenChange(false);
    setSearch("");
  };

  const handleClose = () => {
    onOpenChange(false);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            New Quote
          </DialogTitle>
          <DialogDescription>
            Choose a template to pre-fill line items, or start blank.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Search input */}
          {templates.length > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search quote templates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                data-testid="search-quote-templates"
                autoFocus
              />
            </div>
          )}

          {/* Template list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No quote templates found. You can create templates in Settings.
            </div>
          ) : quickSelectTemplates.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No matching quote templates
            </div>
          ) : (
            <div className="space-y-1 max-h-[260px] overflow-y-auto">
              {quickSelectTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleSelect(template.id)}
                  className={cn(
                    "w-full flex items-start gap-3 px-3 py-2.5 text-left text-sm rounded-md transition-colors",
                    "hover:bg-accent hover:text-accent-foreground"
                  )}
                  data-testid={`template-${template.id}`}
                >
                  <FileCheck className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-1.5">
                      {template.name}
                      {template.isDefault && (
                        <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                      )}
                    </div>
                    {template.description && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {template.description}
                      </div>
                    )}
                  </div>
                </button>
              ))}
              {hasMore && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground">
                  Type to search {filtered.length - 5} more template{filtered.length - 5 !== 1 ? "s" : ""}...
                </div>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 px-2">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 border-t border-border" />
          </div>

          {/* Blank quote action */}
          <Button
            variant="outline"
            className="w-full justify-center gap-2"
            onClick={handleBlank}
            data-testid="button-create-blank-quote"
          >
            <Plus className="h-4 w-4" />
            Create Blank Quote
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
