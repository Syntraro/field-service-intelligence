/**
 * Invoice Reminder settings — tenant-facing.
 *
 * Two-column layout:
 *   Left  — reminder behavior (enable toggle, first-delay, repeat cadence)
 *   Right — overdue reminder template editor + live preview
 *
 * 2026-04-21 Phase 3 canonical policy architecture: reminder cadence moved
 * from the legacy tenant_features boolean-column table to the canonical
 * `company_settings` row. Behavior reads/writes now go through the existing
 * /api/company-settings endpoints (the same ones every other tenant
 * preference uses) — no admin-only round-trip required.
 *
 *   Behavior:
 *     GET /api/company-settings
 *     PUT /api/company-settings
 *
 *   Template (specifically (invoice_reminder, email)):
 *     GET  /api/communication-templates/invoice_reminder/email
 *     POST /api/communication-templates          (upsert)
 *     POST /api/communication-templates/preview/invoice_reminder
 */

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FormField, FormLabel, FormErrorText, FormHelperText } from "@/components/ui/form-field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Bell, Loader2, Eye, ArrowLeft } from "lucide-react";

interface CompanySettingsResponse {
  invoiceRemindersEnabled?: boolean;
  invoiceReminderFirstDelayDays?: number;
  invoiceReminderRepeatEveryDays?: number;
  [key: string]: unknown;
}

interface TemplateResponse {
  id: string | null;
  entityType: string;
  channel: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  isDefault?: boolean;
}

const REMINDER_VARS = [
  "{{INVOICE_NUMBER}}",
  "{{CLIENT_COMPANY_NAME}}",
  "{{COMPANY_NAME}}",
  "{{INVOICE_TOTAL}}",
  "{{INVOICE_BALANCE}}",
  "{{INVOICE_DUE_DATE}}",
  "{{DAYS_OVERDUE}}",
] as const;

