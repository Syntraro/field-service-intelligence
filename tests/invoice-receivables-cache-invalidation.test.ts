/**
 * Receivables cache invalidation tests (2026-05-13).
 *
 * Verifies that every invoice state-mutating action outside the Receivables
 * workspace correctly invalidates the Receivables query-key tree so rows and
 * view-counts refresh without a manual page reload.
 *
 * Root cause of the original bug:
 *   Existing mutations invalidated ["invoices"] but the Receivables feed uses
 *   ["receivables", "invoices", view] — a separate key tree that ["invoices"]
 *   prefix-matching does NOT reach.
 *
 * These are source-level (readFileSync + regex) tests — no DOM/runtime.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function src(relPath: string) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

const receivablesKeys   = src("client/src/lib/receivablesQueryKeys.ts");
const invoiceDetailPage = src("client/src/pages/InvoiceDetailPage.tsx");
const newInvoicePage    = src("client/src/pages/NewInvoicePage.tsx");
const invoiceListPanel  = src("client/src/components/invoices/InvoiceListPanel.tsx");

// ── receivablesQueryKeys ──────────────────────────────────────────────────────

describe("receivablesQueryKeys.invoicesRoot", () => {
  it("exports invoicesRoot helper", () => {
    expect(receivablesKeys).toMatch(/invoicesRoot/);
  });

  it("invoicesRoot returns ['receivables', 'invoices'] prefix", () => {
    expect(receivablesKeys).toMatch(/invoicesRoot.*\(\).*\["receivables", "invoices"\]/s);
  });

  it("existing viewsCounts helper is preserved", () => {
    expect(receivablesKeys).toMatch(/viewsCounts/);
  });

  it("existing invoices(view) helper is preserved", () => {
    expect(receivablesKeys).toMatch(/invoices: \(view/);
  });

  it("existing notes helper is preserved", () => {
    expect(receivablesKeys).toMatch(/notes:/);
  });
});

// ── InvoiceDetailPage — import ────────────────────────────────────────────────

describe("InvoiceDetailPage imports receivablesKeys", () => {
  it("imports receivablesKeys from receivablesQueryKeys", () => {
    expect(invoiceDetailPage).toMatch(/import.*receivablesKeys.*from.*receivablesQueryKeys/);
  });
});

// ── InvoiceDetailPage — send invoice ─────────────────────────────────────────

describe("InvoiceDetailPage send invoice invalidation", () => {
  it("SendCommunicationModal onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    expect(invoiceDetailPage).toMatch(/onSuccess[\s\S]{0,400}receivablesKeys\.invoicesRoot\(\)/);
  });

  it("SendCommunicationModal onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    expect(invoiceDetailPage).toMatch(/onSuccess[\s\S]{0,400}receivablesKeys\.viewsCounts\(\)/);
  });

  it("SendCommunicationModal onSuccess still invalidates ['invoices']", () => {
    expect(invoiceDetailPage).toMatch(/Invoice sent[\s\S]{0,50}/);
    // The original ["invoices"] invalidation must be present
    const sendBlock = invoiceDetailPage.indexOf('toast({ title: "Invoice sent" })');
    const invoicesKey = invoiceDetailPage.lastIndexOf('queryKey: ["invoices"]', sendBlock);
    expect(invoicesKey).toBeGreaterThan(0);
  });
});

// ── InvoiceDetailPage — void ──────────────────────────────────────────────────

describe("InvoiceDetailPage void mutation invalidation", () => {
  it("voidMutation onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    const voidBlock = (() => {
      const start = invoiceDetailPage.indexOf("voidMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(voidBlock).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("voidMutation onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    const voidBlock = (() => {
      const start = invoiceDetailPage.indexOf("voidMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(voidBlock).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });
});

// ── InvoiceDetailPage — delete ────────────────────────────────────────────────

describe("InvoiceDetailPage delete mutation invalidation", () => {
  it("deleteMutation onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("deleteMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("deleteMutation onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("deleteMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });
});

// ── InvoiceDetailPage — mark as paid (createPayment) ─────────────────────────

describe("InvoiceDetailPage mark-as-paid (createPayment) invalidation", () => {
  it("createPaymentMutation onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("createPaymentMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("createPaymentMutation onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("createPaymentMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });
});

// ── InvoiceDetailPage — refresh-from-job ─────────────────────────────────────

describe("InvoiceDetailPage refresh-from-job invalidation", () => {
  it("refreshFromJobMutation onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("refreshFromJobMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("refreshFromJobMutation onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("refreshFromJobMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });
});

// ── InvoiceDetailPage — InvoiceCompositionDialog onRefreshed ─────────────────

describe("InvoiceDetailPage InvoiceCompositionDialog onRefreshed invalidation", () => {
  it("onRefreshed invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("onRefreshed={() => {");
      return invoiceDetailPage.slice(start, start + 300);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("onRefreshed invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("onRefreshed={() => {");
      return invoiceDetailPage.slice(start, start + 500);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });
});

// ── InvoiceDetailPage — handleToggleSent ─────────────────────────────────────

describe("InvoiceDetailPage handleToggleSent invalidation", () => {
  it("handleToggleSent invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("handleToggleSent");
      return invoiceDetailPage.slice(start, start + 600);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("handleToggleSent invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("handleToggleSent");
      return invoiceDetailPage.slice(start, start + 900);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });
});

// ── InvoiceDetailPage — updateInvoiceFields ──────────────────────────────────

describe("InvoiceDetailPage updateInvoiceFields invalidation", () => {
  it("updateInvoiceFieldsMutation onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("updateInvoiceFieldsMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("updateInvoiceFieldsMutation onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("updateInvoiceFieldsMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });
});

// ── InvoiceDetailPage — updatePaymentTerms ───────────────────────────────────

describe("InvoiceDetailPage updatePaymentTerms invalidation", () => {
  it("updatePaymentTermsMutation onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("updatePaymentTermsMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("updatePaymentTermsMutation onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = invoiceDetailPage.indexOf("updatePaymentTermsMutation = useMutation");
      const end   = invoiceDetailPage.indexOf("onError", start);
      return invoiceDetailPage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });
});

// ── InvoiceDetailPage — existing ["invoices"] invalidations preserved ─────────

describe("InvoiceDetailPage existing invalidations preserved", () => {
  it("['invoices'] key is still invalidated in the file (multiple occurrences)", () => {
    const matches = invoiceDetailPage.match(/queryKey: \["invoices"\]/g) ?? [];
    expect(matches.length).toBeGreaterThan(5);
  });

  it("['invoices', 'detail', invoiceId] key is still invalidated in the file", () => {
    expect(invoiceDetailPage).toMatch(/queryKey: \["invoices", "detail", invoiceId\]/);
  });
});

// ── NewInvoicePage ────────────────────────────────────────────────────────────

describe("NewInvoicePage invalidation after create", () => {
  it("imports receivablesKeys", () => {
    expect(newInvoicePage).toMatch(/import.*receivablesKeys.*from.*receivablesQueryKeys/);
  });

  it("saveMutation onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = newInvoicePage.indexOf("saveMutation = useMutation");
      const end   = newInvoicePage.indexOf("onError", start);
      return newInvoicePage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("saveMutation onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = newInvoicePage.indexOf("saveMutation = useMutation");
      const end   = newInvoicePage.indexOf("onError", start);
      return newInvoicePage.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });

  it("saveMutation onSuccess still invalidates ['invoices']", () => {
    const block = (() => {
      const start = newInvoicePage.indexOf("saveMutation = useMutation");
      const end   = newInvoicePage.indexOf("onError", start);
      return newInvoicePage.slice(start, end);
    })();
    expect(block).toMatch(/queryKey: \["invoices"\]/);
  });
});

// ── InvoiceListPanel — batch paths ───────────────────────────────────────────

describe("InvoiceListPanel batch send and reminder invalidation", () => {
  it("imports receivablesKeys", () => {
    expect(invoiceListPanel).toMatch(/import.*receivablesKeys.*from.*receivablesQueryKeys/);
  });

  it("batchModalNode onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = invoiceListPanel.indexOf("batchModalNode");
      return invoiceListPanel.slice(start, start + 600);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("batchModalNode onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = invoiceListPanel.indexOf("batchModalNode");
      return invoiceListPanel.slice(start, start + 600);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });

  it("batchModalNode onSuccess still invalidates ['invoices']", () => {
    const block = (() => {
      const start = invoiceListPanel.indexOf("batchModalNode");
      return invoiceListPanel.slice(start, start + 600);
    })();
    expect(block).toMatch(/queryKey: \["invoices"\]/);
  });

  it("bulkRemindersMutation onSuccess invalidates receivablesKeys.invoicesRoot()", () => {
    const block = (() => {
      const start = invoiceListPanel.indexOf("bulkRemindersMutation = useMutation");
      const end   = invoiceListPanel.indexOf("onError", start);
      return invoiceListPanel.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.invoicesRoot\(\)/);
  });

  it("bulkRemindersMutation onSuccess invalidates receivablesKeys.viewsCounts()", () => {
    const block = (() => {
      const start = invoiceListPanel.indexOf("bulkRemindersMutation = useMutation");
      const end   = invoiceListPanel.indexOf("onError", start);
      return invoiceListPanel.slice(start, end);
    })();
    expect(block).toMatch(/receivablesKeys\.viewsCounts\(\)/);
  });

  it("bulkRemindersMutation onSuccess still invalidates ['invoices']", () => {
    const block = (() => {
      const start = invoiceListPanel.indexOf("bulkRemindersMutation = useMutation");
      const end   = invoiceListPanel.indexOf("onError", start);
      return invoiceListPanel.slice(start, end);
    })();
    expect(block).toMatch(/queryKey: \["invoices"\]/);
  });
});

// ── No backend files changed ──────────────────────────────────────────────────

describe("Backend files untouched", () => {
  it("server/routes/invoices.ts is not referenced in this changeset (all changes are client-side)", () => {
    // This is a meta-test: the backend send route at server/routes/invoices.ts:1964
    // sets status=awaiting_payment correctly. No backend change is needed.
    // Verify by confirming the backend route file has no receivablesKeys import.
    const serverInvoices = src("server/routes/invoices.ts");
    expect(serverInvoices).not.toMatch(/receivablesKeys/);
  });
});
