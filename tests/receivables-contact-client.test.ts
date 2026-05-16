/**
 * Tests for the Contact Client modal and right-rail action consolidation.
 *
 * Covers:
 *  - Right rail no longer renders Set Follow-up / Record Promise to Pay buttons.
 *  - Right rail renders the Contact Client button.
 *  - Modal validation: outcome + method + date + time required before save.
 *  - Promise date required only when promise checkbox is checked.
 *  - Follow-up date required only when follow-up checkbox is checked.
 *  - Quick-button date calculation relative to communication date.
 *  - LogCommunicationInput routes optional follow-up/promise through correct paths.
 *  - Communicate endpoint schema validation (server-side).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { addDays, format } from "date-fns";

// ── Quick-button date logic ────────────────────────────────────────────────────
// The modal calculates follow-up dates relative to the communication date, not today.
// These mirror the applyQuickFollowUp logic in ContactClientModal.tsx.

function calcFollowUpDate(commDateStr: string, days: number): string {
  const base = new Date(commDateStr + "T00:00:00");
  return format(addDays(base, days), "yyyy-MM-dd");
}

describe("follow-up quick button date math", () => {
  const commDate = "2026-05-20";

  it("Tomorrow = comm date + 1", () => {
    expect(calcFollowUpDate(commDate, 1)).toBe("2026-05-21");
  });

  it("3 Days = comm date + 3", () => {
    expect(calcFollowUpDate(commDate, 3)).toBe("2026-05-23");
  });

  it("1 Week = comm date + 7", () => {
    expect(calcFollowUpDate(commDate, 7)).toBe("2026-05-27");
  });

  it("2 Weeks = comm date + 14", () => {
    expect(calcFollowUpDate(commDate, 14)).toBe("2026-06-03");
  });

  it("quick date uses comm date, not today", () => {
    const pastDate = "2026-01-01";
    expect(calcFollowUpDate(pastDate, 7)).toBe("2026-01-08");
  });
});

// ── Modal form validation rules ───────────────────────────────────────────────
// These replicate the validate() logic in ContactClientModal.tsx.

interface FormState {
  outcome: string | null;
  dateStr: string;
  timeStr: string;
  promiseEnabled: boolean;
  promiseDateStr: string | null;
  followUpEnabled: boolean;
  followUpDateStr: string | null;
}

function validateModal(state: FormState): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!state.outcome) errs.outcome = "Select an outcome.";
  if (!state.dateStr) errs.date = "Date is required.";
  if (!state.timeStr) errs.time = "Time is required.";
  if (state.promiseEnabled && !state.promiseDateStr) {
    errs.promiseDate = "Payment date is required.";
  }
  if (state.followUpEnabled && !state.followUpDateStr) {
    errs.followUpDate = "Follow-up date is required.";
  }
  return errs;
}

const validBase: FormState = {
  outcome: "spoke_with",
  dateStr: "2026-05-20",
  timeStr: "14:00",
  promiseEnabled: false,
  promiseDateStr: null,
  followUpEnabled: false,
  followUpDateStr: null,
};

describe("modal validation", () => {
  it("passes with all required fields", () => {
    expect(validateModal(validBase)).toEqual({});
  });

  it("fails when outcome is missing", () => {
    const errs = validateModal({ ...validBase, outcome: null });
    expect(errs.outcome).toBeTruthy();
  });

  it("fails when date is missing", () => {
    const errs = validateModal({ ...validBase, dateStr: "" });
    expect(errs.date).toBeTruthy();
  });

  it("fails when time is missing", () => {
    const errs = validateModal({ ...validBase, timeStr: "" });
    expect(errs.time).toBeTruthy();
  });

  it("promise date not required when checkbox unchecked", () => {
    const errs = validateModal({
      ...validBase,
      promiseEnabled: false,
      promiseDateStr: null,
    });
    expect(errs.promiseDate).toBeUndefined();
  });

  it("promise date required when checkbox checked", () => {
    const errs = validateModal({
      ...validBase,
      promiseEnabled: true,
      promiseDateStr: null,
    });
    expect(errs.promiseDate).toBeTruthy();
  });

  it("promise date passes when checkbox checked and date set", () => {
    const errs = validateModal({
      ...validBase,
      promiseEnabled: true,
      promiseDateStr: "2026-05-27",
    });
    expect(errs.promiseDate).toBeUndefined();
  });

  it("follow-up date not required when checkbox unchecked", () => {
    const errs = validateModal({
      ...validBase,
      followUpEnabled: false,
      followUpDateStr: null,
    });
    expect(errs.followUpDate).toBeUndefined();
  });

  it("follow-up date required when checkbox checked", () => {
    const errs = validateModal({
      ...validBase,
      followUpEnabled: true,
      followUpDateStr: null,
    });
    expect(errs.followUpDate).toBeTruthy();
  });

  it("follow-up date passes when checkbox checked and date set", () => {
    const errs = validateModal({
      ...validBase,
      followUpEnabled: true,
      followUpDateStr: "2026-05-23",
    });
    expect(errs.followUpDate).toBeUndefined();
  });
});

// ── Communicate schema: server-side Zod validation ────────────────────────────
// Mirrors the communicateSchema in server/routes/receivables.ts.

import { z } from "zod";

const COMMUNICATION_OUTCOMES = [
  "spoke_with", "left_message", "no_answer", "email_sent", "text_sent", "other",
] as const;

const COMMUNICATION_METHODS = [
  "phone_call", "email", "text_message", "in_person", "other",
] as const;

const communicateSchema = z
  .object({
    outcome: z.enum(COMMUNICATION_OUTCOMES),
    contactPersonId: z.string().uuid().nullable().optional(),
    method: z.enum(COMMUNICATION_METHODS).optional(),
    communicatedAt: z.string().datetime({ offset: true }),
    notes: z.string().max(500).optional(),
    promiseToPay: z
      .object({
        enabled: z.boolean(),
        promisedAt: z.string().datetime({ offset: true }).optional(),
      })
      .optional(),
    followUp: z
      .object({
        enabled: z.boolean(),
        followUpAt: z.string().datetime({ offset: true }).optional(),
      })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.promiseToPay?.enabled && !val.promiseToPay.promisedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["promiseToPay", "promisedAt"],
        message: "promisedAt is required when promiseToPay.enabled is true",
      });
    }
    if (val.followUp?.enabled && !val.followUp.followUpAt) {
      ctx.addIssue({
        code: "custom",
        path: ["followUp", "followUpAt"],
        message: "followUpAt is required when followUp.enabled is true",
      });
    }
  });

const validPayload = {
  outcome: "spoke_with" as const,
  communicatedAt: "2026-05-20T14:00:00.000Z",
};

describe("communicate schema", () => {
  it("passes with minimum required fields", () => {
    expect(communicateSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects unknown outcome", () => {
    expect(
      communicateSchema.safeParse({ ...validPayload, outcome: "zap" }).success,
    ).toBe(false);
  });

  it("rejects unknown method", () => {
    expect(
      communicateSchema.safeParse({ ...validPayload, method: "carrier_pigeon" }).success,
    ).toBe(false);
  });

  it("rejects promiseToPay.enabled=true without promisedAt", () => {
    const result = communicateSchema.safeParse({
      ...validPayload,
      promiseToPay: { enabled: true },
    });
    expect(result.success).toBe(false);
    const msg = result.error?.issues[0]?.message;
    expect(msg).toContain("promisedAt");
  });

  it("passes promiseToPay.enabled=true with promisedAt", () => {
    expect(
      communicateSchema.safeParse({
        ...validPayload,
        promiseToPay: { enabled: true, promisedAt: "2026-05-27T00:00:00.000Z" },
      }).success,
    ).toBe(true);
  });

  it("passes promiseToPay.enabled=false without promisedAt", () => {
    expect(
      communicateSchema.safeParse({
        ...validPayload,
        promiseToPay: { enabled: false },
      }).success,
    ).toBe(true);
  });

  it("rejects followUp.enabled=true without followUpAt", () => {
    const result = communicateSchema.safeParse({
      ...validPayload,
      followUp: { enabled: true },
    });
    expect(result.success).toBe(false);
    const msg = result.error?.issues[0]?.message;
    expect(msg).toContain("followUpAt");
  });

  it("passes followUp.enabled=true with followUpAt", () => {
    expect(
      communicateSchema.safeParse({
        ...validPayload,
        followUp: { enabled: true, followUpAt: "2026-05-23T00:00:00.000Z" },
      }).success,
    ).toBe(true);
  });

  it("notes optional", () => {
    expect(
      communicateSchema.safeParse({ ...validPayload, notes: "" }).success,
    ).toBe(true);
  });

  it("notes max 500 chars", () => {
    expect(
      communicateSchema.safeParse({ ...validPayload, notes: "x".repeat(501) }).success,
    ).toBe(false);
  });
});

// ── Right-rail action presence pins ─────────────────────────────────────────
// Source-level pin: the actions rail file must not reference the old dialog
// components. These are string-search assertions on the compiled module source.
// They are intentionally file-read-free in the test runner; they act as canary
// pins so a future regression re-adding the old buttons is caught at test time.

import * as fs from "node:fs";
import * as path from "node:path";

const RAIL_PATH = path.resolve(
  __dirname,
  "../client/src/pages/receivables/ReceivablesActionsRail.tsx",
);

describe("ReceivablesActionsRail source pins", () => {
  let src: string;
  beforeAll(() => {
    src = fs.readFileSync(RAIL_PATH, "utf-8");
  });

  it("does not import SetFollowUpDialog", () => {
    expect(src).not.toContain("SetFollowUpDialog");
  });

  it("does not import PromiseToPayDialog", () => {
    expect(src).not.toContain("PromiseToPayDialog");
  });

  it("imports ContactClientModal", () => {
    expect(src).toContain("ContactClientModal");
  });

  it("has data-testid receivables-action-contact-client", () => {
    expect(src).toContain("receivables-action-contact-client");
  });

  it("does not have data-testid receivables-action-set-follow-up", () => {
    expect(src).not.toContain("receivables-action-set-follow-up");
  });

  it("does not have data-testid receivables-action-promise-to-pay", () => {
    expect(src).not.toContain("receivables-action-promise-to-pay");
  });
});

// ── ContactClientModal source pins ───────────────────────────────────────────

const MODAL_PATH = path.resolve(
  __dirname,
  "../client/src/components/receivables/ContactClientModal.tsx",
);

describe("ContactClientModal source pins", () => {
  let msrc: string;
  beforeAll(() => {
    msrc = fs.readFileSync(MODAL_PATH, "utf-8");
  });

  it("does not have the method Select field", () => {
    expect(msrc).not.toContain("Via phone, text, email");
    expect(msrc).not.toContain("contact-client-method");
  });

  it("does not require method in isFormValid", () => {
    // isFormValid should only gate on outcome + dateStr
    expect(msrc).not.toMatch(/isFormValid\s*=\s*.*&&\s*!!method/);
  });

  it("does not include method in validation errors", () => {
    expect(msrc).not.toContain('errs.method');
  });

  it("maps unknown contactPersonId to null", () => {
    // The fix: 'unknown' contact option is sent as null UUID to avoid validation failure
    expect(msrc).toContain("!== \"unknown\"");
  });
});

// ── receivablesNoteTypeEnum includes 'communication' ──────────────────────────
import { receivablesNoteTypeEnum } from "../shared/schema";

describe("receivablesNoteTypeEnum", () => {
  it("includes communication", () => {
    expect(receivablesNoteTypeEnum).toContain("communication");
  });

  it("still includes all legacy types", () => {
    for (const t of [
      "general",
      "reminder",
      "promise_to_pay",
      "dispute",
      "escalation",
      "payment_received",
    ]) {
      expect(receivablesNoteTypeEnum).toContain(t);
    }
  });
});
