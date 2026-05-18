/**
 * SidebarBrand — canonical sidebar brand block.
 *
 * Structure: mark → wordmark → tagline (all centered, stacked vertically).
 *
 * Swap guide (upcoming logo replacement):
 *   - Replace the <img> with an <svg> component or new asset import.
 *   - Keep the wrapper classes unchanged; the layout is mark-agnostic.
 *   - The text elements below are independent of image dimensions.
 */
import { Link } from "wouter";
import { BRAND } from "@shared/branding";
import syntaroLogo from "@/assets/Syntraro Logo Transparent.png";

interface SidebarBrandProps {
  onNavigate?: () => void;
}

export function SidebarBrand({ onNavigate }: SidebarBrandProps) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex flex-col items-center gap-2 px-2 py-5 no-underline"
    >
      {/* Brand mark — swap src here for icon SVG; layout will not shift */}
      <img
        src={syntaroLogo}
        alt={BRAND.company}
        className="h-7 w-auto max-w-full object-contain"
      />
      {/* Wordmark: text-label applies 13px / 500 / UPPERCASE / tracked via canonical token */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-label text-white/90">{BRAND.company}</span>
        <span className="text-nav-compact text-white/45 text-center leading-snug">
          Field Service Intelligence
        </span>
      </div>
    </Link>
  );
}
