import type { ReactNode } from "react";
import syntaroLogo from "@/assets/Syntraro Logo Transparent.png";
// 2026-04-19 auth visual refinement: vertical Syntraro promotional panel
// provided by the user via Downloads and copied into client assets.
// Vite bundles this as a hashed static import.
import brandPanelImage from "@/assets/Syntraro Auth Panel.png";
// 2026-05-01 brand pivot — canonical brand strings.
import { BRAND } from "@shared/branding";

/**
 * 2026-04-19 auth layout — shared chrome for Login, Signup (staged +
 * invite), and Onboarding.
 *
 * Layout:
 *   - `< md`  : single column, form-only, logo above the form.
 *   - `md+`   : two columns — form capped at 480px, branded image panel
 *               fills the remainder. Asymmetric (Jobber-like), not 50/50.
 *
 * Design knobs:
 *   - Compact logo header (`h-7`) so the form sits high on the viewport.
 *   - Form column capped (`max-w-sm`) so fields don't feel oversized.
 *   - Right panel uses `object-cover` + matching dark bg so any aspect
 *     mismatch between image and column is invisible (no stretching).
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    // 2026-04-19 auth layout v4: pin the whole auth surface to the
    // viewport on `md+` so the page itself never scrolls and the image
    // has a fixed-height container to size against. Mobile (`< md`)
    // keeps the original min-h-screen + natural page scroll so small
    // screens don't get clipped forms.
    <main className="min-h-screen md:h-screen grid md:grid-cols-2 bg-background md:overflow-hidden">
      <section className="flex flex-col items-center justify-center px-6 py-8 md:px-10 md:py-10 md:overflow-y-auto">
        <div className="mb-6 md:mb-8 flex items-center">
          <img
            src={syntaroLogo}
            alt={BRAND.full}
            className="h-7 w-auto object-contain"
          />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </section>
      <aside
        data-testid="auth-right-panel"
        aria-hidden="true"
        className="hidden md:flex items-center justify-end overflow-hidden"
      >
        {/* 2026-04-19 auth image v6: the aside has NO background color.
            Earlier iterations painted it with the image's own dark
            navy backdrop to hide letterboxing; with the image now
            flush-right and sized by height, any horizontal leftover
            shows the page's neutral background instead of a colored
            block. The image's internal backdrop is self-contained, so
            the right column reads as "artwork, then page bg" rather
            than "artwork inside a dark container".
            Sizing unchanged: `h-full` + `max-h-screen` fill the
            viewport-pinned panel top-to-bottom; `w-auto` preserves
            natural aspect; `max-w-full` guards against overflow. */}
        <img
          src={brandPanelImage}
          alt=""
          className="block h-full max-h-screen w-auto max-w-full object-contain"
        />
      </aside>
    </main>
  );
}
