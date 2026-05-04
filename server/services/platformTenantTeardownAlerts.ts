/**
 * Tenant-teardown alerting (2026-05-04).
 *
 * Sends real-time notifications for every step of the four-phase
 * deletion workflow — request created, approved, execution started,
 * execution completed/failed, cancelled, expired.
 *
 * Recipients:
 *   • Email: comma-separated `PLATFORM_OPS_ALERT_EMAILS` env var. When
 *     unset, alerts no-op (logged loudly so operators see the gap).
 *   • Slack (optional): `PLATFORM_TEARDOWN_SLACK_WEBHOOK` env var. When
 *     unset, the Slack call is skipped without affecting the email
 *     path.
 *
 * All sends are fire-and-forget — alerting must NEVER block or fail a
 * teardown decision. Errors land in the structured log channel
 * `[teardown-alert]` for ops triage.
 *
 * Security stance:
 *   • The body intentionally OMITS the `preview_payload_json` (could
 *     contain sample R2 keys + tenant data) and the `request_user_agent`
 *     (could contain UA injection content). Only canonical, structured
 *     facts go on the wire.
 *   • Recipient lists pulled from env are not parsed for trust — they're
 *     deployment configuration; ops controls what lands there.
 */

import { getResendClient } from "../resendClient";

export type TeardownAlertEvent =
  | "request_created"
  | "approved"
  | "execution_started"
  | "execution_completed"
  | "execution_failed"
  | "cancelled"
  | "expired";

export interface TeardownAlertContext {
  event: TeardownAlertEvent;
  /** UUID of the `tenant_deletion_requests` row. */
  requestId: string;
  /** Resolved tenant company id. */
  companyId: string;
  /** Snapshotted company name. */
  companyName: string;
  initiatedByEmail: string;
  approvedByEmail?: string | null;
  reason: string;
  /** Hex SHA-256 — useful in alerts so ops can correlate with audit. */
  previewHash: string;
  /** Wall-clock ISO timestamp the event happened at. */
  occurredAt: string;
  /** Failure reason on execution_failed. */
  failureReason?: string | null;
  /** Approved `execution_scheduled_at` ISO — countdown for ops. */
  executionScheduledAt?: string | null;
  /** Tenant prefix at R2, present on execution events. */
  r2Prefix?: string | null;
}

const SUBJECTS: Record<TeardownAlertEvent, string> = {
  request_created: "[Tenant Teardown] Request CREATED — pending approval",
  approved: "[Tenant Teardown] Request APPROVED — execution scheduled",
  execution_started: "[Tenant Teardown] Execution STARTED",
  execution_completed: "[Tenant Teardown] Execution COMPLETED",
  execution_failed: "[Tenant Teardown] Execution FAILED",
  cancelled: "[Tenant Teardown] Request CANCELLED",
  expired: "[Tenant Teardown] Request EXPIRED",
};

function recipients(): string[] {
  return (process.env.PLATFORM_OPS_ALERT_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function logInfo(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(`[teardown-alert] ${kind}`, JSON.stringify({ kind, ...ctx }));
}
function logWarn(kind: string, ctx: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.warn(`[teardown-alert] ${kind}`, JSON.stringify({ kind, ...ctx }));
}

function buildBodyText(ctx: TeardownAlertContext): string {
  const lines: string[] = [];
  lines.push(`Event:            ${ctx.event}`);
  lines.push(`Request id:       ${ctx.requestId}`);
  lines.push(`Company id:       ${ctx.companyId}`);
  lines.push(`Company name:     ${ctx.companyName}`);
  lines.push(`Initiator:        ${ctx.initiatedByEmail}`);
  if (ctx.approvedByEmail) lines.push(`Approver:         ${ctx.approvedByEmail}`);
  lines.push(`Reason:           ${ctx.reason}`);
  lines.push(`Preview hash:     ${ctx.previewHash}`);
  lines.push(`Occurred at:      ${ctx.occurredAt}`);
  if (ctx.executionScheduledAt) {
    lines.push(`Execution at:     ${ctx.executionScheduledAt}`);
  }
  if (ctx.r2Prefix) lines.push(`R2 prefix:        ${ctx.r2Prefix}`);
  if (ctx.failureReason) lines.push(`Failure reason:   ${ctx.failureReason}`);
  return lines.join("\n");
}

function buildSlackPayload(ctx: TeardownAlertContext) {
  const emoji =
    ctx.event === "execution_failed"
      ? ":rotating_light:"
      : ctx.event === "execution_completed"
        ? ":wastebasket:"
        : ctx.event === "approved"
          ? ":white_check_mark:"
          : ctx.event === "cancelled" || ctx.event === "expired"
            ? ":no_entry:"
            : ":warning:";
  return {
    text: `${emoji} ${SUBJECTS[ctx.event]}`,
    attachments: [
      {
        color:
          ctx.event === "execution_failed"
            ? "#dc2626"
            : ctx.event === "execution_completed"
              ? "#059669"
              : ctx.event === "approved"
                ? "#0284c7"
                : "#d97706",
        text: buildBodyText(ctx),
      },
    ],
  };
}

async function sendEmail(ctx: TeardownAlertContext): Promise<void> {
  const to = recipients();
  if (to.length === 0) {
    logWarn("recipients_unconfigured", {
      event: ctx.event,
      requestId: ctx.requestId,
      hint: "Set PLATFORM_OPS_ALERT_EMAILS to a comma-separated list of operator emails.",
    });
    return;
  }
  try {
    const { client, fromEmail, defaultFromHeader, defaultReplyTo } =
      await getResendClient();
    void fromEmail;
    await client.emails.send({
      from: defaultFromHeader,
      replyTo: defaultReplyTo,
      to,
      subject: SUBJECTS[ctx.event],
      text: buildBodyText(ctx),
    });
    logInfo("email_sent", { event: ctx.event, requestId: ctx.requestId, to });
  } catch (err) {
    logWarn("email_failed", {
      event: ctx.event,
      requestId: ctx.requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function sendSlack(ctx: TeardownAlertContext): Promise<void> {
  const url = process.env.PLATFORM_TEARDOWN_SLACK_WEBHOOK;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSlackPayload(ctx)),
    });
    if (!res.ok) {
      logWarn("slack_non_2xx", {
        event: ctx.event,
        requestId: ctx.requestId,
        status: res.status,
      });
      return;
    }
    logInfo("slack_sent", { event: ctx.event, requestId: ctx.requestId });
  } catch (err) {
    logWarn("slack_failed", {
      event: ctx.event,
      requestId: ctx.requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Fire-and-forget alert dispatch. Returns a promise the caller can
 * `void` — alert failures must NEVER fail the teardown decision.
 */
export async function sendTeardownAlert(
  ctx: TeardownAlertContext,
): Promise<void> {
  // Fan out in parallel; both branches log on failure but do not throw.
  await Promise.all([sendEmail(ctx), sendSlack(ctx)]);
}
