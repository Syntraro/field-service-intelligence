/**
 * Technician Calendar ICS builder — Phase 1 (2026-04-23).
 *
 * Reads the canonical job_visits rows for a given technician and renders
 * a minimal RFC 5545 VCALENDAR string. Read-only; this service never
 * writes. No new scheduling source — visit rows, job summaries, and
 * client_location addresses are the same data the Dispatch board reads.
 *
 * Intentionally excluded from every event:
 *   - pricing (invoice totals, line-item amounts, labor rates)
 *   - invoice/payment state
 *   - `visit_notes` (internal tech-only notes)
 *   - `job.billing_notes`, `job.notes_internal`, QBO sync identifiers
 *   - other technicians on the crew — the subscribing tech's own visits only
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  clientLocations,
  customerCompanies,
  jobs,
  jobVisits,
} from "@shared/schema";

interface TechnicianVisitRow {
  visitId: string;
  jobId: string;
  jobNumber: number | null;
  visitStatus: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  isAllDay: boolean;
  estimatedDurationMinutes: number | null;
  summary: string | null;
  address: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  locationName: string | null;
  companyName: string | null;
  customerCompanyName: string | null;
  updatedAt: Date | null;
}

/**
 * Look back 30 days and forward 365 days from "now". Long enough for the
 * current quarter's schedule + some history for sync, short enough that
 * a 90-visit-per-day tenant doesn't emit a multi-MB feed.
 */
const LOOKBACK_DAYS = 30;
const LOOKAHEAD_DAYS = 365;

async function loadTechnicianVisits(
  companyId: string,
  userId: string,
): Promise<TechnicianVisitRow[]> {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - LOOKBACK_DAYS);

  // Canonical "technician is assigned to this visit" predicate — mirrors
  // server/storage/jobVisits.ts:89.
  const techPredicate = sql`${jobVisits.assignedTechnicianIds} && ARRAY[${userId}]::varchar[]`;

  const rows = await db
    .select({
      visitId: jobVisits.id,
      jobId: jobVisits.jobId,
      jobNumber: jobs.jobNumber,
      visitStatus: jobVisits.status,
      scheduledStart: jobVisits.scheduledStart,
      scheduledEnd: jobVisits.scheduledEnd,
      isAllDay: jobVisits.isAllDay,
      estimatedDurationMinutes: jobVisits.estimatedDurationMinutes,
      summary: jobs.summary,
      address: clientLocations.address,
      address2: clientLocations.address2,
      city: clientLocations.city,
      province: clientLocations.province,
      postalCode: clientLocations.postalCode,
      country: clientLocations.country,
      locationName: clientLocations.location,
      companyName: clientLocations.companyName,
      customerCompanyName: customerCompanies.name,
      updatedAt: jobVisits.updatedAt,
    })
    .from(jobVisits)
    .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
    .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
    .where(and(
      eq(jobVisits.companyId, companyId),
      eq(jobVisits.isActive, true),
      techPredicate,
      gte(jobVisits.scheduledStart, windowStart),
      sql`${jobVisits.scheduledStart} IS NOT NULL`,
    ))
    .orderBy(jobVisits.scheduledStart);

  // Narrow until-cutoff applied in JS so timezone math is explicit.
  const maxUntil = new Date(now);
  maxUntil.setDate(maxUntil.getDate() + LOOKAHEAD_DAYS);
  return rows.filter((r) => r.scheduledStart != null && r.scheduledStart <= maxUntil);
}

// ── ICS formatting helpers ─────────────────────────────────────────────────

/** RFC 5545 date-time form for UTC: 20260423T180000Z */
function icsUtc(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** RFC 5545 date form for all-day events: 20260423 */
function icsDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/**
 * Escape a value for an ICS TEXT field per RFC 5545 §3.3.11:
 *   backslash → \\ ; comma → \, ; semicolon → \; ;
 *   newline → \n ; drop CRs entirely.
 */
function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * RFC 5545 §3.1 "content lines" must not exceed 75 octets. CRLF + single
 * leading space continues the line. Split at byte boundaries, not chars,
 * to stay within spec for multi-byte UTF-8.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let start = 0;
  const step = 74; // leave room for the leading space on continuations
  while (start < bytes.length) {
    const end = Math.min(start + (start === 0 ? 75 : step), bytes.length);
    chunks.push(bytes.slice(start, end).toString("utf8"));
    start = end;
  }
  return chunks.join("\r\n ");
}

