/**
 * Technician PWA — App Shell
 *
 * 2026-04-04: Phase 0 — real backend auth via useAuth().
 * 2026-04-04: Phase 1 — Today page uses real backend visits.
 * 2026-04-04: Phase 2 — Visit Detail fetches its own data + core actions wired.
 *   Removed mock visit state (useTechState) — no longer needed.
 *   VisitDetailPage receives visitId and fetches from backend.
 */

import { useState, useCallback } from "react";
import { Switch, Route, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { LoginPage } from "../pages/LoginPage";
import { TodayPage } from "../pages/TodayPage";
import { VisitDetailPage } from "../pages/VisitDetailPage";
import { CreateJobPage } from "../pages/CreateJobPage";
import { CreateClientPage } from "../pages/CreateClientPage";
import { CreateTaskPage } from "../pages/CreateTaskPage";
import TimesheetPage from "../pages/TimesheetPage";
import { SearchPage } from "../pages/SearchPage";
import { CreateLeadPage } from "../pages/CreateLeadPage";
import { LocationDetailPage } from "../pages/LocationDetailPage";
import { TaskDetailPage } from "../pages/TaskDetailPage";
import { useTechRealtimeSync } from "../hooks/useTechRealtimeSync";

/** Loading spinner shown during session restore */
function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f1a2e]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    </div>
  );
}

export default function TechApp() {
  const [, setLocation] = useLocation();
  const { user, isLoading: authLoading, login, logout } = useAuth();

  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);

  const handleLogin = useCallback(async (email: string, password: string) => {
    setLoginError(null);
    setLoginPending(true);
    try {
      await login(email, password);
      setLocation("/tech/today");
    } catch (err: any) {
      setLoginError(err?.message || "Login failed. Please check your credentials.");
    } finally {
      setLoginPending(false);
    }
  }, [login, setLocation]);

  // Real-time sync: SSE connection for dispatch + time events (only when authenticated)
  useTechRealtimeSync();

  if (authLoading) return <AuthLoading />;

  if (!user) {
    return (
      <LoginPage
        onLogin={handleLogin}
        error={loginError}
        isLoading={loginPending}
      />
    );
  }

  return (
    <Switch>
      <Route path="/tech/login">
        {() => { setLocation("/tech/today"); return null; }}
      </Route>

      <Route path="/tech/today">
        <TodayPage onVisitTap={(id) => setLocation(`/tech/visit/${id}`)} />
      </Route>

      <Route path="/tech/timesheet">
        <TimesheetPage />
      </Route>

      <Route path="/tech/create-job">
        <CreateJobPage />
      </Route>

      <Route path="/tech/create-client">
        <CreateClientPage />
      </Route>

      <Route path="/tech/search">
        <SearchPage />
      </Route>

      <Route path="/tech/create-lead">
        <CreateLeadPage />
      </Route>

      <Route path="/tech/create-task">
        <CreateTaskPage />
      </Route>

      <Route path="/tech/location/:id">
        {(params) => <LocationDetailPage />}
      </Route>

      <Route path="/tech/tasks/:id">
        {(params) => <TaskDetailPage taskId={params.id} />}
      </Route>

      <Route path="/tech/visit/:id">
        {(params) => <VisitDetailPage visitId={params.id} />}
      </Route>

      <Route>
        {() => { setLocation("/tech/today"); return null; }}
      </Route>
    </Switch>
  );
}
