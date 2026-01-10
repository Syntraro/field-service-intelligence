import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, User, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ImpersonationStatus {
  isImpersonating: boolean;
  session?: {
    targetUserId: string;
    targetCompanyId: string;
    platformAdminEmail: string;
    reason: string;
    startedAt: number;
    expiresAt: number;
    remainingTime: { minutes: number; seconds: number };
    idleTimeRemaining: { minutes: number; seconds: number };
  };
}

export function ImpersonationBanner() {
  const { toast } = useToast();
  const [now, setNow] = useState(Date.now());

  // Poll impersonation status every 5 seconds
  const { data: status } = useQuery<ImpersonationStatus>({
    queryKey: ["/api/impersonation/status"],
    refetchInterval: 5000,
    staleTime: 0,
  });

  // Update timer every second
  useEffect(() => {
    if (!status?.isImpersonating) return;

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [status?.isImpersonating]);

  const stopImpersonation = useMutation({
    mutationFn: () => apiRequest("/api/impersonation/stop", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/impersonation/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Impersonation ended",
        description: "You've returned to your platform admin account",
      });
      // Force page reload to reset user context
      window.location.reload();
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to stop impersonation",
      });
    },
  });

  if (!status?.isImpersonating || !status.session) {
    return null;
  }

  const { session } = status;
  const expiryMinutes = Math.max(0, Math.floor((session.expiresAt - now) / 60000));
  const expirySeconds = Math.max(0, Math.floor(((session.expiresAt - now) % 60000) / 1000));
  
  const idleMinutes = session.idleTimeRemaining.minutes;
  const idleSeconds = session.idleTimeRemaining.seconds;

  // Show warning when less than 5 minutes remaining
  const showWarning = expiryMinutes < 5;

  return (
    <div 
      className={`fixed top-0 left-0 right-0 z-50 ${
        showWarning ? 'bg-destructive' : 'bg-orange-500'
      } text-white shadow-lg`}
      data-testid="impersonation-banner"
    >
      <div className="container max-w-screen-2xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span className="font-semibold">
                  Impersonating User
                </span>
              </div>
              <span className="text-sm opacity-90">
                Platform Admin: {session.platformAdminEmail}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>
                  Session: {expiryMinutes}m {expirySeconds}s
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="opacity-75">
                  Idle: {idleMinutes}m {idleSeconds}s
                </span>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => stopImpersonation.mutate()}
              disabled={stopImpersonation.isPending}
              className="bg-white/20 hover:bg-white/30 text-white"
              data-testid="button-stop-impersonation"
            >
              <X className="w-4 h-4 mr-2" />
              Stop Impersonation
            </Button>
          </div>
        </div>

        {session.reason && (
          <div className="mt-2 text-sm opacity-90 flex items-start gap-2">
            <span className="font-medium">Reason:</span>
            <span>{session.reason}</span>
          </div>
        )}
      </div>
    </div>
  );
}
