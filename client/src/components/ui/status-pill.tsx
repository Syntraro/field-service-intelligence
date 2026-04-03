import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * StatusPill — Soft, rounded status indicator.
 * Height: 24px, border-radius: 999px, font-size: 12px, font-weight: 500.
 * Variants: neutral, success, warning, danger, info.
 */

type PillVariant = "neutral" | "success" | "warning" | "danger" | "info"

const variantClasses: Record<PillVariant, string> = {
  neutral:
    "bg-[#f8fafc] text-[#4b5563] border-[#e5e7eb] dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
  success:
    "bg-[rgba(34,197,94,0.12)] text-[#16a34a] border-[rgba(34,197,94,0.25)] dark:bg-green-950/40 dark:text-green-400 dark:border-green-800",
  warning:
    "bg-[rgba(245,158,11,0.14)] text-[#92400E] border-[rgba(245,158,11,0.28)] dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
  danger:
    "bg-[rgba(220,38,38,0.12)] text-[#B91C1C] border-[rgba(220,38,38,0.25)] dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
  info:
    "bg-[rgba(59,130,246,0.12)] text-[#1D4ED8] border-[rgba(59,130,246,0.25)] dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
}

/**
 * Maps a job/invoice/quote status string to a pill variant.
 * Centralizes status→color logic so all pages are consistent.
 */
export function statusToVariant(status: string): PillVariant {
  switch (status) {
    // Job lifecycle
    case "open":
    case "draft":
    case "archived":
      return "neutral"
    case "completed":
    case "invoiced":
    case "paid":
    case "approved":
      return "success"
    case "in_progress":
    case "on_route":
    case "sent":
      return "info"
    case "on_hold":
    case "requires_invoicing":
    case "past_due":
    case "overdue":
      return "warning"
    case "overdue_critical":
    case "escalated":
    case "cancelled":
    case "void":
      return "danger"
    default:
      return "neutral"
  }
}

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant
  /** Icon element rendered before the label */
  icon?: React.ReactNode
}

const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ className, variant = "neutral", icon, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 h-6 text-xs font-medium leading-none gap-1",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
)
StatusPill.displayName = "StatusPill"

export { StatusPill }
export type { PillVariant }
