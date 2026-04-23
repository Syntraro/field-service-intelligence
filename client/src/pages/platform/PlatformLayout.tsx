/**
 * Platform Ops Portal layout.
 *
 * 2026-04-22 Revised Phase 1 Internal Console Separation: nav items are
 * capability-conditional. Users see only the sections their role grants
 * them via the canonical capability registry (`shared/platformCapabilities`).
 * No admin-vs-support console split — one console, variable visibility.
 */

import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  MessageSquare,
  Bug,
  LifeBuoy,
  Shield,
  Package,
  Layers,
  Clock,
  History,
} from "lucide-react";
import type { PlatformCapability } from "@shared/platformCapabilities";
import { usePlatformAuth } from "@/lib/platformAuth";

interface Props {
  children: React.ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof Building2;
  /**
   * Capability required to see this nav entry. Keeping one capability per
   * nav entry rather than any/all lists — if a future surface needs a mix
   * (e.g. "bulk-runs visible to anyone with bulk:history:read"), use the
   * narrowest capability that implies visibility.
   */
  cap: PlatformCapability;
}

const NAV: NavItem[] = [
  { href: "/platform/tenants",          label: "Tenants",          icon: Building2,    cap: "tenant:read" },
  { href: "/platform/trials",           label: "Trials",           icon: Clock,        cap: "tenant:read" },
  { href: "/platform/plans",            label: "Plans",            icon: Package,      cap: "plan:write" },
  { href: "/platform/features",         label: "Features",         icon: Layers,       cap: "feature:catalog:write" },
  { href: "/platform/feedback",         label: "Feedback",         icon: MessageSquare, cap: "feedback:triage" },
  { href: "/platform/issues",           label: "Issues",           icon: Bug,          cap: "feedback:triage" },
  { href: "/platform/support-sessions", label: "Support Sessions", icon: LifeBuoy,     cap: "support:session:manage" },
  { href: "/platform/bulk-runs",        label: "Bulk Runs",        icon: History,      cap: "bulk:history:read" },
];

export function PlatformLayout({ children }: Props) {
  const [location] = useLocation();
  const { hasCapability } = usePlatformAuth();

  const visibleNav = NAV.filter((item) => hasCapability(item.cap));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="flex items-center gap-4 px-6 py-3">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Platform Ops</h1>
          <Badge variant="secondary">Internal</Badge>
          <nav className="ml-4 flex gap-1">
            {visibleNav.map((item) => {
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
