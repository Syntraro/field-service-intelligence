/**
 * LeadMetaRow — re-export of the canonical MetaRow primitive.
 *
 * Kept as a per-domain alias so lead-detail surfaces import from
 * `@/components/leads/shared/LeadMetaRow` instead of reaching into
 * `@/components/ui/meta-row` directly. This is a re-export, not a wrapper,
 * to avoid creating a parallel implementation that could drift.
 */
export { MetaRow as LeadMetaRow } from "@/components/ui/meta-row";
