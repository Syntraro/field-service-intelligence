/**
 * PortalLogin — Customer enters email to request a magic link.
 * Mobile-first, simple, no password fields.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

export default function PortalLogin() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [deliveryFailed, setDeliveryFailed] = useState(false);

  const requestLink = useMutation({
    mutationFn: () =>
      apiRequest<{ message: string; sent: boolean }>("/api/portal/auth/request-link", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      }),
    onSuccess: (data) => {
      if (data.sent === false) {
        setDeliveryFailed(true);
      } else {
        setSent(true);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) requestLink.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F8F4] px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Customer Portal</CardTitle>
          <CardDescription>
            Sign in to view your invoices and account
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deliveryFailed ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <AlertTriangle className="h-12 w-12 text-amber-500" />
              <div>
                <p className="font-medium text-lg">Email delivery unavailable</p>
                <p className="text-muted-foreground mt-1">
                  Email delivery is not configured right now. Please contact support.
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => { setDeliveryFailed(false); setEmail(""); }}
                className="mt-2"
              >
                Try again
              </Button>
            </div>
          ) : sent ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div>
                <p className="font-medium text-lg">Check your email</p>
                <p className="text-muted-foreground mt-1">
                  If an account exists for <strong>{email}</strong>, we sent a login link.
                  It expires in 15 minutes.
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => { setSent(false); setEmail(""); }}
                className="mt-2"
              >
                Try a different email
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    autoFocus
                    autoComplete="email"
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={requestLink.isPending || !email.trim()}
              >
                {requestLink.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send login link"
                )}
              </Button>
              {requestLink.isError && (
                <p className="text-sm text-destructive text-center">
                  Something went wrong. Please try again.
                </p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
