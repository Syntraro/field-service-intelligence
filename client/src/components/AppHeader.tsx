/**
 * AppHeader - Main application header with navigation and universal search
 *
 * Renders the standard header layout including:
 * - Company name/logo
 * - Navigation tabs
 * - Universal search
 * - Quick actions (Add Client, Notifications, Settings, Logout)
 */

import { Button } from "@/components/ui/button";
import { LayoutDashboard, LogOut, Shield, Settings, Calendar as CalendarIcon, Plus, Users, Package, FileText, MessageCircle, Activity } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { CompanySettings } from "@shared/schema";
import { useState } from "react";
import FeedbackDialog from "./FeedbackDialog";
import QuickAddClientModal from "./QuickAddClientModal";
import NotificationBell from "./NotificationBell";
import UniversalSearch from "./UniversalSearch";
import { ActivityFeedDrawer } from "./activity/ActivityFeedDrawer";

interface AppHeaderProps {
  onAddClient?: () => void;
  onDashboardClick?: () => void;
}

export default function AppHeader({ onAddClient, onDashboardClick }: AppHeaderProps) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [addClientModalOpen, setAddClientModalOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const handleClientCreated = (clientId: string, _companyId?: string) => {
    setLocation(`/clients/${clientId}`);
  };

  const { data: companySettings } = useQuery<CompanySettings | null>({
    queryKey: ["/api/company-settings"],
    enabled: Boolean(user?.id),
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const handleLogout = async () => {
    try {
      await logout();
      setLocation("/login");
      toast({
        title: "Logged out",
        description: "You have been successfully logged out",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Logout failed",
        description: "Could not log out. Please try again.",
      });
    }
  };

  // Check if on clients page
  const isClientsPage = location === "/clients" || location.startsWith("/clients/");

  return (
    <header className="border-b bg-background sticky top-0 z-50 shadow-sm">
      <div className="mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-foreground">
              {companySettings?.companyName || "HVAC/R Scheduler"}
            </h1>
            <nav className="flex gap-1 bg-muted/50 p-1 rounded-full">
              <Button
                variant={location === "/" && !isClientsPage ? "default" : "ghost"}
                size="sm"
                className={`rounded-full ${location === "/" && !isClientsPage ? "" : "hover:bg-background/60"}`}
                data-testid="nav-dashboard"
                onClick={() => {
                  if (onDashboardClick) {
                    onDashboardClick();
                  } else {
                    setLocation('/');
                  }
                }}
              >
                <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
                Dashboard
              </Button>
              <Link href="/calendar">
                <Button
                  variant={location === "/calendar" ? "default" : "ghost"}
                  size="sm"
                  className={`rounded-full ${location === "/calendar" ? "" : "hover:bg-background/60"}`}
                  data-testid="nav-calendar"
                >
                  <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                  Calendar
                </Button>
              </Link>
              <Button
                variant={isClientsPage ? "default" : "ghost"}
                size="sm"
                className={`rounded-full ${isClientsPage ? "" : "hover:bg-background/60"}`}
                data-testid="nav-all-clients"
                onClick={() => {
                  setLocation('/clients');
                }}
              >
                <Users className="h-3.5 w-3.5 mr-1.5" />
                All Clients
              </Button>
              <Link href="/manage-parts">
                <Button
                  variant={location === "/manage-parts" ? "default" : "ghost"}
                  size="sm"
                  className={`rounded-full ${location === "/manage-parts" ? "" : "hover:bg-background/60"}`}
                  data-testid="nav-parts"
                >
                  <Package className="h-3.5 w-3.5 mr-1.5" />
                  Parts
                </Button>
              </Link>
              <Link href="/reports">
                <Button
                  variant={location === "/reports" ? "default" : "ghost"}
                  size="sm"
                  className={`rounded-full ${location === "/reports" ? "" : "hover:bg-background/60"}`}
                  data-testid="nav-reports"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Reports
                </Button>
              </Link>
              {user?.isAdmin && (
                <Link href="/admin">
                  <Button
                    variant={location === "/admin" ? "default" : "ghost"}
                    size="sm"
                    className={`rounded-full ${location === "/admin" ? "" : "hover:bg-background/60"}`}
                    data-testid="nav-admin"
                  >
                    <Shield className="h-3.5 w-3.5 mr-1.5" />
                    Admin
                  </Button>
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <UniversalSearch />
            <Button
              variant="default"
              size="sm"
              onClick={() => setAddClientModalOpen(true)}
              data-testid="button-add-client"
              className="h-8 gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Client</span>
            </Button>
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setActivityOpen(true)}
              data-testid="button-activity-feed"
              className="h-8 w-8"
              title="Recent Activity"
            >
              <Activity className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFeedbackOpen(true)}
              data-testid="button-feedback"
              className="h-8 w-8"
            >
              <MessageCircle className="h-4 w-4" />
            </Button>
            <Link href="/company-settings">
              <Button
                variant="ghost"
                size="icon"
                data-testid="button-settings-header"
                className="h-8 w-8"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              data-testid="button-logout"
              className="h-8 w-8"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <QuickAddClientModal
        open={addClientModalOpen}
        onOpenChange={setAddClientModalOpen}
        onSuccess={handleClientCreated}
      />
      <ActivityFeedDrawer open={activityOpen} onOpenChange={setActivityOpen} />
    </header>
  );
}
