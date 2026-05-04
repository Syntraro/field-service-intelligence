import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
        card: "10px",
      },
      boxShadow: {
        card: "0 8px 18px rgba(15, 23, 42, 0.04)",
      },
      // ──────────────────────────────────────────────────────────────────
      // 2026-04-29 Typography Phase A — canonical semantic typography
      // tokens. Defined in absolute pixels so the rendered size is
      // independent of the (non-standard 19px) html root font-size and
      // each role is unambiguous to readers / designers.
      //
      // Each tuple is [size, { lineHeight, fontWeight?, letterSpacing? }].
      // Tailwind applies all three when the utility is consumed; explicit
      // weight/tracking utilities still override (`text-page-title font-bold`
      // works as expected). The `text-label` token additionally needs
      // uppercase, which is applied via a `@layer components` rule in
      // `client/src/index.css` (Tailwind fontSize tuples don't carry
      // text-transform).
      //
      // Naming is by ROLE not size:
      //   display        — biggest visible value on a page (totals, KPIs)
      //   page-title     — h1 for a detail page
      //   section-title  — h2 for a card / panel / modal
      //   subhead        — h3 for groups inside a card / table sub-header
      //   body           — default reading text (forms, dialogs, prose)
      //   row            — default table / list row content
      //   row-emphasis   — primary identifier in a row (entity name)
      //   caption        — secondary text alongside row content
      //   label          — form labels + table headers (uppercase + tracked)
      //   helper         — tooltip body, hint text, "as of" timestamps
      //
      // See docs/UI_TYPOGRAPHY.md for usage rules and migration plan.
      // ──────────────────────────────────────────────────────────────────
      fontSize: {
        // ──────────────────────────────────────────────────────────────
        // 2026-05-01 Typography Phase C — token sizes bumped upward to
        // match the visual scale that legacy classes (`text-xs`,
        // `text-3xl`, etc.) produce against the project's
        // `html { font-size: 19px }` root. The Phase A audit defined
        // the tokens against an implicit 16px root, which made canonical
        // consumers (e.g. JobDetailPage) read visibly smaller than
        // legacy consumers (e.g. InvoiceDetailPage's `text-3xl` H1).
        //
        // Phase C raises every token by ~15-18% so:
        //   • InvoiceDetailPage's existing legacy classes can migrate
        //     to canonical tokens with near-zero visible delta.
        //   • Existing canonical consumers (Job / Lead / Quote / Jobs /
        //     PM list pages, Operations + Financial dashboards, the
        //     `ui/list-surface` primitives) automatically scale up to
        //     match the new "correct" detail-page scale.
        //
        // No token names changed; tuple shape unchanged. `text-label`
        // still relies on the `@layer components` rule in
        // `client/src/index.css` for `text-transform: uppercase`.
        // ──────────────────────────────────────────────────────────────
        // Headings
        display:         ["32px", { lineHeight: "40px", fontWeight: "700" }],
        "page-title":    ["30px", { lineHeight: "36px", fontWeight: "700" }],
        "section-title": ["18px", { lineHeight: "24px", fontWeight: "600" }],
        subhead:         ["16px", { lineHeight: "22px", fontWeight: "500" }],
        // Body
        body:            ["15px", { lineHeight: "22px" }],
        row:             ["15px", { lineHeight: "22px" }],
        "row-emphasis":  ["15px", { lineHeight: "22px", fontWeight: "500" }],
        // Small
        caption:         ["14px", { lineHeight: "20px" }],
        label:           ["13px", { lineHeight: "16px", fontWeight: "500", letterSpacing: "0.04em" }],
        helper:          ["13px", { lineHeight: "16px" }],

        // ──────────────────────────────────────────────────────────────
        // 2026-05-03 Phase E — semantic role tokens for app-wide
        // typography enforcement. Each new token is either an ALIAS of
        // an existing token (preserves pixel output exactly) OR a new
        // size that pixel-matches a current approved primitive class.
        //
        // Goal: every typography-bearing surface uses a SEMANTIC token
        // by role rather than a raw `text-xs`/`text-sm` etc. The role
        // names map 1:1 to the user's stated role list:
        //   text-label         (compact uppercase tracked — table heads,
        //                       KPI labels, "BILL TO" metadata keys)
        //   text-helper        (compact non-uppercase — tooltips,
        //                       "as of" timestamps)
        //   text-body          (default reading text)
        //   text-caption       (secondary text alongside row content)
        //   text-section-title (h2 inside a card / panel / modal body)
        //   text-table-header  ALIAS of label — for column headers
        //   text-table-cell    ALIAS of row — for table cells
        //   text-input         ALIAS of body — for form input/textarea
        //   text-email-body    ALIAS of body — for email composition
        //   text-modal-title   NEW 21.4px/600 — pixel-matches the
        //                       legacy `text-lg font-semibold` that
        //                       DialogTitle currently uses
        //   text-error         NEW 15.2px/500 — pixel-matches the
        //                       legacy `text-xs font-medium` that
        //                       FormMessage uses (color via separate
        //                       `text-destructive` utility — fontSize
        //                       tuples can't carry color)
        //   text-empty-state   NEW 15.2px — pixel-matches the legacy
        //                       `text-xs` empty-state copy in
        //                       reports / lists / modals
        //
        // Note: form-context labels/helpers (Label, FormDescription,
        // SelectLabel, SelectItem) intentionally remain on raw
        // `text-xs` (15.2px) because the existing `text-label` /
        // `text-helper` tokens are 13px UPPERCASE TRACKED — a
        // different visual role from sentence-case form labels.
        // Migrating those primitives to `text-label` would change
        // both size (15.2px → 13px) and case (sentence → upper) which
        // violates the "preserve current approved visual output"
        // rule. The raw classes are documented as the form-label /
        // form-helper canonical pattern in those primitives' source.
        // ──────────────────────────────────────────────────────────────
        "modal-title":  ["1.125rem", { lineHeight: "1.6rem", fontWeight: "600" }],
        "table-header": ["13px", { lineHeight: "16px", fontWeight: "500", letterSpacing: "0.04em" }],
        "table-cell":   ["15px", { lineHeight: "22px" }],
        input:          ["15px", { lineHeight: "22px" }],
        "email-body":   ["15px", { lineHeight: "22px" }],
        error:          ["0.8rem", { lineHeight: "1.2rem", fontWeight: "500" }],
        "empty-state":  ["0.8rem", { lineHeight: "1.2rem" }],

        // ──────────────────────────────────────────────────────────────
        // 2026-05-03 Phase F — form & select semantic tokens. These
        // close the last raw-class gap in the form/select primitives:
        //   Label / FormDescription / SelectLabel / SelectItem all
        //   previously kept raw `text-xs` / `text-xs font-medium`
        //   because the existing `text-label` (13px UPPERCASE TRACKED)
        //   was the wrong role for sentence-case form labels.
        //
        // The tokens below name the form/select roles explicitly:
        //   text-form-label    — sentence-case form label (Label,
        //                        FormLabel via wrap)
        //   text-form-helper   — helper / hint copy below a field
        //                        (FormDescription); color via
        //                        `text-muted-foreground` utility
        //   text-select-label  — group label inside a Select dropdown
        //                        (heavier weight than form-label)
        //   text-select-item   — option row inside a Select dropdown
        //
        // Pixel output matches the prior raw classes exactly:
        //   form-label   = text-xs (15.2px) + font-medium (500)
        //   form-helper  = text-xs (15.2px), no weight baked
        //   select-label = text-xs (15.2px) + font-semibold (600)
        //   select-item  = text-xs (15.2px), no weight baked
        //
        // text-label remains the canonical compact UPPERCASE TRACKED
        // role (KPI labels, "BILL TO" metadata keys) — separate
        // identity from these form roles. This is NOT a second
        // typography system: same naming convention, same tailwind
        // theme.fontSize map, just additional semantic roles.
        // ──────────────────────────────────────────────────────────────
        "form-label":   ["0.8rem", { lineHeight: "1.2rem", fontWeight: "500" }],
        "form-helper":  ["0.8rem", { lineHeight: "1.2rem" }],
        "select-label": ["0.8rem", { lineHeight: "1.2rem", fontWeight: "600" }],
        "select-item":  ["0.8rem", { lineHeight: "1.2rem" }],

        // ─── Legacy ramp (deprecated — retained for backward compat) ───
        // Renders against `html { font-size: 19px }` set in
        // `client/src/index.css:245`. The previous comments here assumed
        // a 16px root and were wrong — the real rendered px is below.
        // Migrate consumers to the semantic tokens above; remove this
        // ramp once `text-xs`/`-sm`/`-base`/`-lg`/`-xl`/`-2xl` are gone
        // from app code (see Phase H lint enforcement in the audit).
        xs:   ["0.8rem",   "1.2rem"],   // 15.2px / 22.8px line-height
        sm:   ["0.9rem",   "1.3rem"],   // 17.1px / 24.7px line-height
        base: ["1rem",     "1.5rem"],   // 19px   / 28.5px line-height
        lg:   ["1.125rem", "1.6rem"],   // 21.4px / 30.4px line-height
        xl:   ["1.25rem",  "1.75rem"],  // 23.8px / 33.3px line-height
        "2xl":["1.5rem",   "2rem"],     // 28.5px / 38px   line-height
      },
      colors: {
        // ──────────────────────────────────────────────────────────────
        // 2026-04-29 Color Phase 2.7 — canonical tokens via HSL channels.
        //
        // CSS variables live in `client/src/index.css` in the form
        // `--name: H S% L%` (space-separated). Wrapping each here as
        // `hsl(var(--name) / <alpha-value>)` lets Tailwind:
        //   - emit `bg-name` as `background-color: hsl(var(--name) / 1)`
        //     (visually identical to the previous opaque rule), and
        //   - emit `bg-name/95`, `text-name/60`, `ring-name/30` etc.
        //     as alpha-modulated rules, which the previous `var(...)`
        //     direct form silently dropped (Path A regression).
        //
        // Utility names are unchanged from Phase 1 — every existing
        // `bg-app-bg`, `text-text-primary`, `border-border-default`,
        // `bg-brand`, `hover:bg-brand-hover` consumer keeps working.
        // ──────────────────────────────────────────────────────────────
        "app-bg":          "hsl(var(--app-bg) / <alpha-value>)",
        surface: {
          DEFAULT:         "hsl(var(--surface) / <alpha-value>)",
          subtle:          "hsl(var(--surface-subtle) / <alpha-value>)",
        },
        "border-default":  "hsl(var(--border-default) / <alpha-value>)",
        "border-strong":   "hsl(var(--border-strong) / <alpha-value>)",
        "text-primary":    "hsl(var(--text-primary) / <alpha-value>)",
        "text-secondary":  "hsl(var(--text-secondary) / <alpha-value>)",
        "text-muted":      "hsl(var(--text-muted) / <alpha-value>)",
        "text-disabled":   "hsl(var(--text-disabled) / <alpha-value>)",
        brand: {
          DEFAULT:         "hsl(var(--brand) / <alpha-value>)",
          hover:           "hsl(var(--brand-hover) / <alpha-value>)",
        },
        "sidebar-bg":      "hsl(var(--sidebar-bg) / <alpha-value>)",
        "header-bg":       "hsl(var(--header-bg) / <alpha-value>)",
        success:           "hsl(var(--success) / <alpha-value>)",
        warning:           "hsl(var(--warning) / <alpha-value>)",
        danger:            "hsl(var(--danger) / <alpha-value>)",
        info:              "hsl(var(--info) / <alpha-value>)",

        // Accessible neutral gray palette
        gray: {
          50: "#FAFAFC",
          100: "#F4F5F9",
          200: "#E3E5E8",
          300: "#C5C8CF",
          400: "#A1A5B0",
          500: "#7C808C",
          600: "#616571",
          700: "#3E4250",
          800: "#252937",
          900: "#151824",
        },
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          overdue: {
            DEFAULT: "hsl(var(--status-overdue) / <alpha-value>)",
            foreground: "hsl(var(--status-overdue-foreground) / <alpha-value>)",
            border: "var(--status-overdue-border)",
          },
          upcoming: {
            DEFAULT: "hsl(var(--status-upcoming) / <alpha-value>)",
            foreground: "hsl(var(--status-upcoming-foreground) / <alpha-value>)",
            border: "var(--status-upcoming-border)",
          },
          "this-month": {
            DEFAULT: "hsl(var(--status-this-month) / <alpha-value>)",
            foreground: "hsl(var(--status-this-month-foreground) / <alpha-value>)",
            border: "var(--status-this-month-border)",
          },
          unscheduled: {
            DEFAULT: "hsl(var(--status-unscheduled) / <alpha-value>)",
            foreground: "hsl(var(--status-unscheduled-foreground) / <alpha-value>)",
            border: "var(--status-unscheduled-border)",
          },
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
