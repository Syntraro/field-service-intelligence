/**
 * PortalVerify — Consumes magic link token, then redirects to /portal.
 * Shown briefly while verifying the token.
 */

import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";

export default function PortalVerify() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("token");

    if (!token) {
      setError("No token provided");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/portal/auth/verify?token=${encodeURIComponent(token)}`, {
          credentials: "include",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Invalid or expired link");
          return;
        }
        // Invalidate portal/me so PortalAuthProvider picks up the new session
        queryClient.invalidateQueries({ queryKey: ["/api/portal/me"] });
        // 2026-04-19 Portal auth fix: preserve intended destination. When a
        // user arrives at a protected portal page (e.g. /portal/invoices/:id)
        // without a session, `PortalProtected` stashes the path in
        // sessionStorage before redirecting to login. Restore it here so the
        // customer lands on the invoice they originally clicked, not the
        // dashboard. Only trust paths that start with /portal/ — defensive
        // against tampering. Cleared on read so it doesn't leak across logins.
        let target = "/portal";
        try {
          const stashed = sessionStorage.getItem("portal:returnTo");
          sessionStorage.removeItem("portal:returnTo");
          if (stashed && stashed.startsWith("/portal/")) {
            target = stashed;
          }
        } catch {
          /* storage blocked — fall back to dashboard */
        }
        setLocation(target);
      } catch {
        setError("Something went wrong. Please try again.");
      }
    })();
  }, [search, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {error ? (
            <>
              <XCircle className="h-12 w-12 text-destructive" />
              <div>
                <p className="font-medium text-lg">Login failed</p>
                <p className="text-muted-foreground mt-1">{error}</p>
              </div>
              <Button onClick={() => setLocation("/portal/login")} className="mt-2">
                Back to login
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-muted-foreground">Verifying your login link...</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
