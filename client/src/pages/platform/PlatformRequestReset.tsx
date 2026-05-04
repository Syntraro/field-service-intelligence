/**
 * PlatformRequestReset — platform-only password reset request (2026-05-03).
 *
 * Posts to `POST /api/platform/auth/request-reset`. The backend ALWAYS
 * responds success regardless of whether the email matches a platform
 * account (anti-enumeration); this page's success copy is intentionally
 * generic: "If a platform admin account exists for that email, a reset
 * link has been sent."
 *
 * Visually distinct from the tenant `RequestReset` page in the same way
 * `PlatformLogin` is visually distinct from `Login` — dark slate
 * background, internal-tooling vibe, no signup link. Tenant accounts
 * cannot reset via this surface (server-side gate); the email link
 * always lands at `/platform/reset-password`, never `/reset-password`.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, CheckCircle2, Loader2, Shield } from "lucide-react";

export default function PlatformRequestReset() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async (submittedEmail: string) =>
      apiRequest("/api/platform/auth/request-reset", {
        method: "POST",
        body: JSON.stringify({ email: submittedEmail }),
      }),
    onSuccess: () => setSubmitted(true),
    // On error we still flip to "submitted" so the response shape can't
    // be used to enumerate emails — same anti-enumeration contract the
    // server enforces.
    onError: () => setSubmitted(true),
  });

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-950 p-4"
      data-testid="platform-request-reset"
    >
      <Card className="w-full max-w-md border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Internal
            </span>
          </div>
          <CardTitle className="text-xl">Reset platform-admin password</CardTitle>
          <CardDescription className="text-slate-400">
            We'll email a one-time reset link if your address matches a
            platform-admin account. Tenant accounts use the regular
            tenant reset flow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-sm text-emerald-400">
                <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                <p>
                  If a platform-admin account exists for that email, a
                  reset link has been sent. Check your inbox.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setLocation("/platform/login")}
                data-testid="platform-reset-back-to-login"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to platform login
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim().length === 0) return;
                mutation.mutate(email.trim().toLowerCase());
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="platform-reset-email">Email</Label>
                <Input
                  id="platform-reset-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ops@example.com"
                  data-testid="platform-reset-input-email"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={mutation.isPending || email.trim().length === 0}
                data-testid="platform-reset-button-submit"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-slate-500 hover:text-slate-300 underline-offset-4 hover:underline"
                onClick={() => setLocation("/platform/login")}
                data-testid="platform-reset-link-back"
              >
                Back to platform login
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
