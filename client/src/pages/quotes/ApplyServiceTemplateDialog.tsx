import { useState, useMemo, useEffect } from "react";
import { Search, Clock, Package } from "lucide-react";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalSecondaryAction,
  ModalPrimaryAction,
} from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import { useServiceTemplates } from "@/lib/serviceTemplates/useServiceTemplates";
import type { ServiceTemplateDto } from "@/lib/serviceTemplates/serviceTemplateTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (template: ServiceTemplateDto) => void;
  isPending?: boolean;
}

export function ApplyServiceTemplateDialog({ open, onOpenChange, onApply, isPending }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ServiceTemplateDto | null>(null);

  const { data: templates = [], isLoading } = useServiceTemplates();

  // Reset internal state whenever the dialog closes (covers both user-dismiss
  // and programmatic close via the parent's onSuccess handler).
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates.filter((t) => t.isActive);
    return templates.filter(
      (t) =>
        t.isActive &&
        (t.name.toLowerCase().includes(q) ||
          (t.category ?? "").toLowerCase().includes(q) ||
          (t.subcategory ?? "").toLowerCase().includes(q)),
    );
  }, [templates, search]);

  function handleOpenChange(o: boolean) {
    if (!o) {
      setSearch("");
      setSelected(null);
    }
    onOpenChange(o);
  }

  function handleApply() {
    if (selected) {
      onApply(selected);
    }
  }

  function computeEstCost(t: ServiceTemplateDto): number {
    return t.components.reduce((sum, c) => {
      const qty = parseFloat(c.quantity) || 0;
      const cost = parseFloat(c.unitCostSnapshot ?? "0") || 0;
      return sum + qty * cost;
    }, 0);
  }

  return (
    <ModalShell open={open} onOpenChange={handleOpenChange} className="sm:max-w-[520px]">
      <ModalHeader>
        <ModalTitle>Add Flat-Rate Service</ModalTitle>
        <ModalDescription>
          Select a service template to add as a single line item on this quote.
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
          <Input
            placeholder="Search by name or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
            autoFocus
          />
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-helper text-muted-foreground">Loading templates…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-helper text-muted-foreground">
            {search ? "No templates match your search." : "No active flat-rate templates."}
          </div>
        ) : (
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto -mx-1 px-1">
            {filtered.map((t) => {
              const estCost = computeEstCost(t);
              const price = parseFloat(t.flatRatePrice) || 0;
              const margin = price > 0 ? Math.round(((price - estCost) / price) * 100) : null;
              const isSelected = selected?.id === t.id;

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t)}
                  className={cn(
                    "w-full text-left rounded-md px-3 py-2.5 border transition-colors",
                    isSelected
                      ? "border-slate-400 bg-slate-50 ring-1 ring-slate-300"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 truncate">{t.name}</div>
                      {(t.category || t.subcategory) && (
                        <div className="text-helper text-muted-foreground truncate">
                          {[t.category, t.subcategory].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(t.flatRatePrice)}
                      </div>
                      {margin !== null && (
                        <div className="text-helper text-muted-foreground tabular-nums">
                          {margin}% margin
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-helper text-muted-foreground">
                    {t.estimatedDurationMinutes != null && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {t.estimatedDurationMinutes >= 60
                          ? `${Math.floor(t.estimatedDurationMinutes / 60)}h${t.estimatedDurationMinutes % 60 ? ` ${t.estimatedDurationMinutes % 60}m` : ""}`
                          : `${t.estimatedDurationMinutes}m`}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Package className="h-3 w-3" />
                      {t.components.length === 0
                        ? "No components"
                        : `${t.components.length} component${t.components.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction onClick={() => handleOpenChange(false)}>
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction onClick={handleApply} disabled={!selected || isPending}>
          {isPending ? "Applying…" : "Add to Quote"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
