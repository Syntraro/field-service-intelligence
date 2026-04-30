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
        // Headings
        display:         ["28px", { lineHeight: "32px", fontWeight: "700" }],
        "page-title":    ["22px", { lineHeight: "28px", fontWeight: "600" }],
        "section-title": ["16px", { lineHeight: "22px", fontWeight: "600" }],
        subhead:         ["14px", { lineHeight: "20px", fontWeight: "500" }],
        // Body
        body:            ["14px", { lineHeight: "20px" }],
        row:             ["13px", { lineHeight: "18px" }],
        "row-emphasis":  ["13px", { lineHeight: "18px", fontWeight: "500" }],
        // Small
        caption:         ["12px", { lineHeight: "16px" }],
        label:           ["11px", { lineHeight: "14px", fontWeight: "500", letterSpacing: "0.04em" }],
        helper:          ["11px", { lineHeight: "14px" }],

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
