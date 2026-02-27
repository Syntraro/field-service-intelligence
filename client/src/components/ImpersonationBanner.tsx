import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, User, Building2, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ImpersonationStatus {
  isImpersonating: boolean;
  session?: {
    sessionId: string;
    targetUserId: string;
    targetUserEmail?: string;
    targetUserName?: string;
    targetCompanyId: string;
    targetCompanyName?: string;
    ownerEmail: string;
    reason: string;
    startedAt: number;
    expiresAt: number;
    remainingTime: { minutes: number; seconds: number } | null;
    idleTimeRemaining: { minutes: number; seconds: number } | null;
  };
}

export function ImpersonationBanner() {
  const { toast } = useToast();
  const [now, setNow] = useState(Date.now());

  // Poll admin impersonation status every 5 seconds
  const { data: status } = useQuery<ImpersonationStatus>({
    queryKey: ["/api/admin/impersonate/status"],
    refetchInterval: 5000,
    staleTime: 0,
    retry: false,
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
    mutationFn: () => apiRequest("/api/admin/impersonate/stop", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/impersonate/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: "Support mode ended",
        description: "You've returned to your admin account",
      });
      // Force page reload to reset user context
      window.location.reload();
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to exit support mode",
      });
    },
  });

  if (!status?.isImpersonating || !status.session) {
    return null;
  }

  const { session } = status;
  const expiryMinutes = Math.max(0, Math.floor((session.expiresAt - now) / 60000));
  const expirySeconds = Math.max(0, Math.floor(((session.expiresAt - now) % 60000) / 1000));

  const idleMinutes = session.idleTimeRemaining?.minutes ?? 0;
  const idleSeconds = session.idleTimeRemaining?.seconds ?? 0;

  // Show warning when less than 5 minutes remaining
  const showWarning = expiryMinutes < 5;

  return (
    <div
      className={`${
        showWarning ? 'bg-destructive' : 'bg-orange-500'
      } text-white shadow-lg`}
      data-testid="impersonation-banner"
    >
      <div className="container max-w-screen-2xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span className="font-semibold">
                  Support Mode: {session.targetUserName || session.targetUserEmail}
                </span>
              </div>
              {session.targetCompanyName && (
                <div className="flex items-center gap-1 text-sm opacity-90">
                  <Building2 className="w-3 h-3" />
                  <span>{session.targetCompanyName}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>
                  {expiryMinutes}m {expirySeconds}s
                </span>
              </div>
              {session.idleTimeRemaining && (
                <div className="hidden sm:flex items-center gap-2">
                  <span className="opacity-75">
                    Idle: {idleMinutes}m {idleSeconds}s
                  </span>
                </div>
              )}
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
              Exit Support Mode
            </Button>
          </div>
        </div>

        {session.reason && (
          <div className="mt-1 text-sm opacity-90 flex items-start gap-2">
            <span className="font-medium">Reason:</span>
            <span>{session.reason}</span>
          </div>
        )}
      </div>
    </div>
  );
}
