import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    // h-9 to match icon buttons and default buttons.
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-base text-[#0F172A] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:border-[#76B054] focus-visible:shadow-[0_0_0_2px_rgba(118,176,84,0.25)] disabled:cursor-not-allowed disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] disabled:border-[#E2E8F0] disabled:opacity-100 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
