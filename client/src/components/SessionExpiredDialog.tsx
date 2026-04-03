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
import { queryClient, initCSRF } from "@/lib/queryClient";

/**
 * Listens for "session-expired" custom events (fired by queryClient on 401)
 * and shows a friendly dialog prompting the user to log in again.
 * After login, returns the user to the page they were on.
 */
export default function SessionExpiredDialog() {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("session-expired", handler);
    return () => window.removeEventListener("session-expired", handler);
  }, []);

  const handleLogin = () => {
    setOpen(false);
    queryClient.clear();
    // Pre-warm CSRF for the login page (non-blocking)
    initCSRF().catch(() => {});
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
