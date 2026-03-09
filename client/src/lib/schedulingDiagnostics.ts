/**
 * Scheduling Diagnostics Store (renamed from calendarDiagnostics.ts — 2026-03-07)
 *
 * Global diagnostics store for scheduling/dispatch debugging.
 * Captures mutations, UI interactions, and invariant violations.
 *
 * Enable via:
 * - Development mode (NODE_ENV !== 'production')
 * - Query param: ?diag=1
 */

// ============================================================================
// Types
// ============================================================================

export type DiagEntryType =
  | 'mutation-request'
  | 'mutation-response'
  | 'mutation-error'
  | 'client-validation-error'
  | 'hover-enter'
  | 'hover-leave'
  | 'click'
  | 'drag-start'
  | 'drag-end'
  | 'invariant-fail'
  | 'info';

export interface DiagEntry {
  id: string;
  type: DiagEntryType;
  timestamp: number;
  summary: string;
  data: Record<string, unknown>;
  /** For invariant failures */
  isFail?: boolean;
  /** For errors - whether network request was sent */
  networkRequestSent?: boolean;
}

export interface MutationLogData {
  method: string;
  url: string;
  body?: unknown;
  status?: number;
  response?: unknown;
  error?: string;
  durationMs?: number;
  // Derived flags
  isAllDay?: boolean;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  version?: number;
  [key: string]: unknown; // Index signature for Record<string, unknown> compatibility
}

export interface HoverLogData {
  jobId: string;
  assignmentId?: string;
  context: 'month-chip' | 'week-timed' | 'week-all-day' | 'plus-n-list' | 'unscheduled';
  clientName?: string;
  [key: string]: unknown; // Index signature for Record<string, unknown> compatibility
}

export interface ClickLogData {
  jobId: string;
  assignmentId?: string;
  context: string;
  isDragging: boolean;
  isSaving: boolean;
  inCalendar: boolean;
  clickAllowed: boolean;
  [key: string]: unknown; // Index signature for Record<string, unknown> compatibility
}

export interface DragLogData {
  phase: 'start' | 'end';
  sourceId: string;
  sourceType: 'calendar-assignment' | 'unscheduled-job';
  targetId?: string;
  // 2026-01-28: Added 'day-allday' for Jobber-style day view all-day lane
  // 2026-01-29: Added 'techweek' for weekly technician view
  targetType?: 'month-day' | 'week-allday' | 'day-allday' | 'week-timed' | 'day-timed' | 'unscheduled-panel' | 'techweek';
  computedPayload?: Record<string, unknown>;
  result?: 'success' | 'error' | 'cancelled';
  [key: string]: unknown; // Index signature for Record<string, unknown> compatibility
}

// ============================================================================
// Store
// ============================================================================

const MAX_ENTRIES = 100;
let entries: DiagEntry[] = [];
let listeners: Set<() => void> = new Set();
let idCounter = 0;

function generateId(): string {
  return `diag-${Date.now()}-${++idCounter}`;
}

function notify() {
  listeners.forEach(fn => fn());
}

// ============================================================================
// Public API
// ============================================================================

export function isDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  // Always enabled in development
  if (process.env.NODE_ENV !== 'production') return true;

  // Check query param
  const params = new URLSearchParams(window.location.search);
  return params.get('diag') === '1';
}

export function addDiagEntry(
  type: DiagEntryType,
  summary: string,
  data: Record<string, unknown> = {},
  options: { isFail?: boolean; networkRequestSent?: boolean } = {}
): void {
  if (!isDiagnosticsEnabled()) return;

  // Auto-derive isFail: true for error types and 4xx/5xx status codes.
  // Explicit options.isFail=true always wins; auto-derivation fills gaps.
  const statusCode = typeof data.status === 'number' ? data.status : 0;
  const derivedFail =
    options.isFail === true ||
    type.endsWith('-error') ||
    type === 'invariant-fail' ||
    statusCode >= 400;

  const entry: DiagEntry = {
    id: generateId(),
    type,
    timestamp: Date.now(),
    summary,
    data,
    ...options,
    isFail: derivedFail,
  };

  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  notify();

  // Console log for immediate visibility
  const prefix = options.isFail ? '🔴 INVARIANT FAIL' : type.toUpperCase();
  console.log(`[CalendarDiag] ${prefix}: ${summary}`, data);
}

export function getEntries(): DiagEntry[] {
  return entries;
}

export function clearEntries(): void {
  entries = [];
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ============================================================================
// Mutation Logging Helpers
// ============================================================================

export function logMutationRequest(method: string, url: string, body?: unknown): void {
  const data: MutationLogData = { method, url, body };

  // Extract derived flags from body
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    data.isAllDay = b.allDay === true;
    data.version = typeof b.version === 'number' ? b.version : undefined;
  }

  addDiagEntry('mutation-request', `${method} ${url}`, data);
}

