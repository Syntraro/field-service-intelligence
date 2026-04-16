/**
 * ResetPassword — token-based password reset form (2026-04-15).
 *
 * Reads the one-shot token from the URL's `?token=` query parameter, lets
 * the user enter a new password twice, and posts to
 * `POST /api/auth/password-reset/confirm`. On success, shows a confirmation
 * state and sends the user to /login; on failure (invalid/expired token,
 * weak password) surfaces a clear inline error.
 */

import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft } from "lucide-react";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const token = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("token") ?? "";
  }, [search]);

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      return apiRequest<{ success: true }>("/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, newPassword }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Password updated",
        description: "You can now log in with your new password.",
      });
      setLocation("/login");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);

    if (!token) {
      setClientError("This reset link is invalid. Please request a new one.");
      return;
    }
    if (newPassword.length < 8) {
      setClientError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setClientError("Passwords do not match.");
      return;
    }
    mutation.mutate();
  };

  const serverError =
    mutation.isError && isApiError(mutation.error)
      ? mutation.error.message
      : mutation.isError
        ? "Something went wrong. Please try again."
        : null;

  // Token missing from URL entirely — render a clear terminal state.
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid reset link</CardTitle>
            <CardDescription>This link is missing its reset token.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Please request a new password reset link.
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLocation("/request-reset")}
              data-testid="button-request-new-reset"
            >
              Request new reset link
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setLocation("/login")}
              data-testid="button-back-to-login"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>
            Enter a new password for your account. This link expires after a single use.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {(clientError || serverError) && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {clientError || serverError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reset-new-password">New password</Label>
              <Input
                id="reset-new-password"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={mutation.isPending}
                minLength={8}
                required
                data-testid="input-reset-new-password"
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-confirm-password">Confirm password</Label>
              <Input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={mutation.isPending}
                minLength={8}
                required
                data-testid="input-reset-confirm-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending || !newPassword || !confirm}
              data-testid="button-reset-submit"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Update password
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
        </CardContent>
      </Card>
    </div>
  );
}
