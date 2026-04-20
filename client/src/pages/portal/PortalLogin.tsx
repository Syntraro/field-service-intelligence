/**
 * PortalLogin — Customer enters email to request a magic link.
 *
 * 2026-04-19 Polish pass: trust badge, tighter typography, visibly large
 * tap target, richer success state.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, CheckCircle2, Loader2, AlertTriangle, Shield } from "lucide-react";

export default function PortalLogin() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  // 2026-04-19 Portal login debug: track a server-emitted error message +
  // code so the generic "Something went wrong" state can be replaced
  // with something actionable when the backend tells us why.
  const [requestError, setRequestError] = useState<{ code?: string; message: string } | null>(
    null,
  );

  const requestLink = useMutation({
    mutationFn: () =>
      apiRequest<{ message: string; sent: boolean }>("/api/portal/auth/request-link", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      }),
    onSuccess: (data) => {
      setRequestError(null);
      if (data.sent === false) {
        setDeliveryFailed(true);
      } else {
        setSent(true);
      }
    },
    onError: (err: unknown) => {
      // Preserve the server-sent code + message so the UI can tell the
      // user something useful (e.g. "customer portal not enabled for this
      // workspace"). Fall back to a generic message otherwise.
      if (isApiError(err)) {
        setRequestError({ code: err.code, message: err.message });
      } else {
        setRequestError({ message: err instanceof Error ? err.message : "Request failed" });
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) requestLink.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F8F4] px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto h-12 w-12 rounded-full bg-[#76B054]/10 flex items-center justify-center">
              <Shield className="h-6 w-6 text-[#76B054]" />
            </div>
            <CardTitle className="text-2xl tracking-tight">Customer Portal</CardTitle>
            <CardDescription className="text-sm">
              Sign in with your email — we'll send a one-time link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {deliveryFailed ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <AlertTriangle className="h-12 w-12 text-amber-500" />
                <div>
                  <p className="font-semibold text-lg text-slate-900">Email delivery unavailable</p>
                  <p className="text-sm text-slate-600 mt-1">
                    Email delivery is not configured right now. Please contact support.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => { setDeliveryFailed(false); setEmail(""); }}
                  className="mt-2 h-11"
                >
                  Try again
                </Button>
              </div>
            ) : requestError?.code === "PORTAL_DISABLED" ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center" data-testid="portal-login-disabled">
                <AlertTriangle className="h-12 w-12 text-amber-500" />
                <div>
                  <p className="font-semibold text-lg text-slate-900">Portal not available</p>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    The customer portal is not enabled for this workspace. Please contact the
                    business that issued your invoice — they can enable it or send you an invoice
                    PDF directly.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => { setRequestError(null); setEmail(""); }}
                  className="mt-2 h-11"
                >
                  Try a different email
                </Button>
              </div>
            ) : sent ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                <div>
                  <p className="font-semibold text-lg text-slate-900">Check your email</p>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    If an account exists for <strong className="text-slate-900">{email}</strong>, we sent a sign-in link.
                    It expires in <strong>15 minutes</strong> and can only be used once.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => { setSent(false); setEmail(""); }}
                  className="mt-1 h-11"
                >
                  Try a different email
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-slate-700">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 h-11"
                      required
                      autoFocus
                      autoComplete="email"
                      inputMode="email"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full h-11 bg-[#76B054] hover:bg-[#6aa147] text-white"
                  disabled={requestLink.isPending || !email.trim()}
                  data-testid="portal-login-submit"
                >
                  {requestLink.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Send sign-in link"
                  )}
                </Button>
                {requestLink.isError && requestError && (
                  <p className="text-sm text-red-600 text-center" data-testid="portal-login-error">
                    {/*
                      Surface the server's error message so operational
                      failures are visible to the user (and to us in
                      support channels) instead of the former blanket
                      "Something went wrong. Please try again." The
                      `PORTAL_DISABLED` case is already handled above
                      with its own dedicated state.
                    */}
                    {requestError.message || "Could not send the sign-in link. Please try again."}
                  </p>
                )}
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-500 flex items-center justify-center gap-1.5">
          <Shield className="h-3 w-3" />
          Secure sign-in — no passwords, no tracking.
        </p>
      </div>
    </div>
  );
}