export function logMutationResponse(
  method: string,
  url: string,
  status: number,
  response: unknown,
  durationMs: number
): void {
  const data: MutationLogData = { method, url, status, response, durationMs };

  // Extract derived flags from response
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>;
    data.isAllDay = r.isAllDay === true;
    data.scheduledStart = r.scheduledStart as string | null ?? null;
    data.scheduledEnd = r.scheduledEnd as string | null ?? null;
    data.version = typeof r.version === 'number' ? r.version : undefined;

    // CANONICAL SCHEDULING INVARIANT:
    // All-day events MUST have scheduledStart set to midnight (canonical model).
    // isAllDay is a display flag only - scheduledStart IS NOT NULL is the scheduling determinant.
    if (data.isAllDay && data.scheduledStart === null) {
      addDiagEntry(
        'invariant-fail',
        `CANONICAL SCHEDULING VIOLATED: isAllDay=true but scheduledStart is NULL`,
        {
          isAllDay: data.isAllDay,
          scheduledStart: data.scheduledStart,
          scheduledEnd: data.scheduledEnd,
          fullResponse: response,
          hint: 'All-day events must have scheduledStart set to midnight (00:00:00)',
        },
        { isFail: true }
      );
    }
  }

  const statusEmoji = status >= 200 && status < 300 ? '✓' : '✗';
  addDiagEntry('mutation-response', `${statusEmoji} ${method} ${url} → ${status} (${durationMs}ms)`, data);
}

/**
 * Log mutation error with FULL RAW server response
 *
 * @param method - HTTP method
 * @param url - Request URL
 * @param status - HTTP status code
 * @param rawErrorBody - FULL raw JSON body from server (before any mapping)
 * @param clientMappedMessage - The message that will be shown to user (after mapping)
 * @param durationMs - Request duration
 */
export function logMutationError(
  method: string,
  url: string,
  status: number,
  rawErrorBody: unknown,
  clientMappedMessage: string,
  durationMs: number
): void {
  // Extract raw fields from server response
  let rawErrorCode: string | undefined;
  let rawErrorMessage: string | undefined;
  let rawErrorDetails: unknown;

  if (rawErrorBody && typeof rawErrorBody === 'object') {
    const body = rawErrorBody as Record<string, unknown>;
    rawErrorCode = typeof body.code === 'string' ? body.code : undefined;
    rawErrorMessage = typeof body.message === 'string' ? body.message :
                      typeof body.error === 'string' ? body.error : undefined;
    rawErrorDetails = body.details;
  }

  const data: MutationLogData = {
    method,
    url,
    status,
    durationMs,
    // RAW SERVER RESPONSE (before any client mapping)
    rawErrorBody,
    rawErrorCode,
    rawErrorMessage,
    rawErrorDetails,
    // CLIENT-MAPPED MESSAGE (what user sees in toast)
    clientMappedMessage,
    // Flag if client changed the message
    messageWasMapped: rawErrorMessage !== clientMappedMessage,
  };

  // Check for specific error patterns
  const checkStr = `${rawErrorCode} ${rawErrorMessage} ${clientMappedMessage}`;
  const isSpanError = checkStr.includes('span multiple days') ||
                      checkStr.includes('CROSS_DAY_NOT_ALLOWED');
  const isWorkingHoursError = checkStr.includes('OUTSIDE_WORKING_HOURS') ||
                               checkStr.includes('not scheduled to work') ||
                               checkStr.includes('working hours');

  addDiagEntry(
    'mutation-error',
    `✗ ${method} ${url} → ${status} | code=${rawErrorCode || 'none'} | msg="${rawErrorMessage || 'none'}"`,
    { ...data, isSpanError, isWorkingHoursError, errorOrigin: 'Server returned error' },
    { networkRequestSent: true }
  );

  if (isSpanError) {
    addDiagEntry(
      'invariant-fail',
      `CROSS-DAY ERROR from SERVER: code=${rawErrorCode}`,
      { errorOrigin: 'Server returned error', method, url, rawErrorBody },
      { isFail: true, networkRequestSent: true }
    );
  }

  if (isWorkingHoursError) {
    addDiagEntry(
      'invariant-fail',
      `WORKING HOURS ERROR from SERVER: code=${rawErrorCode} | msg="${rawErrorMessage}"`,
      { errorOrigin: 'Server returned error', method, url, rawErrorBody, rawErrorCode, rawErrorMessage },
      { isFail: true, networkRequestSent: true }
    );
  }
}

