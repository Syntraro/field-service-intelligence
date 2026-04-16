/**
 * TemplateEditor (Phase 11, 2026-04-12 — redesigned 2026-04-13, Commit B).
 *
 * Side-by-side editor + live preview for a tenant's email template.
 *
 * Left column:
 *   - Subject input
 *   - Body textarea
 *   - Variable insertion chips (focus-aware)
 *   - Reset / Save actions
 *
 * Right column:
 *   - Live preview — renders via the canonical
 *     `POST /api/communication-templates/preview/:entityType` endpoint,
 *     which calls the server's `renderTemplate` with sample data. No
 *     substitution happens client-side.
 *
 * State model:
 *   - `data`     — server-returned template (tenant row OR system default w/ isDefault=true)
 *   - `subject`  / `body` — editable draft
 *   - `preview`  — last successful preview payload from the server
 *   - `saveMutation` / `resetMutation` — canonical Phase 1 endpoints
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { VARIABLES_BY_ENTITY, entityLabel, type EntityType } from "@/lib/communicationTemplateVariables";
import { VariablePicker } from "./VariablePicker";

interface TemplateRow {
  id: string | null;
  tenantId: string;
  entityType: EntityType;
  channel: "email";
  subjectTemplate: string | null;
  bodyTemplate: string;
  isActive: boolean;
  isDefault?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PreviewResponse {
  subject: string | null;
  body: string;
  sample: Record<string, string>;
}

interface TemplateEditorProps {
  entityType: EntityType;
}

const PREVIEW_DEBOUNCE_MS = 300;

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

  // ---- Template fetch ----
  const { data, isLoading, isError } = useQuery({
    queryKey: templateQueryKey(entityType),
    queryFn: async (): Promise<TemplateRow | null> => {
      try {
        return await apiRequest(`/api/communication-templates/${entityType}/email`);
      } catch (err: any) {
        if (err?.status === 404 || /404/.test(String(err?.message))) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (data) {
      setSubject(data.subjectTemplate ?? "");
      setBody(data.bodyTemplate ?? "");
      setHasTenantRow(!data.isDefault);
    } else {
      setSubject("");
      setBody("");
      setHasTenantRow(false);
    }
  }, [data]);

  // ---- Live preview via canonical endpoint ----
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    // Only preview when the editor has data to render.
    if (isLoading) return;
    const trimmedBody = body.trim();
    if (trimmedBody.length === 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res: PreviewResponse = await apiRequest(
          `/api/communication-templates/preview/${entityType}`,
          {
            method: "POST",
            body: JSON.stringify({
              subjectTemplate: subject || null,
              bodyTemplate: body,
            }),
          },
        );
        if (!cancelled) setPreview(res);
      } catch (err: any) {
        if (!cancelled) setPreviewError(err?.message ?? "Preview failed");
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [subject, body, entityType, isLoading]);

  const variables = VARIABLES_BY_ENTITY[entityType];

  // ---- Mutations ----
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

  // ---- Variable insertion ----
  const insertToken = (token: string) => {
    if (lastFocusRef.current === "subject") {
      const el = subjectRef.current;
      if (!el) return setSubject((s) => s + token);
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? subject.length;
      const next = subject.slice(0, start) + token + subject.slice(end);
      setSubject(next);
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* ---------- Editor column ---------- */}
      <Card className="self-start">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">
                {entityLabel(entityType)} email template
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Customize the outbound email sent when you send a {entityType}.
              </p>
            </div>
            {isLoading ? (
              <Badge variant="outline" className="text-xs">Loading…</Badge>
            ) : hasTenantRow ? (
              <Badge className="text-xs" data-testid={`badge-template-custom-${entityType}`}>Custom template</Badge>
            ) : (
              <Badge variant="outline" className="text-xs" data-testid={`badge-template-default-${entityType}`}>
                Using default template
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {isError && (
            <div className="text-xs text-destructive">Unable to load template. Try refreshing.</div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`tmpl-subject-${entityType}`}>Subject</Label>
            <Input
              id={`tmpl-subject-${entityType}`}
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={() => { lastFocusRef.current = "subject"; }}
              disabled={isLoading}
              data-testid={`input-template-subject-${entityType}`}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`tmpl-body-${entityType}`}>Body</Label>
            <Textarea
              id={`tmpl-body-${entityType}`}
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={() => { lastFocusRef.current = "body"; }}
              rows={14}
              disabled={isLoading}
              className="font-mono text-[13px] leading-6"
              data-testid={`input-template-body-${entityType}`}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] uppercase tracking-wider text-muted-foreground">
              Insert variable
            </Label>
            <VariablePicker
              variables={variables}
              onInsert={insertToken}
              disabled={isLoading}
              label=""
            />
            <p className="text-xs text-muted-foreground">
              Click a chip to insert the token at your cursor. Focus the Subject field first to insert there.
            </p>
          </div>

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

      {/* ---------- Preview column ---------- */}
      <Card className="self-start bg-muted/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Preview</CardTitle>
            {previewLoading && (
              <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Sample values shown for preview. Real values are substituted when the email is sent.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {previewError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {previewError}
            </div>
          )}

          <div>
            <div className="text-[13px] uppercase tracking-wider text-muted-foreground mb-1">
              Subject
            </div>
            <div className="rounded-md border bg-background px-3 py-2 text-sm font-medium break-words min-h-[38px]" data-testid={`preview-subject-${entityType}`}>
              {preview?.subject ?? (
                <span className="text-muted-foreground italic">—</span>
              )}
            </div>
          </div>

          <div>
            <div className="text-[13px] uppercase tracking-wider text-muted-foreground mb-1">
              Body
            </div>
            <div
              className="rounded-md border bg-background px-3 py-3 text-sm leading-6 whitespace-pre-wrap break-words min-h-[240px]"
              data-testid={`preview-body-${entityType}`}
            >
              {preview?.body ?? (
                <span className="text-muted-foreground italic">Preview will appear here.</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
