/**
 * MetaRow — Canonical metadata key-value row for detail page sidebars.
 * Used across Lead Detail, Quote Detail, PM Workspace, and other metadata sections.
 */

interface MetaRowProps {
  label: string;
  value: string;
}

export function MetaRow({ label, value }: MetaRowProps) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
