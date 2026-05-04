/**
 * StatusBadge — canonical renderer for `StatusMeta` produced by
 * `client/src/lib/statusBadges.ts`. Wraps shadcn `<Badge>` with the
 * tone → variant mapping baked in.
 *
 * Use this for entity list cells where the historical render was
 * already a `<Badge>` (Invoices, Quotes, Leads). Pages that render
 * status differently (Jobs uses `<StatusPill>`; Clients/Locations
 * use inline color spans; Suppliers uses lucide icons) should NOT
 * adopt `<StatusBadge>` — they use the same `*Meta` helpers from
 * `lib/statusBadges.ts` for the label/tone but keep their own
 * rendering primitive. See the canonical-status consolidation
 * CHANGELOG entry for the full per-page mapping.
 */
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { type StatusMeta, toneToBadgeVariant } from "@/lib/statusBadges";

export interface StatusBadgeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  meta: StatusMeta;
  className?: string;
}

export function StatusBadge({ meta, className, ...rest }: StatusBadgeProps) {
  return (
    <Badge variant={toneToBadgeVariant(meta.tone)} className={className} {...rest}>
      {meta.label}
    </Badge>
  );
}
