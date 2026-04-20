/**
 * PortalLayout — Mobile-first shell for customer portal pages.
 *
 * 2026-04-19 Polish pass:
 *   - Branded header with tenant name + customer-company subtitle for
 *     immediate "am I in the right place?" trust.
 *   - Trust footer with tenant phone/email (tap-to-call / tap-to-email).
 *   - Bottom-nav tap targets enlarged to the 44px guideline.
 *   - No logo yet — there is no `companies.logoFileId` column; see the
 *     polish-pass "missing blocker" note in the changelog.
 */

import { Link, useLocation } from "wouter";
import { usePortalAuth } from "@/lib/portalAuth";
import { FileText, Home, LogOut, Phone, Mail, Shield } from "lucide-react";
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
    <div className="flex flex-col min-h-screen bg-[#F4F8F4]">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 h-16 max-w-3xl mx-auto">
          <Link href="/portal" className="min-w-0 flex items-center gap-2 group">
            {/* Brand monogram — first letter of the tenant name. Acts as a
                logo placeholder until an uploaded logo column exists. */}
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[#76B054] text-white text-sm font-semibold shrink-0 shadow-sm">
              {(user?.companyName?.charAt(0) || "·").toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-slate-900 leading-tight truncate">
                {user?.companyName || "Customer Portal"}
              </span>
              {user?.customerCompanyName && (
                <span className="block text-xs text-slate-500 leading-tight truncate">
                  Account · {user.customerCompanyName}
                </span>
              )}
            </span>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm text-slate-700 hidden sm:inline">
              {user?.firstName} {user?.lastName}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Sign out"
              className="h-10 w-10 hidden sm:inline-flex"
              data-testid="portal-logout-header"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-6 max-w-3xl mx-auto w-full">{children}</main>

      {/* ── Trust footer ───────────────────────────────────────────── */}
      {(user?.companyPhone || user?.companyEmail) && (
        <footer className="bg-white border-t border-slate-200 hidden sm:block">
          <div className="px-4 py-4 max-w-3xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-slate-400" />
                <span>Secure customer portal · Powered by {user?.companyName}</span>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {user?.companyPhone && (
                  <a
                    href={`tel:${user.companyPhone}`}
                    className="inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors"
                    data-testid="portal-contact-phone"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {user.companyPhone}
                  </a>
                )}
                {user?.companyEmail && (
                  <a
                    href={`mailto:${user.companyEmail}`}
                    className="inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors"
                    data-testid="portal-contact-email"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {user.companyEmail}
                  </a>
                )}
              </div>
            </div>
          </div>
        </footer>
      )}

      {/* ── Mobile trust strip — sits ABOVE the bottom nav ─────────── */}
      {(user?.companyPhone || user?.companyEmail) && (
        <div className="bg-white border-t border-slate-200 sm:hidden">
          <div className="px-4 py-2 flex items-center justify-around text-xs text-slate-600">
            {user?.companyPhone && (
              <a
                href={`tel:${user.companyPhone}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md hover:bg-slate-50 transition-colors min-h-[44px]"
                data-testid="portal-contact-phone-mobile"
              >
                <Phone className="h-4 w-4" />
                <span>Call</span>
              </a>
            )}
            {user?.companyEmail && (
              <a
                href={`mailto:${user.companyEmail}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md hover:bg-slate-50 transition-colors min-h-[44px]"
                data-testid="portal-contact-email-mobile"
              >
                <Mail className="h-4 w-4" />
                <span>Email</span>
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom nav (mobile-first) ──────────────────────────────── */}
      <nav className="sticky bottom-0 z-30 bg-white border-t border-slate-200 sm:hidden">
        <div className="flex justify-around">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = location === href || (href !== "/portal" && location.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] px-3 active:bg-slate-50"
              >
                <Icon className={`h-5 w-5 ${isActive ? "text-[#76B054]" : "text-slate-400"}`} />
                <span className={`text-xs ${isActive ? "text-[#76B054] font-semibold" : "text-slate-500"}`}>
                  {label}
                </span>
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] px-3 active:bg-slate-50"
            data-testid="portal-logout-mobile"
          >
            <LogOut className="h-5 w-5 text-slate-400" />
            <span className="text-xs text-slate-500">Sign out</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
