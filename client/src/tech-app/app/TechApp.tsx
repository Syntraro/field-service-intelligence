/**
 * Technician PWA — App Shell
 *
 * Self-contained routing + state management.
 * No backend. No real auth. No office app imports.
 * 2026-04-03: Added handleAddPart to state wiring.
 * 2026-04-03: Added handleReopen for visit reopen flow.
 */

import { Switch, Route, useLocation } from "wouter";
import { useTechState } from "../state/useTechState";
import { LoginPage } from "../pages/LoginPage";
import { TodayPage } from "../pages/TodayPage";
import { VisitDetailPage } from "../pages/VisitDetailPage";

export default function TechApp() {
  const [, setLocation] = useLocation();
  const {
    loggedIn, visits,
    handleLogin, handleStatusChange, handleOutcome, handleReopen,
    handleAddNote, handleAddEquipment, handleRemoveEquipment, handleAddPart,
    handleClearEquipmentWork,
  } = useTechState();

  return (
    <Switch>
      <Route path="/tech/login">
        <LoginPage onLogin={() => { handleLogin(); setLocation("/tech/today"); }} />
      </Route>

      <Route path="/tech/today">
        {loggedIn ? (
          <TodayPage visits={visits} onVisitTap={(id) => setLocation(`/tech/visit/${id}`)} />
        ) : (
          <LoginPage onLogin={() => { handleLogin(); setLocation("/tech/today"); }} />
        )}
      </Route>

      <Route path="/tech/visit/:id">
        {(params) => {
          const visit = visits.find(v => v.id === params.id);
          if (!visit || !loggedIn) {
            setLocation("/tech/today");
            return null;
          }
          return (
            <VisitDetailPage
              visit={visit}
              onBack={() => setLocation("/tech/today")}
              onStatusChange={handleStatusChange}
              onOutcome={handleOutcome}
              onReopen={handleReopen}
              onAddNote={handleAddNote}
              onAddEquipment={handleAddEquipment}
              onRemoveEquipment={handleRemoveEquipment}
              onAddPart={handleAddPart}
              onClearEquipmentWork={handleClearEquipmentWork}
            />
          );
        }}
      </Route>

      <Route>
        <LoginPage onLogin={() => { handleLogin(); setLocation("/tech/today"); }} />
      </Route>
    </Switch>
  );
}