function joinAddressLine(row: TechnicianVisitRow): string {
  const parts = [row.address, row.address2, row.city, row.province, row.postalCode, row.country]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

function eventSummaryFor(row: TechnicianVisitRow): string {
  const customer =
    row.customerCompanyName ??
    row.companyName ??
    row.locationName ??
    null;
  const job = row.summary?.trim() || (row.jobNumber ? `Job #${row.jobNumber}` : "Visit");
  if (customer) return `${customer} — ${job}`;
  return job;
}

function eventDescriptionFor(row: TechnicianVisitRow, deepLink: string | null): string {
  const lines: string[] = [];
  if (row.jobNumber != null) lines.push(`Job #${row.jobNumber}`);
  if (row.summary?.trim()) lines.push(row.summary.trim());
  if (row.locationName?.trim()) lines.push(`Location: ${row.locationName.trim()}`);
  if (row.visitStatus) lines.push(`Status: ${row.visitStatus}`);
  if (deepLink) lines.push(`Open in Syntraro: ${deepLink}`);
  return lines.join("\n");
}

/**
 * RFC 5545 §3.8.1.11 STATUS property — maps our visit status to the
 * subset subscribers expect. "cancelled" visits are included in the feed
 * so calendar clients observe the cancellation; completed/in-progress
 * become CONFIRMED.
 */
function icsStatus(visitStatus: string): "CONFIRMED" | "TENTATIVE" | "CANCELLED" {
  const s = (visitStatus ?? "").toLowerCase();
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  if (s === "scheduled") return "CONFIRMED";
  return "CONFIRMED";
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface IcsBuildOptions {
  /**
   * Absolute base URL used to construct per-event deep links. When
   * omitted, events will not include a URL property. Never include the
   * calendar token in the deep link.
   */
  appBaseUrl?: string | null;
}

export async function buildTechnicianIcsFeed(
  companyId: string,
  userId: string,
  options: IcsBuildOptions = {},
): Promise<string> {
  const rows = await loadTechnicianVisits(companyId, userId);
  const now = new Date();
  const dtstamp = icsUtc(now);
  const base = options.appBaseUrl?.replace(/\/+$/, "") ?? null;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    // PRODID per RFC 5545 §3.7.3 — identifies the generator.
    "PRODID:-//Syntraro//Technician Calendar v1//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${icsEscape("Syntraro — My Schedule")}`,
    `X-WR-CALNAME:${icsEscape("Syntraro — My Schedule")}`,
    `DESCRIPTION:${icsEscape(
      "Your assigned visits. Read-only — changes must be made in Syntraro.",
    )}`,
  ];

  for (const row of rows) {
    if (!row.scheduledStart) continue;

    const start = row.scheduledStart;
    const durationMin = row.estimatedDurationMinutes ?? 60;
    const end = row.scheduledEnd ?? new Date(start.getTime() + durationMin * 60_000);
    const deepLink = base ? `${base}/jobs/${row.jobId}` : null;

    lines.push("BEGIN:VEVENT");
    // UID per RFC 5545 §3.8.4.7 — stable across refreshes. Using the
    // visit id guarantees idempotent replacement on the subscriber side.
    lines.push(`UID:visit-${row.visitId}@syntraro`);
    lines.push(`DTSTAMP:${dtstamp}`);
    if (row.updatedAt) lines.push(`LAST-MODIFIED:${icsUtc(row.updatedAt)}`);

    if (row.isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`);
      // All-day end is exclusive; add one day to the date.
      const endDate = new Date(end);
      if (endDate <= start) endDate.setUTCDate(endDate.getUTCDate() + 1);
      lines.push(`DTEND;VALUE=DATE:${icsDate(endDate)}`);
    } else {
      lines.push(`DTSTART:${icsUtc(start)}`);
      lines.push(`DTEND:${icsUtc(end)}`);
    }

    lines.push(`SUMMARY:${icsEscape(eventSummaryFor(row))}`);

    const address = joinAddressLine(row);
    if (address) lines.push(`LOCATION:${icsEscape(address)}`);

    const description = eventDescriptionFor(row, deepLink);
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);

    if (deepLink) lines.push(`URL:${deepLink}`);

    lines.push(`STATUS:${icsStatus(row.visitStatus)}`);
    lines.push(`TRANSP:${row.isAllDay ? "TRANSPARENT" : "OPAQUE"}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF between content lines; fold each line first.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
