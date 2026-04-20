/**
 * useDebouncedValue — tech-app-local debouncer for rapidly-changing inputs
 * (e.g., search fields) that feed into canonical shared query hooks.
 *
 * Kept in the tech-app surface so the canonical shared hooks
 * (`useLocationSearch`, `useProductSearch`, etc.) remain unchanged —
 * debounce policy is a UI concern that belongs at the call site.
 *
 * Returns the latest `value` after it has been stable for `delayMs`. During
 * the wait window, consumers see the previous stable value, which prevents
 * a network request on every keystroke without altering the canonical
 * query-key shape.
 */
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
