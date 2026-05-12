/**
 * Offline action queue — IndexedDB-backed (2026-04-14, Phase 2).
 *
 * Minimal persistent queue for a strict allowlist of mutations the tech-app
 * is allowed to perform offline. Phase 2 scope: `job_note_create` only.
 * Timers and visit-lifecycle are intentionally NOT queued here — that
 * requires server-side idempotency + no-op transitions (see follow-up).
 *
 * No external deps — plain `indexedDB` API. All writes are single-store
 * transactions, keyed by a stable `id` (client-generated UUID). A tiny
 * pub/sub channel lets React hooks render reactively against the queue.
 */

export type QueuedMutationType = "job_note_create";

export type QueuedSyncStatus = "pending" | "syncing" | "failed";

export interface QueuedJobNoteCreatePayload {
  visitId: string;
  text: string;
  equipmentId: string | null;
  // Set once by enqueueJobNote; preserved across status updates and resetInFlightOnBoot.
  // Sent to the server on replay so duplicate syncs return the existing note.
  idempotencyKey: string;
}

export interface QueuedItem {
  id: string; // IDB primary key + React key for the pending row
  type: QueuedMutationType;
  visitId: string;
  payload: QueuedJobNoteCreatePayload;
  clientKey: string; // same as id — exposed for UI clarity
  createdAt: number;
  deviceTimestamp: number;
  syncStatus: QueuedSyncStatus;
  retryCount: number;
  lastError?: string;
}

const DB_NAME = "syntraro_offline_queue";
const DB_VERSION = 1;
const STORE = "actions";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by_type", "type");
        store.createIndex("by_status", "syncStatus");
        store.createIndex("by_visit", "visitId");
        store.createIndex("by_createdAt", "createdAt");
      }
    };
  });
  return dbPromise;
}

// ── Pub/sub so React hooks can re-read after writes ────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((fn) => fn());
}
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── Transaction helpers ────────────────────────────────────────────────────
async function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    Promise.resolve(fn(store))
      .then((v) => {
        tx.oncomplete = () => resolve(v);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
      .catch((e) => reject(e));
  });
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── CRUD ───────────────────────────────────────────────────────────────────
function uuid(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Callers pass everything except idempotencyKey — it is generated here and
// baked into the payload so it survives status updates and resetInFlightOnBoot.
type EnqueueJobNoteParams = Omit<QueuedJobNoteCreatePayload, "idempotencyKey">;

export async function enqueueJobNote(params: EnqueueJobNoteParams): Promise<QueuedItem> {
  const now = Date.now();
  const id = uuid();
  const idempotencyKey = uuid();
  const item: QueuedItem = {
    id,
    type: "job_note_create",
    visitId: params.visitId,
    payload: { ...params, idempotencyKey },
    clientKey: id,
    createdAt: now,
    deviceTimestamp: now,
    syncStatus: "pending",
    retryCount: 0,
  };
  await runTx("readwrite", (store) => promisifyRequest(store.add(item)));
  notify();
  return item;
}

export async function listAll(): Promise<QueuedItem[]> {
  const rows = await runTx<QueuedItem[]>("readonly", (store) =>
    promisifyRequest(store.getAll()),
  );
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}

export async function listByVisit(visitId: string): Promise<QueuedItem[]> {
  const all = await listAll();
  return all.filter((r) => r.visitId === visitId);
}

export async function updateStatus(
  id: string,
  patch: Partial<Pick<QueuedItem, "syncStatus" | "lastError" | "retryCount">>,
): Promise<QueuedItem | null> {
  const next = await runTx<QueuedItem | null>("readwrite", async (store) => {
    const row = await promisifyRequest(store.get(id));
    if (!row) return null;
    const updated: QueuedItem = { ...row, ...patch };
    await promisifyRequest(store.put(updated));
    return updated;
  });
  notify();
  return next;
}

export async function remove(id: string): Promise<void> {
  await runTx("readwrite", (store) => promisifyRequest(store.delete(id)));
  notify();
}

/**
 * 2026-04-14: wipe every row from the queue regardless of `syncStatus`.
 * Called from the canonical logout path so the next user on this device
 * does not inherit the previous tech's pending/syncing/failed items.
 * The `actions` object store is cleared in place — the DB and its
 * indexes stay intact so the next `enqueueJobNote` call just writes
 * into an empty store.
 */
export async function clearAll(): Promise<void> {
  await runTx("readwrite", (store) => promisifyRequest(store.clear()));
  notify();
}

/**
 * Migrate any row currently marked `syncing` back to `pending`. Called on
 * module load — if the app was closed mid-send, the item stays in IDB as
 * `syncing`; treating it as `pending` on next boot lets the drainer pick
 * it up. The payload (including idempotencyKey) is preserved unchanged, so
 * replay sends the same key and the server de-duplicates if the first send
 * already landed.
 */
export async function resetInFlightOnBoot(): Promise<void> {
  const all = await listAll();
  for (const row of all) {
    if (row.syncStatus === "syncing") {
      await updateStatus(row.id, { syncStatus: "pending" });
    }
  }
}
