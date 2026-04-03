/** Technician PWA — Notes bottom sheet */

import { useState } from "react";

export function NotesSheet({ onSave, onCancel }: { onSave: (note: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");

  const handleSave = () => {
    if (text.trim()) {
      onSave(text.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-t-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold">Add Note</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your note..."
          className="w-full h-32 rounded-xl border border-border bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm resize-none"
          autoFocus
        />
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 h-12 rounded-xl border border-border font-medium text-sm">Cancel</button>
          <button onClick={handleSave} className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm">Save Note</button>
        </div>
      </div>
    </div>
  );
}
