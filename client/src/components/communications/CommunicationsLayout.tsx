/**
 * Communications Hub — 4-region desktop shell.
 *
 *   ┌─list────┬────────center────────┬─details──┬─rail─┐
 *   │ 340px   │ flex-1 (priority)    │ ≤360px   │ 72px │
 *   └─────────┴──────────────────────┴──────────┴──────┘
 *
 * Responsive collapses (Tailwind defaults):
 *   • `<md` — only the center panel renders.
 *   • `<lg` — center + list; rail hidden.
 *   • `<xl` — center + list + rail; details panel hidden.
 *   • `xl+` — full four regions.
 *
 * The center column gets `flex-1 min-w-0` so it always wins width
 * negotiation against the side rails — readability over chrome.
 *
 * This component is purely structural — it renders whatever children
 * the page hands it in each slot. No data, no permissions logic here.
 */

import type { ReactNode } from "react";

interface CommunicationsLayoutProps {
  list: ReactNode;
  center: ReactNode;
  details: ReactNode;
  rail: ReactNode;
}

export function CommunicationsLayout({
  list,
  center,
  details,
  rail,
}: CommunicationsLayoutProps) {
  return (
    <div
      className="flex h-full min-h-0 w-full bg-app-bg"
      data-testid="communications-layout"
    >
      {list}
      {center}
      {details}
      {rail}
    </div>
  );
}
