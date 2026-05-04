/**
 * PlatformResetPassword — platform-only password reset confirmation (2026-05-03).
 *
 * Reads `?token=…` from the URL and posts {token, newPassword} to
 * `POST /api/platform/auth/reset-password`. On success, routes to
 * `/platform/login` so the user can sign in with the new password.
 *
 * Tokens here are scoped to the `platform_password_reset_tokens`
 * table (server-side); a tenant reset token cannot be redeemed at
 * this endpoint and a platform token cannot be redeemed at the
 * tenant `/reset-password` page. The split is enforced at the data
 * layer, not just at the URL.
 */

import { useState, useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield } from "lucide-react";

export default function PlatformResetPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Read ?token= from URL. wouter's useLocation returns the path only;
  // search params live on `window.location.search`.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    setToken(t);
  }, []);

  const mutation = useMutation({
    mutationFn: async () =>
      apiRequest("/api/platform/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword }),
      }),
    onSuccess: () => {
      toast({
        title: "Password updated",
        description: "Sign in with your new password.",
      });
      setLocation("/platform/login");
    },
    onError: (err: any) => {
      const message =
        err?.message ||
        "This reset link is invalid or has expired. Please request a new one.";
      toast({
        variant: "destructive",
        title: "Reset failed",
        description: message,
      });
    },
  });

  const tokenMissing = token !== null && token.length === 0;
  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const passwordMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-950 p-4"
      data-testid="platform-reset-password"
    >
      <Card className="w-full max-w-md border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Internal
            </span>
          </div>
          <CardTitle className="text-xl">Choose a new password</CardTitle>
          <CardDescription className="text-slate-400">
            Pick a password at least 8 characters long. After saving you'll
            be signed out everywhere and can sign in with the new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tokenMissing ? (
            <div className="space-y-4">
              <p className="text-sm text-destructive">
                The reset link is missing its token. Request a new link from
                the platform login page.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setLocation("/platform/request-reset")}
                data-testid="platform-reset-confirm-back"
              >
                Request a new link
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  !token ||
                  newPassword.length < 8 ||
                  newPassword !== confirmPassword
                ) {
                  return;
                }
                mutation.mutate();
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="platform-new-password">New password</Label>
                <Input
                  id="platform-new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  data-testid="platform-reset-input-password"
                />
                {passwordTooShort && (
                  <p className="text-xs text-destructive">
                    Must be at least 8 characters.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="platform-confirm-password">Confirm password</Label>
                <Input
                  id="platform-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  data-testid="platform-reset-input-confirm"
                />
                {passwordMismatch && (
                  <p className="text-xs text-destructive">
                    Passwords do not match.
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={
                  !token ||
                  mutation.isPending ||
                  newPassword.length < 8 ||
                  newPassword !== confirmPassword
                }
                data-testid="platform-reset-button-confirm"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Set new password"
                )}
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-slate-500 hover:text-slate-300 underline-offset-4 hover:underline"
                onClick={() => setLocation("/platform/login")}
                data-testid="platform-reset-confirm-cancel"
              >
                Cancel
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
