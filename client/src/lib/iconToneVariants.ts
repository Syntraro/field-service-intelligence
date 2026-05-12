import { cva, type VariantProps } from "class-variance-authority";

export const iconToneVariants = cva(
  "inline-flex items-center justify-center rounded p-1 shrink-0",
  {
    variants: {
      tone: {
        success: "bg-success/10 text-success",
        danger:  "bg-danger/10 text-danger",
        warning: "bg-warning/10 text-warning-foreground",
        info:    "bg-info/10 text-info",
        neutral: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export type IconTone = NonNullable<VariantProps<typeof iconToneVariants>["tone"]>;
