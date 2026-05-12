import { cn } from "@/lib/utils";
import { iconToneVariants, type IconTone } from "@/lib/iconToneVariants";

interface IconToneBadgeProps {
  tone: IconTone;
  className?: string;
  children: React.ReactNode;
}

export function IconToneBadge({ tone, className, children }: IconToneBadgeProps) {
  return (
    <div className={cn(iconToneVariants({ tone }), className)}>
      {children}
    </div>
  );
}
