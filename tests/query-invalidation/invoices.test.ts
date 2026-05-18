/**
 * Query invalidation tests — invoices.
 *
 * Verifies that each helper covers the full two-family contract:
 *   1. ["invoices", ...] semantic family
 *   2. ["receivables", ...] workspace family
 *
 * And that the job side-effects fire only when jobId is supplied.
 */
import { describe, it, expect } from "vitest";
import { invoiceKeys } from "../../client/src/lib/queryKeys/invoices";
import { jobKeys } from "../../client/src/lib/queryKeys/jobs";
import {
  invalidateInvoice,
  invalidateInvoiceFinancials,
} from "../../client/src/lib/queryInvalidation/invoices";

function makeQc() {
  const calls: unknown[][] = [];
  return {
    invalidateQueries: (opts: { queryKey: unknown }) => {
      calls.push(opts.queryKey as unknown[]);
    },
    calls,
  };
}

const INV_ID = "inv-123";
const JOB_ID = "job-abc";

describe("invalidateInvoiceFinancials", () => {
  it("busts invoice detail, invoice family, receivables root, and receivables counts", () => {
    const qc = makeQc();
    invalidateInvoiceFinancials(qc as any, INV_ID);
    expect(qc.calls).toContainEqual(invoiceKeys.detail(INV_ID));
    expect(qc.calls).toContainEqual(invoiceKeys.all());
    expect(qc.calls).toContainEqual(invoiceKeys.receivablesRoot());
    expect(qc.calls).toContainEqual(invoiceKeys.receivablesCounts());
  });

  it("does not bust job keys when no jobId is given", () => {
    const qc = makeQc();
    invalidateInvoiceFinancials(qc as any, INV_ID);
    expect(qc.calls).not.toContainEqual(jobKeys.all());
    expect(qc.calls).not.toContainEqual(jobKeys.detail(JOB_ID));
  });
});

describe("invalidateInvoice", () => {
  it("without jobId: busts full invoice + receivables families only", () => {
    const qc = makeQc();
    invalidateInvoice(qc as any, INV_ID);
    expect(qc.calls).toContainEqual(invoiceKeys.detail(INV_ID));
    expect(qc.calls).toContainEqual(invoiceKeys.all());
    expect(qc.calls).toContainEqual(invoiceKeys.receivablesRoot());
    expect(qc.calls).toContainEqual(invoiceKeys.receivablesCounts());
    expect(qc.calls).not.toContainEqual(jobKeys.all());
    expect(qc.calls).not.toContainEqual(jobKeys.detail(JOB_ID));
  });

  it("with jobId: also busts byJob, job detail, and job family", () => {
    const qc = makeQc();
    invalidateInvoice(qc as any, INV_ID, { jobId: JOB_ID });
    expect(qc.calls).toContainEqual(invoiceKeys.byJob(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.detail(JOB_ID));
    expect(qc.calls).toContainEqual(jobKeys.all());
  });
});
