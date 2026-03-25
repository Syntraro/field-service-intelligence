/**
 * Surface Controller Lifecycle Tests
 *
 * Validates that transient UI surfaces (dialogs, command palettes, popovers)
 * properly isolate ephemeral state and do not leak across surface boundaries.
 *
 * Bug class: open QuickAddJobDialog → close → open global search → crash
 * Root cause: stale async callbacks, uncleared timers, and shared mutable state
 * between surfaces that should be fully independent.
 *
 * Tests cover:
 *  1. Debounce timers cancelled on close
 *  2. AbortController signals abort in-flight on close
 *  3. Stale guard prevents setState after close
 *  4. Rapid open/close cycles don't accumulate timers
 *  5. Session counter increments on each open
 *  6. Query cache cleanup on close
 *  7. Unmount cleans up regardless of open state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// Minimal inline implementation of the surface controller logic for unit testing.
// This tests the core algorithm without requiring React rendering.
// ============================================================================

class TestSurfaceController {
  private _open = false;
  private _session = 0;
  private _abortController = new AbortController();
  private _timers = new Map<string, ReturnType<typeof setTimeout>>();
  private _removedQueryKeys: string[] = [];

  get signal() { return this._abortController.signal; }
  get session() { return this._session; }
  get removedQueryKeys() { return this._removedQueryKeys; }

  isStale() { return !this._open; }

  open() {
    this._open = true;
    this._session += 1;
    this._abortController = new AbortController();
  }

  close(queryKeysToClean: string[] = []) {
    this._open = false;
    // Abort in-flight
    this._abortController.abort();
    // Cancel all timers
    this._timers.forEach((t) => clearTimeout(t));
    this._timers.clear();
    // Clean query cache
    for (const key of queryKeysToClean) {
      this._removedQueryKeys.push(key);
    }
  }

  destroy() {
    this._abortController.abort();
    this._timers.forEach((t) => clearTimeout(t));
    this._timers.clear();
  }

  debounce(key: string, fn: () => void, ms: number) {
    const existing = this._timers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    this._timers.set(key, setTimeout(() => {
      this._timers.delete(key);
      if (this._open) fn();
    }, ms));
  }

  timeout(key: string, fn: () => void, ms: number) {
    const existing = this._timers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    this._timers.set(key, setTimeout(() => {
      this._timers.delete(key);
      fn();
    }, ms));
  }

  get pendingTimerCount() { return this._timers.size; }
}

// ============================================================================
// Tests
// ============================================================================

describe("SurfaceController lifecycle", () => {
  let ctrl: TestSurfaceController;

  beforeEach(() => {
    ctrl = new TestSurfaceController();
    vi.useFakeTimers();
  });

  afterEach(() => {
    ctrl.destroy();
    vi.useRealTimers();
  });

  it("debounce fires when surface is open", () => {
    ctrl.open();
    const fn = vi.fn();
    ctrl.debounce("search", fn, 300);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("debounce does NOT fire after surface closes", () => {
    ctrl.open();
    const fn = vi.fn();
    ctrl.debounce("search", fn, 300);
    ctrl.close();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });

  it("close cancels all pending timers", () => {
    ctrl.open();
    ctrl.debounce("a", vi.fn(), 100);
    ctrl.debounce("b", vi.fn(), 200);
    ctrl.timeout("c", vi.fn(), 300);
    expect(ctrl.pendingTimerCount).toBe(3);
    ctrl.close();
    expect(ctrl.pendingTimerCount).toBe(0);
  });

  it("abort signal is triggered on close", () => {
    ctrl.open();
    const signal = ctrl.signal;
    expect(signal.aborted).toBe(false);
    ctrl.close();
    expect(signal.aborted).toBe(true);
  });

  it("new abort controller is created on each open", () => {
    ctrl.open();
    const signal1 = ctrl.signal;
    ctrl.close();
    ctrl.open();
    const signal2 = ctrl.signal;
    expect(signal1).not.toBe(signal2);
    expect(signal1.aborted).toBe(true);  // old one aborted
    expect(signal2.aborted).toBe(false); // new one fresh
  });

  it("isStale returns true when closed", () => {
    expect(ctrl.isStale()).toBe(true);
    ctrl.open();
    expect(ctrl.isStale()).toBe(false);
    ctrl.close();
    expect(ctrl.isStale()).toBe(true);
  });

  it("session increments on each open", () => {
    expect(ctrl.session).toBe(0);
    ctrl.open();
    expect(ctrl.session).toBe(1);
    ctrl.close();
    ctrl.open();
    expect(ctrl.session).toBe(2);
    ctrl.close();
    ctrl.open();
    expect(ctrl.session).toBe(3);
  });

  it("close triggers query key cleanup", () => {
    ctrl.open();
    ctrl.close(["/api/clients/search-locations"]);
    expect(ctrl.removedQueryKeys).toContain("/api/clients/search-locations");
  });

  it("rapid open/close does not accumulate timers", () => {
    for (let i = 0; i < 10; i++) {
      ctrl.open();
      ctrl.debounce("search", vi.fn(), 300);
      ctrl.close();
    }
    expect(ctrl.pendingTimerCount).toBe(0);
    // All abort controllers should be aborted
    expect(ctrl.signal.aborted).toBe(true);
  });

  it("debounce replaces previous timer with same key", () => {
    ctrl.open();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    ctrl.debounce("search", fn1, 300);
    ctrl.debounce("search", fn2, 300);
    expect(ctrl.pendingTimerCount).toBe(1);
    vi.advanceTimersByTime(300);
    expect(fn1).not.toHaveBeenCalled(); // replaced
    expect(fn2).toHaveBeenCalledOnce();
  });

  it("destroy cleans up even when open", () => {
    ctrl.open();
    ctrl.debounce("a", vi.fn(), 100);
    ctrl.timeout("b", vi.fn(), 200);
    const signal = ctrl.signal;
    ctrl.destroy();
    expect(signal.aborted).toBe(true);
    expect(ctrl.pendingTimerCount).toBe(0);
  });
});

describe("Cross-surface isolation", () => {
  it("two independent controllers do not interfere", () => {
    vi.useFakeTimers();
    const ctrl1 = new TestSurfaceController();
    const ctrl2 = new TestSurfaceController();

    ctrl1.open();
    const fn1 = vi.fn();
    ctrl1.debounce("search", fn1, 300);

    ctrl2.open();
    const fn2 = vi.fn();
    ctrl2.debounce("search", fn2, 300);

    // Close ctrl1 — its timer should be cancelled, ctrl2's should survive
    ctrl1.close();
    vi.advanceTimersByTime(300);

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledOnce();

    ctrl2.close();
    ctrl1.destroy();
    ctrl2.destroy();
    vi.useRealTimers();
  });

  it("stale async guard prevents setState after close", async () => {
    const ctrl = new TestSurfaceController();
    ctrl.open();

    // Simulate: start async, close surface, async completes
    const staleBeforeClose = ctrl.isStale();
    ctrl.close();
    const staleAfterClose = ctrl.isStale();

    expect(staleBeforeClose).toBe(false);
    expect(staleAfterClose).toBe(true);

    // Simulated pattern: if (surface.isStale()) return;
    // This is the guard that prevents the crash
    const setStateCalled = vi.fn();
    if (!ctrl.isStale()) {
      setStateCalled();
    }
    expect(setStateCalled).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  it("abort signal cancels fetch on close", async () => {
    const ctrl = new TestSurfaceController();
    ctrl.open();
    const signal = ctrl.signal;

    // Create a promise that rejects on abort (like fetch would)
    const fetchPromise = new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });

    ctrl.close();

    await expect(fetchPromise).rejects.toThrow("Aborted");
    ctrl.destroy();
  });

  it("close/open cross-surface: QuickCreateDrawer close does not affect NewQuoteModal", () => {
    // Simulates the real scenario: user opens drawer, closes it, then opens quote modal
    vi.useFakeTimers();
    const drawerCtrl = new TestSurfaceController();
    const quoteModalCtrl = new TestSurfaceController();

    // 1. Open drawer, start a debounced search
    drawerCtrl.open();
    const drawerSearch = vi.fn();
    drawerCtrl.debounce("search", drawerSearch, 300);

    // 2. Close drawer (simulates user dismissing)
    drawerCtrl.close(["/api/clients/quick-create-picker"]);
    expect(drawerCtrl.signal.aborted).toBe(true);
    expect(drawerCtrl.removedQueryKeys).toContain("/api/clients/quick-create-picker");

    // 3. Open quote modal — completely independent lifecycle
    quoteModalCtrl.open();
    const quoteSignal = quoteModalCtrl.signal;
    expect(quoteSignal.aborted).toBe(false);

    const quoteSearch = vi.fn();
    quoteModalCtrl.debounce("location-search", quoteSearch, 200);
    vi.advanceTimersByTime(200);

    // Quote modal search should fire normally — drawer close didn't interfere
    expect(quoteSearch).toHaveBeenCalledOnce();
    expect(drawerSearch).not.toHaveBeenCalled(); // drawer's timer was cancelled

    quoteModalCtrl.close();
    drawerCtrl.destroy();
    quoteModalCtrl.destroy();
    vi.useRealTimers();
  });

  it("rapid drawer close + modal open does not leak abort signals", () => {
    const drawer = new TestSurfaceController();
    const modal = new TestSurfaceController();

    // Rapid sequence: open drawer → close → open modal in same tick
    drawer.open();
    drawer.close();
    modal.open();

    expect(drawer.isStale()).toBe(true);
    expect(modal.isStale()).toBe(false);
    expect(drawer.signal.aborted).toBe(true);
    expect(modal.signal.aborted).toBe(false);

    modal.close();
    drawer.destroy();
    modal.destroy();
  });
});
