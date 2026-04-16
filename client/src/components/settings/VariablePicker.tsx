/**
 * VariablePicker (Phase 11, 2026-04-12).
 *
 * Clickable chips that insert canonical `{{VARIABLE_NAME}}` tokens into
 * the linked text field at the current cursor position. Pure UI — no
 * API calls, no rendering.
 */

import { Button } from "@/components/ui/button";

export interface VariablePickerProps {
  variables: readonly string[];
  /** Invoked with the full token to insert, e.g. `{{INVOICE_NUMBER}}`. */
  onInsert: (token: string) => void;
  disabled?: boolean;
  label?: string;
}

export function VariablePicker({
  variables,
  onInsert,
  disabled = false,
  label = "Insert variable",
}: VariablePickerProps) {
  if (!variables.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}:</span>
      {variables.map((v) => (
        <Button
          key={v}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onInsert(`{{${v}}}`)}
          className="h-7 text-xs font-mono"
          data-testid={`variable-token-${v}`}
        >
          {`{{${v}}}`}
        </Button>
      ))}
    </div>
  );
}
