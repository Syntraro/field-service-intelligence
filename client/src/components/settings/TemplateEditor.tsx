/**
 * TemplateEditor (Phase 11, 2026-04-12).
 *
 * Per-entity editor for a tenant's email template. Uses only the Phase 1
 * endpoints — GET/POST/DELETE `/api/communication-templates/*`. No
 * rendering happens client-side; the "preview" is the raw template text
 * formatted for readability.
 *
 * Behavior:
 *   - If GET returns 404 → "Using default template" mode with empty fields.
 *     Saving creates a tenant row; Reset is a no-op until a row exists.
 *   - If GET returns 200 → editable tenant row. Reset issues DELETE and
 *     drops back to default mode.
 *   - Saving always POSTs the current subject/body; legacy/stored state
 *     is never persisted implicitly.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { VARIABLES_BY_ENTITY, entityLabel, type EntityType } from "@/lib/communicationTemplateVariables";
import { VariablePicker } from "./VariablePicker";

interface TemplateRow {
  id: string;
  tenantId: string;
  entityType: EntityType;
  channel: "email";
  subjectTemplate: string | null;
  bodyTemplate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TemplateEditorProps {
  entityType: EntityType;
}

const templateQueryKey = (entityType: EntityType) =>
  ["/api/communication-templates", entityType, "email"] as const;

export function TemplateEditor({ entityType }: TemplateEditorProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [hasTenantRow, setHasTenantRow] = useState(false);

  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocusRef = useRef<"subject" | "body">("body");

  const { data, isLoading, isError } = useQuery({
    queryKey: templateQueryKey(entityType),
    queryFn: async (): Promise<TemplateRow | null> => {
      try {
        return await apiRequest(`/api/communication-templates/${entityType}/email`);
      } catch (err: any) {
        // 404 means no tenant row — fall back to default (empty editor).
        if (err?.status === 404 || /404/.test(String(err?.message))) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  // Reset local state whenever the server row changes.
  useEffect(() => {
    if (data) {
      setSubject(data.subjectTemplate ?? "");
      setBody(data.bodyTemplate ?? "");
      setHasTenantRow(true);
    } else {
      setSubject("");
      setBody("");
      setHasTenantRow(false);
    }
  }, [data]);

  const variables = VARIABLES_BY_ENTITY[entityType];

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/communication-templates`, {
        method: "POST",
        body: JSON.stringify({
          entityType,
          channel: "email",
          subjectTemplate: subject,
          bodyTemplate: body,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: templateQueryKey(entityType) });
      toast({ title: "Template saved" });
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err?.message ?? "Unable to save template",
        variant: "destructive",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/communication-templates/${entityType}/email`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: templateQueryKey(entityType) });
      toast({ title: "Reset to default template" });
    },
    onError: (err: any) => {
      toast({
        title: "Reset failed",
        description: err?.message ?? "Unable to reset template",
        variant: "destructive",
      });
    },
  });

  const insertToken = (token: string) => {
    if (lastFocusRef.current === "subject") {
      const el = subjectRef.current;
      if (!el) return setSubject((s) => s + token);
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? subject.length;
      const next = subject.slice(0, start) + token + subject.slice(end);
      setSubject(next);
      // Restore cursor after React re-render.
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      const el = bodyRef.current;
      if (!el) return setBody((b) => b + token);
      const start = el.selectionStart ?? body.length;
      const end = el.selectionEnd ?? body.length;
      const next = body.slice(0, start) + token + body.slice(end);
      setBody(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    }
  };

  const isDirty = useMemo(() => {
    if (!data) return subject.length > 0 || body.length > 0;
    return subject !== (data.subjectTemplate ?? "") || body !== (data.bodyTemplate ?? "");
  }, [subject, body, data]);

  const canSave =
    !saveMutation.isPending &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    (isDirty || !hasTenantRow);

  return (
    <Card>
      <CardContent className="py-5 space-y-5">
        {/* Header + status */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">
              {entityLabel(entityType)} email template
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Customize the outbound email sent when you send a {entityType}.
            </p>
          </div>
          {isLoading ? (
            <Badge variant="outline" className="text-[11px]">Loading…</Badge>
          ) : hasTenantRow ? (
            <Badge className="text-[11px]">Custom template</Badge>
          ) : (
            <Badge variant="outline" className="text-[11px]">Using default template</Badge>
          )}
        </div>

        {isError && (
          <div className="text-xs text-destructive">Unable to load template. Try refreshing.</div>
        )}

        {/* Variable picker */}
        <VariablePicker
          variables={variables}
          onInsert={insertToken}
          disabled={isLoading}
        />

        {/* Subject */}
        <div className="space-y-2">
          <Label htmlFor={`tmpl-subject-${entityType}`}>Subject</Label>
          <Input
            id={`tmpl-subject-${entityType}`}
            ref={subjectRef}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onFocus={() => { lastFocusRef.current = "subject"; }}
            placeholder={`e.g. ${entityType === "invoice" ? "Invoice #{{INVOICE_NUMBER}} from {{COMPANY_NAME}}" : entityType === "quote" ? "Quote #{{QUOTE_NUMBER}} from {{COMPANY_NAME}}" : "Job update from {{COMPANY_NAME}}"}`}
            disabled={isLoading}
            data-testid={`input-template-subject-${entityType}`}
          />
        </div>

        {/* Body */}
        <div className="space-y-2">
          <Label htmlFor={`tmpl-body-${entityType}`}>Body</Label>
          <Textarea
            id={`tmpl-body-${entityType}`}
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={() => { lastFocusRef.current = "body"; }}
            rows={10}
            placeholder="Message body. Use variables above to personalize."
            disabled={isLoading}
            data-testid={`input-template-body-${entityType}`}
          />
        </div>

        {/* Static preview (raw template text, no rendering) */}
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Template preview
          </Label>
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Subject</div>
              <div className="font-mono whitespace-pre-wrap break-words">
                {subject || <span className="text-muted-foreground italic">No subject</span>}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Body</div>
              <div className="font-mono whitespace-pre-wrap break-words">
                {body || <span className="text-muted-foreground italic">No body</span>}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Variables show as raw tokens here. At send time the system substitutes real values.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasTenantRow || resetMutation.isPending}
            onClick={() => resetMutation.mutate()}
            data-testid={`button-template-reset-${entityType}`}
          >
            {resetMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5 mr-2" />
            )}
            Reset to default
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSave}
            onClick={() => saveMutation.mutate()}
            data-testid={`button-template-save-${entityType}`}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-2" />
            )}
            Save template
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
