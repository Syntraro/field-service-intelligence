import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// tailwind-merge v2 does not know about custom fontSize tokens added via
// tailwind.config.ts `extend.fontSize`. Without this extension, any class
// of the form `text-{custom-name}` (e.g. `text-list-primary`, `text-helper`,
// `text-row`) is silently categorised as a text-color utility and stripped
// when another text-color class (e.g. `text-slate-800`) appears in the same
// cn() call. This extension registers every project-defined fontSize token
// as a font-size utility so tailwind-merge correctly keeps both the size and
// color class.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: [
          // Preferred visual-hierarchy tokens (tailwind.config.ts preferred set)
          "display", "title", "header", "subheader",
          "body", "row", "emphasis", "caption", "list-primary", "list-body",
          "label", "helper", "nav-compact",
          // Deprecated aliases (kept for back-compat consumers)
          "page-title", "section-title", "subhead", "row-emphasis",
          // Deprecated component-specific tokens
          "modal-title", "table-header", "table-cell",
          "input", "email-body", "error", "empty-state",
          // Deprecated form/select tokens
          "form-label", "form-helper", "select-label", "select-item",
        ] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
