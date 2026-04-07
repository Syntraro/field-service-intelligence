/**
 * Technician PWA — Login screen.
 * 2026-03-26: Branded login with Syntraro identity. Dark navy background.
 * 2026-04-03: Replaced placeholder SVG with canonical app logo asset.
 * 2026-04-04: Phase 0 — wired to real backend auth via useAuth().
 *   Calls POST /api/auth/login. Shows server error messages.
 */

import { useState } from "react";
import { Mail, Lock, Loader2 } from "lucide-react";
import syntaroLogo from "@/assets/Syntraro Logo Transparent.png";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
  /** Error message from last login attempt */
  error: string | null;
  /** Whether a login request is in-flight */
  isLoading: boolean;
}

export function LoginPage({ onLogin, error, isLoading }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async () => {
    if (!email.trim() || !password || isLoading) return;
    await onLogin(email.trim(), password);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto bg-[#0f1a2e]">
      {/* Brand lockup */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pt-16 pb-8">
        <div className="mb-6">
          <img src={syntaroLogo} alt="Syntraro" className="h-12 w-auto object-contain" />
        </div>
        <p className="text-sm text-slate-400 tracking-wide">Field Service Intelligence</p>
      </div>

      {/* Login form */}
      <div className="bg-white rounded-t-3xl px-8 pt-10 pb-12 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-900 mb-1">Sign in</h2>
        <p className="text-sm text-slate-500 mb-8">Enter your credentials to continue</p>

        <div className="space-y-5">
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 block">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="you@company.com"
                autoComplete="email"
                disabled={isLoading}
                className="w-full h-12 rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40 focus:border-[#22c55e] transition-shadow disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5 block">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter password"
                autoComplete="current-password"
                disabled={isLoading}
                className="w-full h-12 rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#22c55e]/40 focus:border-[#22c55e] transition-shadow disabled:opacity-60"
              />
            </div>
          </div>

          {/* Server error display */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={isLoading || !email.trim() || !password}
            className="w-full h-12 rounded-xl bg-[#22c55e] text-white font-semibold text-sm hover:bg-[#1db350] active:scale-[0.98] transition-all shadow-lg shadow-[#22c55e]/25 disabled:opacity-60 disabled:active:scale-100 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </div>

        <p className="text-sm text-center text-slate-400 mt-8">Syntraro Field Service Platform</p>
      </div>
    </div>
  );
}