export default function InvoiceRemindersSettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const companyId = user?.companyId;

  // ─────────────── Left column: behavior ───────────────
  // 2026-04-21 Phase 3: reminder cadence is a tenant preference on
  // company_settings, not a policy feature flag — read + write through the
  // canonical /api/company-settings endpoint the rest of Settings uses.
  const { data: settingsData, isLoading: settingsLoading } = useQuery<CompanySettingsResponse>({
    queryKey: ["/api/company-settings"],
    queryFn: () => apiRequest(`/api/company-settings`),
    enabled: !!companyId,
  });

  const [enabled, setEnabled] = useState(true);
  const [firstDelay, setFirstDelay] = useState(3);
  const [repeatEvery, setRepeatEvery] = useState(7);

  useEffect(() => {
    if (!settingsData) return;
    setEnabled(settingsData.invoiceRemindersEnabled ?? true);
    setFirstDelay(settingsData.invoiceReminderFirstDelayDays ?? 3);
    setRepeatEvery(settingsData.invoiceReminderRepeatEveryDays ?? 7);
  }, [settingsData]);

  const firstDelayError =
    firstDelay < 1 ? "Minimum 1 day" : firstDelay > 90 ? "Maximum 90 days" : null;
  const repeatError =
    repeatEvery < 1 ? "Minimum 1 day" : repeatEvery > 90 ? "Maximum 90 days" : null;
  const hasBehaviorError = Boolean(firstDelayError || repeatError);

  const saveBehavior = useMutation({
    mutationFn: () =>
      apiRequest(`/api/company-settings`, {
        method: "PUT",
        body: JSON.stringify({
          invoiceRemindersEnabled: enabled,
          invoiceReminderFirstDelayDays: firstDelay,
          invoiceReminderRepeatEveryDays: repeatEvery,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Reminder behavior saved" });
    },
    onError: (err: unknown) => {
      const msg = isApiError(err) ? err.message : "Failed to save";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });

  // ─────────────── Right column: template editor ───────────────
  const { data: templateData, isLoading: templateLoading } = useQuery<TemplateResponse>({
    queryKey: ["/api/communication-templates", "invoice_reminder", "email"],
    queryFn: () => apiRequest(`/api/communication-templates/invoice_reminder/email`),
    enabled: !!companyId,
  });

  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!templateData) return;
    setSubjectTemplate(templateData.subjectTemplate ?? "");
    setBodyTemplate(templateData.bodyTemplate ?? "");
  }, [templateData]);

  const templateHasError = !subjectTemplate.trim() || !bodyTemplate.trim();

  const saveTemplate = useMutation({
    mutationFn: () =>
      apiRequest(`/api/communication-templates`, {
        method: "POST",
        body: JSON.stringify({
          entityType: "invoice_reminder",
          channel: "email",
          subjectTemplate,
          bodyTemplate,
          isActive: true,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/communication-templates", "invoice_reminder", "email"] });
      toast({ title: "Reminder template saved" });
    },
    onError: (err: unknown) => {
      const msg = isApiError(err) ? err.message : "Failed to save template";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });

  const generatePreview = useMutation({
    mutationFn: () =>
      apiRequest<{ subject: string; body: string }>(
        `/api/communication-templates/preview/invoice_reminder`,
        {
          method: "POST",
          body: JSON.stringify({ subjectTemplate, bodyTemplate }),
        },
      ),
    onSuccess: (res) => {
      setPreviewSubject(res.subject);
      setPreviewBody(res.body);
      setPreviewOpen(true);
    },
    onError: (err: unknown) => {
      const msg = isApiError(err) ? err.message : "Preview failed";
      toast({ title: "Preview failed", description: msg, variant: "destructive" });
    },
  });

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      {/* Canonical icon-only back-nav — mirrors CustomFieldsPage. */}
      <div className="flex items-center">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-reminders-back" aria-label="Back to Settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-title font-semibold flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Invoice Reminders
        </h1>
        <p className="text-sm text-muted-foreground">
          Send automatic follow-ups for overdue invoices.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ─── Left column ─── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Behavior</CardTitle>
            <CardDescription>
              How often reminders fire. Individual invoices can always be
              paused or snoozed from their page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {settingsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="enabled">
                      Enable automatic reminders
                    </Label>
                    <FormHelperText className="mt-0.5">
                      Turn off to stop all new reminders. Manual "Send reminder
                      now" on an invoice still works.
                    </FormHelperText>
                  </div>
                  <Switch
                    id="enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    data-testid="toggle-reminders-enabled"
                  />
                </div>

                <FormField>
                  <FormLabel htmlFor="first-delay">
                    First reminder after due date
                  </FormLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="first-delay"
                      type="number"
                      min={1}
                      max={90}
                      value={firstDelay}
                      onChange={(e) => setFirstDelay(Number(e.target.value || 0))}
                      disabled={!enabled}
                      data-testid="input-first-delay"
                      className="max-w-[100px]"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                  {firstDelayError && (
                    <FormErrorText>{firstDelayError}</FormErrorText>
                  )}
                </FormField>

                <FormField>
                  <FormLabel htmlFor="repeat-every">
                    Repeat every
                  </FormLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="repeat-every"
                      type="number"
                      min={1}
                      max={90}
                      value={repeatEvery}
                      onChange={(e) => setRepeatEvery(Number(e.target.value || 0))}
                      disabled={!enabled}
                      data-testid="input-repeat-every"
                      className="max-w-[100px]"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                  {repeatError && (
                    <FormErrorText>{repeatError}</FormErrorText>
                  )}
                </FormField>

                <div className="rounded-md bg-muted/40 p-3 text-helper text-muted-foreground">
                  Reminders continue until the invoice is paid, voided, or
                  paused/snoozed from its detail page.
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={() => saveBehavior.mutate()}
                    disabled={saveBehavior.isPending || hasBehaviorError || !companyId}
                    data-testid="btn-save-reminder-behavior"
                  >
                    {saveBehavior.isPending && (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    )}
                    Save settings
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ─── Right column ─── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overdue reminder template</CardTitle>
            <CardDescription>
              The email sent when a reminder fires. Edited only here — it is
              separate from the primary invoice email in Client Communication.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {templateLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading template…
              </div>
            ) : (
              <>
                <FormField>
                  <FormLabel htmlFor="subject-template">Subject</FormLabel>
                  <Input
                    id="subject-template"
                    value={subjectTemplate}
                    onChange={(e) => setSubjectTemplate(e.target.value)}
                    data-testid="input-template-subject"
                    className="text-xs"
                  />
                </FormField>

                <FormField>
                  <FormLabel htmlFor="body-template">Body</FormLabel>
                  {/* Typography pass (2026-04-16): body inherits the app's
                      Inter sans stack at the canonical 12px editor scale.
                      Previously `font-mono text-xs` overrode the stack and
                      the editor read as code instead of an email draft. */}
                  <Textarea
                    id="body-template"
                    rows={10}
                    value={bodyTemplate}
                    onChange={(e) => setBodyTemplate(e.target.value)}
                    data-testid="input-template-body"
                    className="text-xs leading-5"
                  />
                </FormField>

                <div className="space-y-2">
                  <p className="text-xs font-medium">Available variables</p>
                  <div className="flex flex-wrap gap-1.5">
                    {REMINDER_VARS.map((v) => (
                      <code
                        key={v}
                        className="text-xs bg-muted/60 rounded px-1.5 py-0.5 border"
                      >
                        {v}
                      </code>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generatePreview.mutate()}
                    disabled={generatePreview.isPending || templateHasError}
                    data-testid="btn-preview-template"
                  >
                    <Eye className="h-3.5 w-3.5 mr-1.5" />
                    {generatePreview.isPending ? "Rendering..." : "Preview"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveTemplate.mutate()}
                    disabled={saveTemplate.isPending || templateHasError}
                    className="ml-auto"
                    data-testid="btn-save-template"
                  >
                    {saveTemplate.isPending && (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    )}
                    Save template
                  </Button>
                </div>

              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Preview modal — uses canonical Dialog component so Escape + outside-click
          + X button behaviors match every other dialog in the app. The page
          layout behind the modal stays fixed. */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-reminder-preview">
          <DialogHeader>
            <DialogTitle>Preview Reminder Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="text-helper text-muted-foreground mb-1">Subject</div>
              <div className="rounded border bg-background p-2 text-xs font-medium">
                {previewSubject ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-helper text-muted-foreground mb-1">Body</div>
              {/* Typography pass (2026-04-16): preview body renders in
                  Inter at the same 12px scale as the editor so the user
                  sees exactly what their customer will read. */}
              <pre className="max-h-[50vh] overflow-auto rounded border bg-background p-3 text-xs leading-5 whitespace-pre-wrap font-sans">
                {previewBody ?? ""}
              </pre>
            </div>
            <FormHelperText>
              Rendered with sample data. Real sends use each invoice's actual values.
            </FormHelperText>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPreviewOpen(false)}
              data-testid="btn-close-preview"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
