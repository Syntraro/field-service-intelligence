/**
 * TechMorePage — Profile and settings for the technician field app.
 * Shows user info and logout button. Minimal — no admin clutter.
 */
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LogOut, User, Building2 } from "lucide-react";

export default function TechMorePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    await logout();
    setLocation("/tech/login");
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">More</h1>

      {/* Profile card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {user?.firstName
                  ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
                  : user?.email}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <p className="font-medium capitalize">{user?.role || "Technician"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logout */}
      <Button
        variant="outline"
        className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={handleLogout}
      >
        <LogOut className="h-4 w-4" />
        Sign Out
      </Button>

      <p className="text-[11px] text-muted-foreground/50 text-center pt-4">
        Technician Field App v1.0
      </p>
    </div>
  );
}
