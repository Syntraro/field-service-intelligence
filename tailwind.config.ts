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
      // UI typography standard (see docs/UI_TYPOGRAPHY.md):
      //   - Default body text = `text-xs` (12px target).
      //   - `text-sm` is for headers / emphasis / titles, not row content.
      //   - `text-base` is page-level prose; do not use for UI chrome.
      // ──────────────────────────────────────────────────────────────────
      fontSize: {
        xs: ["0.8rem", "1.2rem"],      // ~12.8px - timestamps, tiny labels
        sm: ["0.9rem", "1.3rem"],      // ~14.4px - helper text, secondary labels
        base: ["1rem", "1.5rem"],      // 16px - main body / card content
        lg: ["1.125rem", "1.6rem"],    // ~18px - section headings, card titles
        xl: ["1.25rem", "1.75rem"],    // ~20px - page headings
        "2xl": ["1.5rem", "2rem"],     // 24px - big titles
      },
      colors: {
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