export function logClientValidationError(message: string, context?: Record<string, unknown>): void {
  const isSpanError = message.includes('span multiple days') ||
                      message.includes('CROSS_DAY_NOT_ALLOWED');

  addDiagEntry(
    'client-validation-error',
    `Client blocked: ${message}`,
    { message, ...context, errorOrigin: 'Client blocked before request' },
    { networkRequestSent: false }
  );

  if (isSpanError) {
    addDiagEntry(
      'invariant-fail',
      `CROSS-DAY ERROR from CLIENT: "${message}"`,
      { errorOrigin: 'Client blocked before request', ...context },
      { isFail: true, networkRequestSent: false }
    );
  }
}

/**
 * Log VERSION_MISMATCH (409) error with detailed context for debugging.
 * Called when server rejects a scheduling mutation due to stale version.
 *
 * REFACTORING NOTE (2026-01-26):
 * Added to help diagnose optimistic locking failures in drag-and-drop scheduling.
 * Logs jobId, sent version, and parses expected/actual from server message.
 * See docs/REFACTORING_LOG.md for context on the VERSION_MISMATCH fix.
 *
 * @param jobId - The job ID that was being scheduled
 * @param sentVersion - The version sent in the request
 * @param serverMessage - The error message from server (may contain expected/actual)
 * @param method - HTTP method (POST or PATCH)
 * @param url - Request URL
 */
export function logVersionMismatch(
  jobId: string,
  sentVersion: number | undefined,
  serverMessage: string,
  method: string,
  url: string
): void {
  // Try to extract expected/actual versions from server message
  // Server message format varies, e.g.: "Job was modified by another user. Expected version X but got Y"
  let expectedVersion: number | undefined;
  let actualVersion: number | undefined;

  const versionMatch = serverMessage.match(/expected.*?(\d+).*?got.*?(\d+)/i) ||
                       serverMessage.match(/version.*?(\d+).*?actual.*?(\d+)/i);
  if (versionMatch) {
    expectedVersion = parseInt(versionMatch[1], 10);
    actualVersion = parseInt(versionMatch[2], 10);
  }

  addDiagEntry(
    'invariant-fail',
    `VERSION_MISMATCH (409): jobId=${jobId} sentVersion=${sentVersion ?? 'undefined'}`,
    {
      errorOrigin: 'Server rejected due to version mismatch',
      jobId,
      sentVersion,
      expectedVersion,
      actualVersion,
      serverMessage,
      method,
      url,
      suggestion: sentVersion === undefined || sentVersion === 0
        ? 'Version was not properly passed from unscheduled item. Check drag payload construction.'
        : 'Job was modified by another user/tab. Calendar data was stale.',
    },
    { isFail: true, networkRequestSent: true }
  );
}

// ============================================================================
// UI Interaction Logging Helpers
// ============================================================================

export function logHover(
  phase: 'enter' | 'leave',
  data: HoverLogData
): void {
  addDiagEntry(
    phase === 'enter' ? 'hover-enter' : 'hover-leave',
    `Hover ${phase}: ${data.clientName || data.jobId} [${data.context}]`,
    data
  );
}

export function logClick(data: ClickLogData): void {
  const gatingResult = data.clickAllowed ? 'ALLOWED' : 'BLOCKED';
  const blockedBy = !data.clickAllowed
    ? data.isDragging ? 'isDragging' : data.isSaving ? 'isSaving' : !data.inCalendar ? 'notInCalendar' : 'unknown'
    : null;

  addDiagEntry(
    'click',
    `Click ${gatingResult}: ${data.assignmentId || data.jobId} [${data.context}]${blockedBy ? ` (blocked by ${blockedBy})` : ''}`,
    { ...data, blockedBy }
  );
}

export function logDrag(data: DragLogData): void {
  const summary = data.phase === 'start'
    ? `Drag START: ${data.sourceId} (${data.sourceType})`
    : `Drag END: ${data.sourceId} → ${data.targetId || 'cancelled'} (${data.result})`;

  addDiagEntry(
    data.phase === 'start' ? 'drag-start' : 'drag-end',
    summary,
    data
  );
}

// ============================================================================
// Report Generation
// ============================================================================

export function generateReport(): string {
  const recentEntries = entries.slice(0, 50);

  const report = {
    generatedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
    entryCount: recentEntries.length,
    invariantFailures: recentEntries.filter(e => e.isFail).length,
    entries: recentEntries.map(e => ({
      time: new Date(e.timestamp).toISOString(),
      type: e.type,
      summary: e.summary,
      isFail: e.isFail || false,
      networkRequestSent: e.networkRequestSent,
      data: e.data,
    })),
  };

  return JSON.stringify(report, null, 2);
}

export async function copyReportToClipboard(): Promise<boolean> {
  try {
    const report = generateReport();
    await navigator.clipboard.writeText(report);
    return true;
  } catch (err) {
    console.error('Failed to copy diagnostics report:', err);
    return false;
  }
}
