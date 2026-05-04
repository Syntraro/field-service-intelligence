import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { initCSRF } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

/**
 * Auth-page prefixes — never open the dialog on top of these.
 * 2026-04-19 Portal auth fix: include portal auth pages so a stale
 * session-expired event can't cover them while the portal login flow
 * is in progress.
 * 2026-05-03 platform-auth-leak fix: include every `/platform/*`
 * path. The platform console has its own psid-cookie auth UX —
 * the tenant SessionExpiredDialog must never appear over it. The
 * upstream dispatcher in `queryClient.ts::notifySessionExpired`
 * also gates on these prefixes; this dialog-side guard is
 * belt-and-suspenders for the case where a stale event arrives
 * during a navigation gap.
 */
const AUTH_PAGE_PREFIXES = [
  "/login",
  "/signup",
  "/request-reset",
  "/reset-password",
  "/portal/login",
  "/portal/verify",
  "/platform",
];

/**
 * Listens for "session-expired" custom events (fired by queryClient on 401)
 * and shows a friendly dialog prompting the user to log in again.
 * After login, returns the user to the page they were on.
 *
 * 2026-04-10 Phase-2 Fix C: routes the click through the canonical
 * useAuth().clearAuth() instead of an ad-hoc queryClient.clear(), so the
 * AuthProvider's local user state is wiped at the same instant the cache is.
 * Also refuses to open on top of an auth page.
 */
export default function SessionExpiredDialog() {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { clearAuth } = useAuth();

  useEffect(() => {
    const handler = () => {
      // 2026-04-10 Phase-2 Fix C: belt-and-suspenders guard. The dispatcher
      // in queryClient.ts already filters by pathname, but if a stale event
      // arrives during the navigation gap we still refuse to open on top of
      // an auth page.
      const pathname = window.location.pathname;
      for (const prefix of AUTH_PAGE_PREFIXES) {
        if (pathname.startsWith(prefix)) return;
      }
      setOpen(true);
    };
    window.addEventListener("session-expired", handler);
    return () => window.removeEventListener("session-expired", handler);
  }, []);

  const handleLogin = () => {
    setOpen(false);
    // 2026-04-10 Phase-2 Fix A/C: canonical local-state wipe. Replaces the
    // previous ad-hoc queryClient.clear() so the AuthProvider's user state
    // is reset in the same render pass as the query cache.
    clearAuth();
    // Pre-warm CSRF for the login page (non-blocking)
    initCSRF().catch(() => {});
    // 2026-04-19 Portal auth fix: if the user is on a /portal page when
    // the dialog fires, route them to the portal magic-link flow — NOT
    // the staff /login page. Portal uses a separate session (req.session.portal)
    // and staff auth cannot grant portal access. The intended portal path
    // is stashed in sessionStorage so `PortalVerify` can return the user
    // to their original invoice after the magic-link round-trip.
    const pathname = window.location.pathname;
    if (pathname.startsWith("/portal/")) {
      try {
        sessionStorage.setItem("portal:returnTo", location);
      } catch {
        /* storage blocked — fall through; verify will land on /portal dashboard */
      }
      setLocation("/portal/login");
      return;
    }
    // Encode the current path so Login can redirect back after auth
    const returnTo = encodeURIComponent(location);
    setLocation(`/login?returnTo=${returnTo}`);
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Session Expired</AlertDialogTitle>
          <AlertDialogDescription>
            Your session has expired due to inactivity. Please log in again to
            continue where you left off.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleLogin}>Log In</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
