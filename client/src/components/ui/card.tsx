import * as React from "react"

import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      // 2026-04-29 Color Phase 3: hardcoded `shadow-[0_1px_2px_rgba(0,0,0,0.05)]`
      // migrated to the canonical `shadow-card` token (defined in
      // `tailwind.config.ts` and mirrored by `--card-shadow` in
      // `index.css`). Soft 8px-elevation lift consistent across every
      // `<Card>` consumer; spec target = "lift from background without
      // heavy shadows".
      "shadcn-card rounded-md border bg-card border-card-border text-card-foreground shadow-card",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader"

// 2026-04-29 Typography Phase B — Card primitive defaults migrated to
// canonical semantic tokens. Previously CardTitle defaulted to `text-2xl`
// (28.5px on this app's 19px html root, per the typography audit), which
// every consumer overrode. CardDescription defaulted to `text-sm` and
// the legacy shadcn `text-muted-foreground` color token. Both now resolve
// through the canonical tokens registered in `tailwind.config.ts` and
// `client/src/index.css`. The previous `leading-none` / `tracking-tight`
// CardTitle modifiers are dropped — they were compensations for the
// oversized 28.5px default and add no value at the new 16px size.
//
// Behavior contract: pages that override the default (e.g.
// `<CardTitle className="text-base font-medium">`) are unchanged because
// the override className still wins via cn(). Pages that did NOT
// override now render at the new canonical size — see Phase B follow-up
// for the (small) list of impacted consumers.
const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-section-title", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-caption text-text-muted", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
}
