/**
 * RequestReset — self-service password reset request (2026-04-15).
 *
 * Posts the user's email to `POST /api/auth/password-reset-request`. The
 * backend always responds success regardless of whether the email is on
 * file (anti-enumeration), so this page's success copy is intentionally
 * generic: "If an account exists for that email, a reset link has been
 * sent." A back-to-login link is present on both the form and the
 * success state.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";

export default function RequestReset() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async (submittedEmail: string) => {
      return apiRequest<{ message: string }>("/api/auth/password-reset-request", {
        method: "POST",
        body: JSON.stringify({ email: submittedEmail }),
      });
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    mutation.mutate(trimmed);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            {submitted
              ? "Check your inbox for the next step."
              : "Enter the email address associated with your account."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {submitted ? (
            <>
              <div
                className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
                data-testid="request-reset-success"
              >
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    If an account exists for <strong>{email.trim()}</strong>, a
                    reset link has been sent. The link expires in 60 minutes.
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setLocation("/login")}
                data-testid="button-back-to-login"
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back to login
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mutation.isError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Something went wrong. Please try again.
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="request-reset-email">Email</Label>
                <Input
                  id="request-reset-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={mutation.isPending}
                  data-testid="input-request-reset-email"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!email.trim() || mutation.isPending}
                data-testid="button-send-reset-link"
              >
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Send reset link
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setLocation("/login")}
                data-testid="button-back-to-login"
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back to login
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
