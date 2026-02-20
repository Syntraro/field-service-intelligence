/**
 * PortalLayout — Mobile-first shell for customer portal pages.
 * Minimal nav: Dashboard, Invoices, Account (logout).
 */

import { Link, useLocation } from "wouter";
import { usePortalAuth } from "@/lib/portalAuth";
import { FileText, Home, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PortalLayoutProps {
  children: React.ReactNode;
}

export default function PortalLayout({ children }: PortalLayoutProps) {
  const [location] = useLocation();
  const { user, logout } = usePortalAuth();

  const handleLogout = async () => {
    await logout();
    window.location.href = "/portal/login";
  };

  const navItems = [
    { href: "/portal", label: "Home", icon: Home },
    { href: "/portal/invoices", label: "Invoices", icon: FileText },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b shadow-sm">
        <div className="flex items-center justify-between px-4 h-14 max-w-3xl mx-auto">
          <Link href="/portal" className="font-semibold text-lg truncate max-w-[200px]">
            {user?.companyName || "Customer Portal"}
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user?.firstName} {user?.lastName}
            </span>
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-6 max-w-3xl mx-auto w-full">
        {children}
      </main>

      {/* Bottom nav (mobile-first) */}
      <nav className="sticky bottom-0 bg-white border-t sm:hidden">
        <div className="flex justify-around py-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = location === href || (href !== "/portal" && location.startsWith(href));
            return (
              <Link key={href} href={href} className="flex flex-col items-center gap-0.5 px-3 py-1">
                <Icon className={`h-5 w-5 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`text-xs ${isActive ? "text-primary font-medium" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </Link>
            );
          })}
          <button onClick={handleLogout} className="flex flex-col items-center gap-0.5 px-3 py-1">
            <LogOut className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Logout</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
