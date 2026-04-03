/** Technician PWA — Local state management (no backend, no persistence)
 *  2026-04-03: Added parts tracking, team data export.
 *  2026-04-03: Added handleReopen to support visit reopen flow after outcome. */

import { useState, useCallback } from "react";
import { INITIAL_VISITS } from "../data/mockVisits";
import type { MockVisit, MockEquipment, MockNote, MockPart, VisitStatus, Outcome } from "../types";

export function useTechState() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [visits, setVisits] = useState<MockVisit[]>(INITIAL_VISITS);

  const handleLogin = useCallback(() => setLoggedIn(true), []);

  const handleStatusChange = useCallback((id: string, newStatus: VisitStatus) => {
    setVisits(prev => prev.map(v => {
      if (v.id !== id) return v;
      const isTimerState = newStatus === "en_route" || newStatus === "in_progress";
      return {
        ...v,
        status: newStatus,
        timerRunning: isTimerState,
        workStartedAt: isTimerState && !v.workStartedAt
          ? new Date().toISOString()
          : (newStatus === "scheduled" || newStatus === "completed" || newStatus === "on_hold")
            ? undefined
            : v.workStartedAt,
      };
    }));
  }, []);

  const handleOutcome = useCallback((id: string, outcome: Outcome) => {
    setVisits(prev => prev.map(v => {
      if (v.id !== id) return v;
      const finalStatus: VisitStatus = outcome === "on_hold" ? "on_hold" : "completed";
      return { ...v, status: finalStatus, outcome, timerRunning: false, workStartedAt: undefined };
    }));
  }, []);

  const handleAddNote = useCallback((id: string, text: string, equipmentId?: string) => {
    setVisits(prev => prev.map(v => {
      if (v.id !== id) return v;
      const note: MockNote = {
        id: `n-${Date.now()}`,
        text,
        timestamp: new Date().toISOString(),
        technician: "Current Tech",
        equipmentId,
      };
      return { ...v, notes: [...v.notes, note] };
    }));
  }, []);

  const handleAddEquipment = useCallback((visitId: string, equipment: MockEquipment) => {
    setVisits(prev => prev.map(v => {
      if (v.id !== visitId) return v;
      return { ...v, equipment: [...v.equipment, equipment] };
    }));
  }, []);

  const handleRemoveEquipment = useCallback((visitId: string, equipmentId: string) => {
    setVisits(prev => prev.map(v => {
      if (v.id !== visitId) return v;
      return { ...v, equipment: v.equipment.filter(e => e.id !== equipmentId) };
    }));
  }, []);

  /** Add part to a visit, linked to specific equipment */
  const handleAddPart = useCallback((visitId: string, part: Omit<MockPart, "id">) => {
    setVisits(prev => prev.map(v => {
      if (v.id !== visitId) return v;
      const newPart: MockPart = { ...part, id: `p-${Date.now()}` };
      return { ...v, parts: [...v.parts, newPart] };
    }));
  }, []);

  /** Clear equipment-scoped notes and parts for active context (does not remove equipment from visit) */
  const handleClearEquipmentWork = useCallback((visitId: string, equipmentId: string) => {
    setVisits(prev => prev.map(v => {
      if (v.id !== visitId) return v;
      return {
        ...v,
        notes: v.notes.filter(n => n.equipmentId !== equipmentId),
        parts: v.parts.filter(p => p.equipmentId !== equipmentId),
      };
    }));
  }, []);

  /** Reopen a visit that already has an outcome — returns it to in_progress */
  const handleReopen = useCallback((id: string) => {
    setVisits(prev => prev.map(v => {
      if (v.id !== id) return v;
      return {
        ...v,
        status: "in_progress" as VisitStatus,
        outcome: undefined,
        timerRunning: true,
        workStartedAt: v.workStartedAt || new Date().toISOString(),
      };
    }));
  }, []);

  const activeVisit = visits.find(v => v.status === "in_progress" || v.status === "en_route");

  return {
    loggedIn, visits, activeVisit,
    handleLogin, handleStatusChange, handleOutcome, handleReopen,
    handleAddNote, handleAddEquipment, handleRemoveEquipment, handleAddPart,
    handleClearEquipmentWork,
  };
}
