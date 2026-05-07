/**
 * QuoteMetaRow — re-export of the canonical MetaRow primitive.
 *
 * Kept as a per-domain alias so quote-detail surfaces import from
 * `@/components/quotes/shared/QuoteMetaRow` instead of reaching into
 * `@/components/ui/meta-row` directly. Mirrors the LeadMetaRow pattern.
 * This is a re-export, not a wrapper, to avoid creating a parallel
 * implementation that could drift.
 */
export { MetaRow as QuoteMetaRow } from "@/components/ui/meta-row";
