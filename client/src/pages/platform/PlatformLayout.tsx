/**
 * Platform Ops Portal layout — Phase 6.
 *
 * Minimal shell for /platform/* routes. Uses the same Card/Button primitives
 * as the tenant app; the nav is rendered inline (no changes to tenant
 * AppSidebar so there is zero leakage risk for non-platform users).
 */

import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, MessageSquare, Bug, LifeBuoy, Shield, Package, Layers } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

const NAV = [
  { href: "/platform/tenants", label: "Tenants", icon: Building2 },
  { href: "/platform/plans", label: "Plans", icon: Package },
  { href: "/platform/features", label: "Features", icon: Layers },
  { href: "/platform/feedback", label: "Feedback", icon: MessageSquare },
  { href: "/platform/issues", label: "Issues", icon: Bug },
  { href: "/platform/support-sessions", label: "Support Sessions", icon: LifeBuoy },
];

export function PlatformLayout({ children }: Props) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="flex items-center gap-4 px-6 py-3">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Platform Ops</h1>
          <Badge variant="secondary">Internal</Badge>
          <nav className="ml-4 flex gap-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = location.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-2"
                    data-testid={`platform-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
